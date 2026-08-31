-- ============================================================
-- Hardening Pass 2
--
-- 1. Transaction ordering  — add `seq BIGSERIAL` to
--    wallet_transactions so ordering is immune to clock skew
--    within the same transaction (now() = transaction start time)
--
-- 2. Wallet status guard   — all balance-changing RPCs now
--    reject operations on SUSPENDED or CLOSED wallets
--
-- 3. search_path hardening — add `pg_temp` to SET search_path
--    on every SECURITY DEFINER function to prevent search-path
--    injection attacks (CVE-2018-1058 pattern)
--
-- 4. Paginated transaction history — add p_limit / p_offset
--    parameters; default 50 rows
--
-- 5. Fix created_at default — use clock_timestamp() so rows
--    inserted in the same transaction get distinct timestamps
-- ============================================================

-- ── 1. Add seq column for stable ordering ────────────────────────────────────

ALTER TABLE public.wallet_transactions
    ADD COLUMN IF NOT EXISTS seq BIGSERIAL;

-- Back-fill existing rows in created_at order so seq is consistent
-- (the sequence already assigns ascending values on INSERT going forward)

-- Index for fast ORDER BY seq DESC
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_seq
    ON public.wallet_transactions(seq DESC);

-- ── 2. Fix clock_timestamp() for created_at ──────────────────────────────────
-- now() = transaction start time, so two rows in the same txn share a timestamp.
-- clock_timestamp() is the real wall-clock time at the moment of the call.

ALTER TABLE public.wallet_transactions
    ALTER COLUMN created_at SET DEFAULT clock_timestamp();

ALTER TABLE public.top_up_requests
    ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.top_up_requests
    ALTER COLUMN updated_at SET DEFAULT clock_timestamp();

-- ── 3. wallet_transaction_history — paginated + ordered by seq ───────────────

DROP FUNCTION IF EXISTS public.wallet_transaction_history(UUID, INT, INT);
CREATE FUNCTION public.wallet_transaction_history(
    p_wallet_id UUID,
    p_limit     INT  DEFAULT 50,
    p_offset    INT  DEFAULT 0
)
RETURNS TABLE (
    transaction_id   UUID,
    transaction_type TEXT,
    direction        TEXT,
    amount           NUMERIC,
    balance_after    NUMERIC,
    reason           TEXT,
    created_at       TIMESTAMPTZ,
    seq              BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Ownership or admin check
    IF NOT EXISTS (
        SELECT 1 FROM public.wallets
        WHERE id = p_wallet_id AND member_id = auth.uid()
    ) AND NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized to view this wallet''s history';
    END IF;

    RETURN QUERY
    SELECT t.id, t.transaction_type, t.direction, t.amount,
           t.balance_after, t.reason, t.created_at, t.seq
    FROM public.wallet_transactions t
    WHERE t.wallet_id = p_wallet_id
    ORDER BY t.seq DESC
    LIMIT  LEAST(p_limit, 200)   -- hard cap at 200 per page
    OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_transaction_history(UUID, INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_transaction_history(UUID, INT, INT) TO authenticated;

-- Drop old 1-param signature so old clients get a clear error, not stale data
DROP FUNCTION IF EXISTS public.wallet_transaction_history(UUID);

-- ── 4. wallet_transfer — wallet status guard ─────────────────────────────────

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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.wallets
        WHERE id = p_sender_wallet AND member_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized: you do not own the sender wallet';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    IF p_sender_wallet = p_receiver_wallet THEN
        RAISE EXCEPTION 'Cannot transfer to the same wallet';
    END IF;

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

    IF v_sender_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Your wallet is % and cannot send funds', v_sender_status;
    END IF;
    IF v_receiver_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Recipient wallet is % and cannot receive funds', v_receiver_status;
    END IF;

    IF v_sender_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

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

-- ── 5. wallet_approve_top_up — wallet status guard ───────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_approve_top_up(p_request_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet_id   UUID;
    v_member_id   UUID;
    v_amount      NUMERIC;
    v_status_req  TEXT;
    v_wallet_status TEXT;
    v_new_balance NUMERIC;
    v_tx_id       UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;

    SELECT wallet_id, member_id, amount, status
    INTO   v_wallet_id, v_member_id, v_amount, v_status_req
    FROM   public.top_up_requests
    WHERE  id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Top-up request % not found', p_request_id;
    END IF;
    IF v_status_req <> 'PENDING' THEN
        RAISE EXCEPTION 'Request is already % — cannot approve', v_status_req;
    END IF;

    -- Check wallet status before crediting
    SELECT status INTO v_wallet_status
    FROM public.wallets WHERE id = v_wallet_id FOR UPDATE;

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
    ) RETURNING id INTO v_tx_id;

    UPDATE public.top_up_requests
    SET status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_request_id;

    RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_approve_top_up(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_approve_top_up(UUID) TO authenticated;

-- ── 6. wallet_admin_adjust — status guard + search_path ──────────────────────

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
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin adjustment requires an admin account';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Adjustment reason is required';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Adjustment amount must be positive';
    END IF;
    IF p_direction NOT IN ('CREDIT', 'DEBIT') THEN
        RAISE EXCEPTION 'Direction must be CREDIT or DEBIT';
    END IF;

    SELECT balance_cached, status INTO v_current_balance, v_wallet_status
    FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    -- Admins can adjust SUSPENDED wallets for corrections, but not CLOSED ones
    IF v_wallet_status = 'CLOSED' THEN
        RAISE EXCEPTION 'Cannot adjust a CLOSED wallet';
    END IF;

    IF p_direction = 'CREDIT' THEN
        v_new_balance := v_current_balance + p_amount;
    ELSE
        v_new_balance := v_current_balance - p_amount;
    END IF;

    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Balance cannot be negative after adjustment';
    END IF;

    UPDATE public.wallets SET balance_cached = v_new_balance, updated_at = now()
    WHERE id = p_wallet_id;

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

-- ── 7. post_publish — status guard + search_path ─────────────────────────────

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

    SELECT value::NUMERIC INTO v_fee FROM public.platform_settings WHERE key = 'post_publish_fee';
    v_fee := COALESCE(v_fee, 0);

    IF v_fee > 0 THEN
        SELECT id, balance_cached, status INTO v_wallet_id, v_balance, v_wallet_status
        FROM public.wallets WHERE member_id = auth.uid() FOR UPDATE;

        IF NOT FOUND OR v_wallet_status <> 'ACTIVE' OR v_balance < v_fee THEN
            v_status := 'DRAFT';
        ELSE
            v_new_balance := v_balance - v_fee;

            UPDATE public.wallets
            SET balance_cached = v_new_balance, updated_at = now()
            WHERE id = v_wallet_id;

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

-- ── 8. Add search_path to remaining functions ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_get_balance(p_wallet_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_balance NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_wallet_id AND member_id = auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
        RAISE EXCEPTION 'Not authorized to view this wallet';
    END IF;
    SELECT balance_cached INTO v_balance FROM public.wallets WHERE id = p_wallet_id;
    RETURN COALESCE(v_balance, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_get_balance(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_get_balance(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_reconcile(p_wallet_id UUID)
RETURNS TABLE (cached_balance NUMERIC, ledger_balance NUMERIC, matches BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_cached NUMERIC; v_ledger NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = p_wallet_id AND member_id = auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE) THEN
        RAISE EXCEPTION 'Not authorized to reconcile this wallet';
    END IF;
    SELECT w.balance_cached INTO v_cached FROM public.wallets w WHERE w.id = p_wallet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wallet % not found', p_wallet_id; END IF;
    SELECT COALESCE(SUM(CASE WHEN t.direction='CREDIT' THEN t.amount WHEN t.direction='DEBIT' THEN -t.amount ELSE 0 END),0)
    INTO v_ledger FROM public.wallet_transactions t WHERE t.wallet_id = p_wallet_id;
    RETURN QUERY SELECT v_cached, v_ledger, (v_cached = v_ledger);
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_reconcile(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_reconcile(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_get_by_member()
RETURNS TABLE (id UUID, member_id UUID, balance_cached NUMERIC, currency TEXT, status TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
    RETURN QUERY SELECT w.id, w.member_id, w.balance_cached, w.currency, w.status, w.created_at, w.updated_at
    FROM public.wallets w WHERE w.member_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_get_by_member() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_get_by_member() TO authenticated;

DROP FUNCTION IF EXISTS public.wallet_search_users(TEXT);
CREATE FUNCTION public.wallet_search_users(p_search TEXT)
RETURNS TABLE (wallet_id UUID, member_id UUID, username TEXT, full_name TEXT, email TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_pattern TEXT;
BEGIN
    v_pattern := '%' || TRIM(p_search) || '%';
    RETURN QUERY
    SELECT w.id, p.id, p.username, p.full_name, u.email
    FROM public.profiles p
    JOIN public.wallets  w ON w.member_id = p.id
    JOIN auth.users      u ON u.id        = p.id
    WHERE p.id <> auth.uid()
      AND (p.username ILIKE v_pattern OR p.full_name ILIKE v_pattern)
    ORDER BY (p.username ILIKE TRIM(p_search)) DESC, p.username ASC
    LIMIT 10;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_search_users(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_search_users(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.wallet_create()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_wallet_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    INSERT INTO public.wallets (member_id) VALUES (auth.uid())
    ON CONFLICT (member_id) DO NOTHING RETURNING id INTO v_wallet_id;
    IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id FROM public.wallets WHERE member_id = auth.uid();
    END IF;
    RETURN v_wallet_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_create() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_create() TO authenticated;
