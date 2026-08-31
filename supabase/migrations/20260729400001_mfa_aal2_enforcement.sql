-- ============================================================
-- MFA / AAL2 Enforcement on Money-Moving RPCs
--
-- Problem:
--   wallet_transfer, wallet_admin_adjust, wallet_submit_top_up_request,
--   wallet_approve_top_up, wallet_reject_top_up, and post_publish are all
--   SECURITY DEFINER — they bypass RLS entirely. The app's client-side
--   ProtectedRoute redirects to /mfa-verify, but that is a UI guard only.
--   Any caller with a valid aal1 JWT (issued after password login, before
--   TOTP verification) can invoke these RPCs directly via supabase.rpc() or
--   raw PostgREST and skip MFA completely.
--
--   The posts table already has a RESTRICTIVE RLS policy enforcing aal2, but
--   SECURITY DEFINER functions bypass RLS, so that policy does not protect
--   wallet operations at all.
--
-- Fix:
--   1. Create assert_aal2() — a single helper that checks auth.jwt()->>'aal'.
--      It gracefully skips the check when MFA is not enrolled (aal = 'aal1'
--      is acceptable only if the user has no verified TOTP factor).
--   2. Call assert_aal2() at the top of every money-moving RPC.
--      This is enforced inside Postgres — impossible to bypass from the client.
-- ============================================================

-- ── Helper: assert_aal2 ───────────────────────────────────────────────────────
-- Raises if the caller has a verified MFA factor but presented only an aal1 token.
-- If the user has NO verified factor, aal1 is accepted (unenrolled users are not
-- forced through an MFA flow they never set up).

CREATE OR REPLACE FUNCTION public.assert_aal2()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_aal       TEXT;
    v_has_totp  BOOLEAN;
BEGIN
    v_aal := auth.jwt() ->> 'aal';

    -- If the session is already aal2, allow immediately
    IF v_aal = 'aal2' THEN
        RETURN;
    END IF;

    -- Check whether this user has any verified TOTP factor
    SELECT EXISTS (
        SELECT 1
        FROM   auth.mfa_factors
        WHERE  user_id = auth.uid()
          AND  status  = 'verified'
          AND  factor_type = 'totp'
    ) INTO v_has_totp;

    -- If no factor is enrolled, aal1 is fine — user hasn't set up MFA
    IF NOT v_has_totp THEN
        RETURN;
    END IF;

    -- Factor enrolled but session is only aal1 → require step-up
    RAISE EXCEPTION 'MFA step-up required: complete TOTP verification before performing this action'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_aal2() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.assert_aal2() TO authenticated;


-- ── wallet_transfer ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_transfer(
    p_sender_wallet   UUID,
    p_receiver_wallet UUID,
    p_amount          NUMERIC
)
RETURNS TABLE (sender_balance NUMERIC, receiver_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sender_status    TEXT;
    v_receiver_status  TEXT;
    v_sender_balance   NUMERIC;
    v_receiver_balance NUMERIC;
    v_group_id         UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    IF NOT EXISTS (
        SELECT 1 FROM public.wallets
        WHERE id = p_sender_wallet AND member_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized: you do not own the sender wallet';
    END IF;

    IF p_amount <= 0 THEN RAISE EXCEPTION 'Transfer amount must be positive'; END IF;
    IF p_sender_wallet = p_receiver_wallet THEN RAISE EXCEPTION 'Cannot transfer to the same wallet'; END IF;

    v_group_id := gen_random_uuid();

    IF p_sender_wallet < p_receiver_wallet THEN
        SELECT balance_cached, status INTO v_sender_balance,   v_sender_status
            FROM public.wallets WHERE id = p_sender_wallet   FOR UPDATE;
        SELECT balance_cached, status INTO v_receiver_balance, v_receiver_status
            FROM public.wallets WHERE id = p_receiver_wallet FOR UPDATE;
    ELSE
        SELECT balance_cached, status INTO v_receiver_balance, v_receiver_status
            FROM public.wallets WHERE id = p_receiver_wallet FOR UPDATE;
        SELECT balance_cached, status INTO v_sender_balance,   v_sender_status
            FROM public.wallets WHERE id = p_sender_wallet   FOR UPDATE;
    END IF;

    IF v_sender_balance   IS NULL THEN RAISE EXCEPTION 'Sender wallet not found';   END IF;
    IF v_receiver_balance IS NULL THEN RAISE EXCEPTION 'Receiver wallet not found'; END IF;
    IF v_sender_status   <> 'ACTIVE' THEN RAISE EXCEPTION 'Your wallet is % and cannot send funds',      v_sender_status;   END IF;
    IF v_receiver_status <> 'ACTIVE' THEN RAISE EXCEPTION 'Recipient wallet is % and cannot receive funds', v_receiver_status; END IF;
    IF v_sender_balance < p_amount   THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

    UPDATE public.wallets SET balance_cached = balance_cached - p_amount, updated_at = now()
        WHERE id = p_sender_wallet   RETURNING balance_cached INTO v_sender_balance;
    UPDATE public.wallets SET balance_cached = balance_cached + p_amount, updated_at = now()
        WHERE id = p_receiver_wallet RETURNING balance_cached INTO v_receiver_balance;

    INSERT INTO public.wallet_transactions
        (wallet_id, transaction_type, direction, amount, balance_after, related_wallet_id, transfer_group_id)
    VALUES
        (p_sender_wallet,   'TRANSFER', 'DEBIT',  p_amount, v_sender_balance,   p_receiver_wallet, v_group_id),
        (p_receiver_wallet, 'TRANSFER', 'CREDIT', p_amount, v_receiver_balance, p_sender_wallet,   v_group_id);

    RETURN QUERY SELECT v_sender_balance, v_receiver_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_transfer(UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_transfer(UUID, UUID, NUMERIC) TO authenticated;


-- ── wallet_submit_top_up_request ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_submit_top_up_request(
    p_wallet_id         UUID,
    p_amount            NUMERIC,
    p_payment_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_member_id  UUID;
    v_request_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    SELECT member_id INTO v_member_id FROM public.wallets WHERE id = p_wallet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wallet % not found', p_wallet_id; END IF;
    IF v_member_id <> auth.uid() THEN
        RAISE EXCEPTION 'Not authorized: wallet does not belong to current user';
    END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'Top-up amount must be positive'; END IF;

    INSERT INTO public.top_up_requests (wallet_id, member_id, amount, payment_reference)
    VALUES (p_wallet_id, auth.uid(), p_amount, p_payment_reference)
    RETURNING id INTO v_request_id;

    RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) TO authenticated;


-- ── wallet_approve_top_up ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_approve_top_up(p_request_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet_id     UUID;
    v_member_id     UUID;
    v_amount        NUMERIC;
    v_status_req    TEXT;
    v_wallet_status TEXT;
    v_new_balance   NUMERIC;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN RAISE EXCEPTION 'Not authorized: admin role required'; END IF;
    PERFORM public.assert_aal2();

    SELECT wallet_id, member_id, amount, status
    INTO   v_wallet_id, v_member_id, v_amount, v_status_req
    FROM   public.top_up_requests WHERE id = p_request_id FOR UPDATE;

    IF NOT FOUND     THEN RAISE EXCEPTION 'Top-up request % not found', p_request_id; END IF;
    IF v_status_req <> 'PENDING' THEN RAISE EXCEPTION 'Request is already % — cannot approve', v_status_req; END IF;

    SELECT status INTO v_wallet_status FROM public.wallets WHERE id = v_wallet_id FOR UPDATE;
    IF v_wallet_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Wallet is % — cannot credit a non-active wallet', v_wallet_status;
    END IF;

    UPDATE public.wallets
    SET balance_cached = balance_cached + v_amount, updated_at = now()
    WHERE id = v_wallet_id
    RETURNING balance_cached INTO v_new_balance;

    INSERT INTO public.wallet_transactions (
        wallet_id, transaction_type, direction, amount,
        balance_after, reason, actor_type, actor_id
    ) VALUES (
        v_wallet_id, 'TOP_UP', 'CREDIT', v_amount,
        v_new_balance, 'Top-up approved by admin', 'ADMIN', auth.uid()
    );

    UPDATE public.top_up_requests
    SET status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_request_id;

    RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_approve_top_up(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_approve_top_up(UUID) TO authenticated;


-- ── wallet_reject_top_up ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_reject_top_up(
    p_request_id UUID,
    p_note       TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_status TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN RAISE EXCEPTION 'Not authorized: admin role required'; END IF;
    PERFORM public.assert_aal2();

    SELECT status INTO v_status FROM public.top_up_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND      THEN RAISE EXCEPTION 'Top-up request % not found', p_request_id; END IF;
    IF v_status <> 'PENDING' THEN RAISE EXCEPTION 'Request is already % — cannot reject', v_status; END IF;

    UPDATE public.top_up_requests
    SET status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), rejection_note = p_note
    WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_reject_top_up(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_reject_top_up(UUID, TEXT) TO authenticated;


-- ── wallet_admin_adjust ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_admin_adjust(
    p_wallet_id UUID, p_amount NUMERIC, p_direction TEXT, p_reason TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_balance NUMERIC;
    v_wallet_status   TEXT;
    v_new_balance     NUMERIC;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN RAISE EXCEPTION 'Not authorized: admin adjustment requires an admin account'; END IF;
    PERFORM public.assert_aal2();

    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Adjustment reason is required'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Adjustment amount must be positive'; END IF;
    IF p_direction NOT IN ('CREDIT', 'DEBIT') THEN RAISE EXCEPTION 'Direction must be CREDIT or DEBIT'; END IF;

    SELECT balance_cached, status INTO v_current_balance, v_wallet_status
    FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Wallet % not found', p_wallet_id; END IF;
    IF v_wallet_status = 'CLOSED' THEN RAISE EXCEPTION 'Cannot adjust a CLOSED wallet'; END IF;

    IF p_direction = 'CREDIT' THEN
        v_new_balance := v_current_balance + p_amount;
    ELSE
        v_new_balance := v_current_balance - p_amount;
    END IF;

    IF v_new_balance < 0 THEN RAISE EXCEPTION 'Balance cannot be negative after adjustment'; END IF;

    UPDATE public.wallets SET balance_cached = v_new_balance, updated_at = now() WHERE id = p_wallet_id;

    INSERT INTO public.wallet_transactions (
        wallet_id, transaction_type, direction, amount,
        balance_after, reason, actor_type, actor_id
    ) VALUES (
        p_wallet_id, 'ADMIN_ADJUSTMENT', p_direction, p_amount,
        v_new_balance, trim(p_reason), 'ADMIN', auth.uid()
    );

    RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) TO authenticated;


-- ── post_publish ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.post_publish(p_title TEXT, p_content TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_fee           NUMERIC;
    v_wallet_id     UUID;
    v_wallet_status TEXT;
    v_balance       NUMERIC;
    v_new_balance   NUMERIC;
    v_post_id       BIGINT;
    v_status        TEXT;
    v_fee_charged   NUMERIC := 0;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    SELECT value::NUMERIC INTO v_fee FROM public.platform_settings WHERE key = 'post_publish_fee';
    v_fee := COALESCE(v_fee, 0);

    IF v_fee > 0 THEN
        SELECT id, balance_cached, status INTO v_wallet_id, v_balance, v_wallet_status
        FROM public.wallets WHERE member_id = auth.uid() FOR UPDATE;

        IF NOT FOUND OR v_wallet_status <> 'ACTIVE' OR v_balance < v_fee THEN
            v_status := 'DRAFT';
        ELSE
            v_new_balance := v_balance - v_fee;
            UPDATE public.wallets SET balance_cached = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
            INSERT INTO public.wallet_transactions (
                wallet_id, transaction_type, direction, amount,
                balance_after, reason, actor_type, actor_id
            ) VALUES (
                v_wallet_id, 'POST_PUBLISH_FEE', 'DEBIT', v_fee,
                v_new_balance, 'Platform fee for publishing post', 'SYSTEM', auth.uid()
            );
            v_fee_charged := v_fee;
            v_status      := 'PUBLISHED';
        END IF;
    ELSE
        v_status := 'PUBLISHED';
    END IF;

    INSERT INTO public.posts (user_id, title, content, status)
    VALUES (auth.uid(), p_title, p_content, v_status)
    RETURNING id INTO v_post_id;

    RETURN jsonb_build_object(
        'post_id',     v_post_id,
        'status',      v_status,
        'fee_charged', v_fee_charged,
        'new_balance', COALESCE(v_new_balance, v_balance, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.post_publish(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.post_publish(TEXT, TEXT) TO authenticated;
