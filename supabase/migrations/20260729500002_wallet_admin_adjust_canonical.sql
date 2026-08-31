-- ============================================================
-- Canonical wallet_admin_adjust
--
-- 20260729500000_admin_adjust_audit_constraint.sql (which added
-- actor_type/actor_id auditing and the 2dp guard) runs AFTER
-- 20260729400001_mfa_aal2_enforcement.sql in migration order, and
-- CREATE OR REPLACE fully replaced the function body — silently
-- dropping the assert_aal2() call and the CLOSED-wallet guard that
-- 400001 had added. Same class of bug as the wallet_transfer
-- regression fixed by 20260729500001.
--
-- This migration is the single authoritative version of
-- wallet_admin_adjust. It includes every guard in order:
--   1. Admin role check
--   2. AAL2 / MFA step-up
--   3. Reason required (non-empty after trim)
--   4. 2-decimal-place amount
--   5. Positive amount
--   6. Direction must be CREDIT or DEBIT
--   7. Wallet exists / not CLOSED
--   8. Resulting balance cannot go negative
--   9. Atomic balance update + ledger row with actor_id/actor_type
-- ============================================================

CREATE OR REPLACE FUNCTION public.wallet_admin_adjust(
    p_wallet_id UUID,
    p_amount    NUMERIC,
    p_direction TEXT,
    p_reason    TEXT
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
    -- 1. Admin role check
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin adjustment requires an admin account';
    END IF;

    -- 2. MFA step-up (no-op when the admin has no enrolled TOTP factor)
    PERFORM public.assert_aal2();

    -- 3. Reason required
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'A reason is required for admin adjustments';
    END IF;

    -- 4. 2-decimal-place guard (NUMERIC param silently truncates otherwise)
    IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'Amount must have at most 2 decimal places';
    END IF;

    -- 5. Positive amount
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Adjustment amount must be positive';
    END IF;

    -- 6. Direction
    IF p_direction NOT IN ('CREDIT', 'DEBIT') THEN
        RAISE EXCEPTION 'Direction must be CREDIT or DEBIT';
    END IF;

    SELECT balance_cached, status INTO v_current_balance, v_wallet_status
    FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

    -- 7. Wallet exists / not CLOSED
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;
    IF v_wallet_status = 'CLOSED' THEN
        RAISE EXCEPTION 'Cannot adjust a CLOSED wallet';
    END IF;

    IF p_direction = 'CREDIT' THEN
        v_new_balance := v_current_balance + p_amount;
    ELSE
        v_new_balance := v_current_balance - p_amount;
    END IF;

    -- 8. Resulting balance cannot go negative
    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Balance cannot be negative after adjustment';
    END IF;

    -- 9. Atomic balance update + audited ledger row
    UPDATE public.wallets
    SET balance_cached = v_new_balance, updated_at = now()
    WHERE id = p_wallet_id;

    INSERT INTO public.wallet_transactions (
        wallet_id, transaction_type, direction, amount,
        balance_after, reason, actor_type, actor_id
    ) VALUES (
        p_wallet_id, 'ADMIN_ADJUSTMENT', p_direction, p_amount,
        v_new_balance, btrim(p_reason), 'ADMIN', auth.uid()
    );

    RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_admin_adjust(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
