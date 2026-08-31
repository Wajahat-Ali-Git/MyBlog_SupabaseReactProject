-- wallet_get_balance and wallet_reconcile are SECURITY DEFINER and accept a
-- bare p_wallet_id with no check that the caller owns that wallet, so any
-- authenticated user could pass someone else's wallet id and read their
-- balance / ledger reconciliation data. Add an ownership check (owner or
-- admin) to both, matching the wallet_create fix in
-- 20260727120000_wallet_create_self_service.sql.

CREATE OR REPLACE FUNCTION public.wallet_get_balance(
    p_wallet_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_balance NUMERIC;
    v_member_id UUID;
BEGIN
    SELECT balance_cached, member_id
    INTO v_balance, v_member_id
    FROM public.wallets
    WHERE id = p_wallet_id;

    IF v_member_id IS NULL THEN
        RETURN 0;
    END IF;

    IF v_member_id <> auth.uid() AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized to view this wallet';
    END IF;

    RETURN COALESCE(v_balance, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_reconcile(
    p_wallet_id UUID
)
RETURNS TABLE (
    cached_balance NUMERIC,
    ledger_balance NUMERIC,
    matches BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cached NUMERIC;
    v_ledger NUMERIC;
    v_member_id UUID;
BEGIN
    SELECT w.balance_cached, w.member_id INTO v_cached, v_member_id
    FROM public.wallets w
    WHERE w.id = p_wallet_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    IF v_member_id <> auth.uid() AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized to view this wallet';
    END IF;

    SELECT COALESCE(SUM(
        CASE
            WHEN t.direction = 'CREDIT' THEN t.amount
            WHEN t.direction = 'DEBIT' THEN -t.amount
            ELSE 0
        END
    ), 0)
    INTO v_ledger
    FROM public.wallet_transactions t
    WHERE t.wallet_id = p_wallet_id;

    RETURN QUERY SELECT v_cached, v_ledger, (v_cached = v_ledger);
END;
$$;
