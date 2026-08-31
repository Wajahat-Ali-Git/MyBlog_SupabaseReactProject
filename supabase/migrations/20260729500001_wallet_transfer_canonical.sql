-- ============================================================
-- Canonical wallet_transfer
--
-- 20260729500000_admin_adjust_audit_constraint.sql added
-- actor_type/actor_id to the ledger rows, but forked from an
-- older copy of the function (20260729300000) that pre-dated
-- the status guard added in 20260729300001.
-- CREATE OR REPLACE fully replaced the function body, silently
-- dropping:
--   • SUSPENDED/CLOSED wallet guard
--   • SET search_path = public, pg_temp
--   • assert_aal2() call (added by 20260729400001)
--
-- This migration is the single authoritative version of
-- wallet_transfer. It includes every guard in order:
--   1. Authentication
--   2. AAL2 / MFA step-up
--   3. Sender wallet ownership
--   4. 2-decimal-place amount
--   5. Positive amount
--   6. Same-wallet self-transfer prevention
--   7. SUSPENDED / CLOSED status guard on both wallets
--   8. Sufficient balance
--   9. Atomic balance update + dual ledger rows with actor_id
-- ============================================================

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
    v_sender_balance   NUMERIC;
    v_receiver_balance NUMERIC;
    v_sender_status    TEXT;
    v_receiver_status  TEXT;
    v_group_id         UUID;
BEGIN
    -- 1. Authentication
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- 2. MFA step-up (no-op when user has no enrolled TOTP factor)
    PERFORM public.assert_aal2();

    -- 3. Sender wallet ownership
    IF NOT EXISTS (
        SELECT 1 FROM public.wallets
        WHERE id = p_sender_wallet AND member_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized: you do not own the sender wallet';
    END IF;

    -- 4. 2-decimal-place guard (NUMERIC(12,2) param silently truncates)
    IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'Amount must have at most 2 decimal places';
    END IF;

    -- 5. Positive amount
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    -- 6. Self-transfer prevention
    IF p_sender_wallet = p_receiver_wallet THEN
        RAISE EXCEPTION 'Cannot transfer to the same wallet';
    END IF;

    v_group_id := gen_random_uuid();

    -- Lock both rows in a consistent order to prevent deadlocks
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

    -- 7. Wallet status guard
    IF v_sender_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Your wallet is % and cannot send funds', v_sender_status;
    END IF;
    IF v_receiver_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Recipient wallet is % and cannot receive funds', v_receiver_status;
    END IF;

    -- 8. Sufficient balance
    IF v_sender_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    -- 9. Atomic balance update
    UPDATE public.wallets
        SET balance_cached = balance_cached - p_amount, updated_at = now()
        WHERE id = p_sender_wallet
        RETURNING balance_cached INTO v_sender_balance;

    UPDATE public.wallets
        SET balance_cached = balance_cached + p_amount, updated_at = now()
        WHERE id = p_receiver_wallet
        RETURNING balance_cached INTO v_receiver_balance;

    -- Dual ledger rows with actor tracking
    INSERT INTO public.wallet_transactions
        (wallet_id, transaction_type, direction, amount, balance_after,
         related_wallet_id, transfer_group_id, actor_type, actor_id)
    VALUES
        (p_sender_wallet,   'TRANSFER', 'DEBIT',  p_amount, v_sender_balance,
         p_receiver_wallet, v_group_id, 'USER', auth.uid()),
        (p_receiver_wallet, 'TRANSFER', 'CREDIT', p_amount, v_receiver_balance,
         p_sender_wallet,   v_group_id, 'USER', auth.uid());

    RETURN QUERY SELECT v_sender_balance, v_receiver_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_transfer(UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_transfer(UUID, UUID, NUMERIC) TO authenticated;
