-- ============================================================
-- Enforce 2-decimal-place amounts on all money-mutating RPCs
--
-- Problem: p_amount NUMERIC has no implicit decimal limit in
-- Postgres — NUMERIC(12,2) in a parameter list is silently
-- ignored.  Sending 0.005 causes balance_cached and the ledger
-- amount to each be rounded to 2dp *separately*, which mints
-- money (0.005 → sender pays 0.00, receiver gains 0.01).
--
-- Fix: explicit guard at the top of every function that writes
-- to the ledger:
--
--   IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
--     RAISE EXCEPTION 'Amount must have at most 2 decimal places';
--   END IF;
--
-- Functions patched here:
--   wallet_transfer      (authenticated-callable, highest risk)
--   wallet_top_up        (internal/admin path)
--   wallet_admin_adjust  (admin-only path)
-- ============================================================

-- ── wallet_transfer ───────────────────────────────────────────────────────────

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

    -- ── 2-decimal-place guard ────────────────────────────────────────────────
    IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'Amount must have at most 2 decimal places';
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

-- REVOKE/GRANT already set by _200000; re-assert for safety.
REVOKE ALL ON FUNCTION public.wallet_transfer(UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_transfer(UUID, UUID, NUMERIC) TO authenticated;

-- ── wallet_top_up ─────────────────────────────────────────────────────────────

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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Internal use only';
    END IF;

    -- Must be admin (approve flow)
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: wallet_top_up is internal/admin only';
    END IF;

    -- ── 2-decimal-place guard ────────────────────────────────────────────────
    IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'Amount must have at most 2 decimal places';
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

-- ── wallet_admin_adjust ───────────────────────────────────────────────────────

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

    -- ── 2-decimal-place guard ────────────────────────────────────────────────
    IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'Amount must have at most 2 decimal places';
    END IF;

    IF p_amount <= 0 THEN
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

REVOKE ALL ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
