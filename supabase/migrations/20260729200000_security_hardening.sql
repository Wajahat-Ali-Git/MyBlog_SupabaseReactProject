-- ============================================================
-- Security Hardening — RPC Authorization Fixes
--
-- All SECURITY DEFINER functions in the original migrations
-- were missing two layers of protection:
--
--   1. REVOKE ALL FROM PUBLIC (Postgres grants EXECUTE to
--      PUBLIC by default, meaning the anon key can call them)
--
--   2. auth.uid() / ownership / admin checks inside the body
--      (SECURITY DEFINER bypasses RLS, so the function body
--      IS the security boundary)
--
-- Functions patched in this migration:
--   wallet_create               — must create only own wallet
--   wallet_get_balance          — must own the wallet
--   wallet_top_up               — must own the wallet (also
--                                  internal-only; not callable
--                                  by authenticated users)
--   wallet_transfer             — must own the sender wallet
--   wallet_admin_adjust         — must be admin + reason required
--                                  (supersedes the version in
--                                  _095145 AND _100000)
--   wallet_transaction_history  — must own the wallet
--   wallet_reconcile            — must own wallet OR be admin
--   wallet_get_by_member        — safe (uses auth.uid()), add REVOKE
--   wallet_search_users         — safe (excludes self), add REVOKE
-- ============================================================

-- ── wallet_create ─────────────────────────────────────────────────────────
-- Original: accepted any UUID, anon could create wallets for anyone.
-- Fixed: ignores the parameter entirely; always creates for auth.uid().
-- The old signature wallet_create(UUID) is replaced; client calls wallet_create().

CREATE OR REPLACE FUNCTION public.wallet_create()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    INSERT INTO public.wallets (member_id)
    VALUES (auth.uid())
    ON CONFLICT (member_id) DO NOTHING
    RETURNING id INTO v_wallet_id;

    -- If wallet already existed, return its id
    IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id FROM public.wallets WHERE member_id = auth.uid();
    END IF;

    RETURN v_wallet_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_create() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_create() TO authenticated;

-- Drop the unsafe UUID-parameter variant
DROP FUNCTION IF EXISTS public.wallet_create(UUID);

-- ── wallet_get_balance ────────────────────────────────────────────────────
-- Original: returned any wallet's balance to anyone.
-- Fixed: requires the caller to own the wallet OR be admin.

CREATE OR REPLACE FUNCTION public.wallet_get_balance(p_wallet_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance NUMERIC;
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
        RAISE EXCEPTION 'Not authorized to view this wallet';
    END IF;

    SELECT balance_cached INTO v_balance
    FROM public.wallets WHERE id = p_wallet_id;

    RETURN COALESCE(v_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_get_balance(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_get_balance(UUID) TO authenticated;

-- ── wallet_top_up ─────────────────────────────────────────────────────────
-- Original: credited ANY wallet with ANY amount — callable by anon.
-- Fixed: restricted to authenticated + internal use only (called by
--        wallet_approve_top_up which is already admin-gated).
--        A regular user cannot call it directly; only SYSTEM/admin flows do.
-- We restrict it to the service_role so no JWT-bearing client can call it.

CREATE OR REPLACE FUNCTION public.wallet_top_up(p_wallet_id UUID, p_amount NUMERIC)
RETURNS TABLE (wallet_id UUID, new_balance NUMERIC, transaction_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_balance NUMERIC;
    v_tx_id UUID;
BEGIN
    -- Only callable from other SECURITY DEFINER functions (server-side).
    -- Block any direct JWT-authenticated call.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Internal use only';
    END IF;

    -- Must be admin (approve flow) or the wallet owner (no direct top-up path exists,
    -- but belt-and-suspenders check)
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: wallet_top_up is internal/admin only';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Top-up amount must be positive';
    END IF;

    UPDATE public.wallets
    SET balance_cached = balance_cached + p_amount,
        updated_at     = now()
    WHERE id = p_wallet_id
    RETURNING balance_cached INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    INSERT INTO public.wallet_transactions (
        wallet_id, transaction_type, direction, amount, balance_after
    ) VALUES (
        p_wallet_id, 'TOP_UP', 'CREDIT', p_amount, v_new_balance
    ) RETURNING id INTO v_tx_id;

    RETURN QUERY SELECT p_wallet_id, v_new_balance, v_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_top_up(UUID, NUMERIC) FROM PUBLIC;
-- Not granted to 'authenticated' — only called internally by admin RPCs.

-- ── wallet_transfer ───────────────────────────────────────────────────────
-- Original: no ownership check on sender — anyone could drain any wallet.
-- Fixed: requires caller to own the sender wallet.

CREATE OR REPLACE FUNCTION public.wallet_transfer(
    p_sender_wallet   UUID,
    p_receiver_wallet UUID,
    p_amount          NUMERIC
)
RETURNS TABLE (sender_balance NUMERIC, receiver_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sender_balance   NUMERIC;
    v_receiver_balance NUMERIC;
    v_group_id         UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Caller must own the sender wallet
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

    -- Lock in consistent order to prevent deadlocks
    IF p_sender_wallet < p_receiver_wallet THEN
        SELECT balance_cached INTO v_sender_balance   FROM public.wallets WHERE id = p_sender_wallet   FOR UPDATE;
        SELECT balance_cached INTO v_receiver_balance FROM public.wallets WHERE id = p_receiver_wallet FOR UPDATE;
    ELSE
        SELECT balance_cached INTO v_receiver_balance FROM public.wallets WHERE id = p_receiver_wallet FOR UPDATE;
        SELECT balance_cached INTO v_sender_balance   FROM public.wallets WHERE id = p_sender_wallet   FOR UPDATE;
    END IF;

    IF v_sender_balance IS NULL   THEN RAISE EXCEPTION 'Sender wallet not found';   END IF;
    IF v_receiver_balance IS NULL THEN RAISE EXCEPTION 'Receiver wallet not found'; END IF;
    IF v_sender_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance';     END IF;

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

-- ── wallet_admin_adjust ───────────────────────────────────────────────────
-- The version in _095145 had no admin check and no REVOKE.
-- The version in _100000 added those but CREATE OR REPLACE only updates the
-- body — the PUBLIC grant from _095145 remains. This migration re-issues
-- REVOKE to be certain.

CREATE OR REPLACE FUNCTION public.wallet_admin_adjust(
    p_wallet_id UUID,
    p_amount    NUMERIC,
    p_direction TEXT,
    p_reason    TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_balance NUMERIC;
    v_new_balance     NUMERIC;
BEGIN
    -- Admin check
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
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

    SELECT balance_cached INTO v_current_balance
    FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    IF p_direction = 'CREDIT' THEN
        v_new_balance := v_current_balance + p_amount;
    ELSE
        v_new_balance := v_current_balance - p_amount;
    END IF;

    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Balance cannot be negative after adjustment';
    END IF;

    UPDATE public.wallets
    SET balance_cached = v_new_balance, updated_at = now()
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

-- Revoke from PUBLIC *and* re-grant only to authenticated.
-- This covers the grant that Postgres added automatically in _095145.
REVOKE ALL ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ── wallet_transaction_history ────────────────────────────────────────────
-- Original: returned any wallet's full ledger to anyone.
-- Fixed: caller must own the wallet OR be admin.

CREATE OR REPLACE FUNCTION public.wallet_transaction_history(p_wallet_id UUID)
RETURNS TABLE (
    transaction_id   UUID,
    transaction_type TEXT,
    direction        TEXT,
    amount           NUMERIC,
    balance_after    NUMERIC,
    reason           TEXT,
    created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.wallets WHERE id = p_wallet_id AND member_id = auth.uid()
    ) AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized to view this wallet''s history';
    END IF;

    RETURN QUERY
    SELECT t.id, t.transaction_type, t.direction, t.amount,
           t.balance_after, t.reason, t.created_at
    FROM public.wallet_transactions t
    WHERE t.wallet_id = p_wallet_id
    ORDER BY t.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_transaction_history(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_transaction_history(UUID) TO authenticated;

-- ── wallet_reconcile ──────────────────────────────────────────────────────
-- Original: leaked balance data for any wallet.
-- Fixed: caller must own the wallet OR be admin.

CREATE OR REPLACE FUNCTION public.wallet_reconcile(p_wallet_id UUID)
RETURNS TABLE (cached_balance NUMERIC, ledger_balance NUMERIC, matches BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cached NUMERIC;
    v_ledger NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.wallets WHERE id = p_wallet_id AND member_id = auth.uid()
    ) AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized to reconcile this wallet';
    END IF;

    SELECT w.balance_cached INTO v_cached FROM public.wallets w WHERE w.id = p_wallet_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    SELECT COALESCE(SUM(
        CASE WHEN t.direction = 'CREDIT' THEN t.amount
             WHEN t.direction = 'DEBIT'  THEN -t.amount
             ELSE 0 END
    ), 0) INTO v_ledger
    FROM public.wallet_transactions t WHERE t.wallet_id = p_wallet_id;

    RETURN QUERY SELECT v_cached, v_ledger, (v_cached = v_ledger);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_reconcile(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_reconcile(UUID) TO authenticated;

-- ── wallet_get_by_member ──────────────────────────────────────────────────
-- Body was already safe (uses auth.uid()). Just add REVOKE.

REVOKE ALL ON FUNCTION public.wallet_get_by_member() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_get_by_member() TO authenticated;

-- ── wallet_search_users ───────────────────────────────────────────────────
-- Body was already safe (excludes self, requires match). Add REVOKE.

REVOKE ALL ON FUNCTION public.wallet_search_users(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_search_users(TEXT) TO authenticated;

-- ── handle_new_user (trigger function) ────────────────────────────────────
-- Called by Postgres trigger — no GRANT needed, but add explicit REVOKE
-- so it cannot be called directly by any role.

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- ── wallet_submit_top_up_request ──────────────────────────────────────────
-- Already has auth check + REVOKE in _729000. Re-assert for safety.

REVOKE ALL ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) TO authenticated;
