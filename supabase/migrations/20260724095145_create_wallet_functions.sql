-- create wallet for user
CREATE OR REPLACE FUNCTION public.wallet_create(
    p_member_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_wallet_id UUID;
BEGIN
    INSERT INTO public.wallets (member_id)
    VALUES (p_member_id)
    RETURNING id INTO v_wallet_id;

    RETURN v_wallet_id;
END;
$$;

-- get user ballance for user
CREATE OR REPLACE FUNCTION public.wallet_get_balance(
    p_wallet_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_balance NUMERIC;
BEGIN
    SELECT balance_cached
    INTO v_balance
    FROM public.wallets
    WHERE id = p_wallet_id;

    RETURN COALESCE(v_balance, 0);
END;
$$;

-- wallet top up / credit the wallet
CREATE OR REPLACE FUNCTION public.wallet_top_up(
    p_wallet_id UUID,
    p_amount NUMERIC
)
RETURNS TABLE (
    wallet_id UUID,
    new_balance NUMERIC,
    transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_balance NUMERIC;
    v_tx_id UUID;
BEGIN
    -- Check amount is positive
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Top up amount must be positive';
    END IF;

    -- Update wallet balance
    UPDATE public.wallets
    SET balance_cached = balance_cached + p_amount,
        updated_at = now()
    WHERE id = p_wallet_id
    RETURNING balance_cached INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    -- Create transaction record
    INSERT INTO public.wallet_transactions (
        wallet_id,
        transaction_type,
        direction,
        amount,
        balance_after
    )
    VALUES (
        p_wallet_id,
        'TOP_UP',
        'CREDIT',
        p_amount,
        v_new_balance
    )
    RETURNING id INTO v_tx_id;

    RETURN QUERY SELECT p_wallet_id, v_new_balance, v_tx_id;
END;
$$;

-- transfer the wallet coins to another user
CREATE OR REPLACE FUNCTION public.wallet_transfer(
    p_sender_wallet UUID,
    p_receiver_wallet UUID,
    p_amount NUMERIC
)
RETURNS TABLE (
    sender_balance NUMERIC,
    receiver_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sender_balance NUMERIC;
    v_receiver_balance NUMERIC;
    v_group_id UUID;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive';
    END IF;

    IF p_sender_wallet = p_receiver_wallet THEN
        RAISE EXCEPTION 'Cannot transfer to the same wallet';
    END IF;

    -- Generate a unique group ID for linking the transfer transactions
    v_group_id := gen_random_uuid();

    -- Lock both rows in a consistent order to prevent deadlocks
    IF p_sender_wallet < p_receiver_wallet THEN
        SELECT balance_cached INTO v_sender_balance FROM public.wallets WHERE id = p_sender_wallet FOR UPDATE;
        SELECT balance_cached INTO v_receiver_balance FROM public.wallets WHERE id = p_receiver_wallet FOR UPDATE;
    ELSE
        SELECT balance_cached INTO v_receiver_balance FROM public.wallets WHERE id = p_receiver_wallet FOR UPDATE;
        SELECT balance_cached INTO v_sender_balance FROM public.wallets WHERE id = p_sender_wallet FOR UPDATE;
    END IF;

    -- Check if sender has enough balance
    IF v_sender_balance IS NULL THEN
        RAISE EXCEPTION 'Sender wallet not found';
    END IF;
    IF v_receiver_balance IS NULL THEN
        RAISE EXCEPTION 'Receiver wallet not found';
    END IF;
    IF v_sender_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    -- Perform the balance updates
    UPDATE public.wallets
    SET balance_cached = balance_cached - p_amount,
        updated_at = now()
    WHERE id = p_sender_wallet
    RETURNING balance_cached INTO v_sender_balance;

    UPDATE public.wallets
    SET balance_cached = balance_cached + p_amount,
        updated_at = now()
    WHERE id = p_receiver_wallet
    RETURNING balance_cached INTO v_receiver_balance;

    -- Create sender transaction (DEBIT)
    INSERT INTO public.wallet_transactions (
        wallet_id,
        transaction_type,
        direction,
        amount,
        balance_after,
        related_wallet_id,
        transfer_group_id
    )
    VALUES (
        p_sender_wallet,
        'TRANSFER',
        'DEBIT',
        p_amount,
        v_sender_balance,
        p_receiver_wallet,
        v_group_id
    );

    -- Create receiver transaction (CREDIT)
    INSERT INTO public.wallet_transactions (
        wallet_id,
        transaction_type,
        direction,
        amount,
        balance_after,
        related_wallet_id,
        transfer_group_id
    )
    VALUES (
        p_receiver_wallet,
        'TRANSFER',
        'CREDIT',
        p_amount,
        v_receiver_balance,
        p_sender_wallet,
        v_group_id
    );

    RETURN QUERY SELECT v_sender_balance, v_receiver_balance;
END;
$$;

-- admin adjust the wallet of other users
CREATE OR REPLACE FUNCTION public.wallet_admin_adjust(
    p_wallet_id UUID,
    p_amount NUMERIC,
    p_direction TEXT,
    p_reason TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_balance NUMERIC;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Adjustment amount must be positive';
    END IF;

    IF p_direction NOT IN ('CREDIT', 'DEBIT') THEN
        RAISE EXCEPTION 'Direction must be CREDIT or DEBIT';
    END IF;

    -- Adjust balance based on direction
    IF p_direction = 'CREDIT' THEN
        UPDATE public.wallets
        SET balance_cached = balance_cached + p_amount,
            updated_at = now()
        WHERE id = p_wallet_id
        RETURNING balance_cached INTO v_new_balance;
    ELSE
        UPDATE public.wallets
        SET balance_cached = balance_cached - p_amount,
            updated_at = now()
        WHERE id = p_wallet_id
        RETURNING balance_cached INTO v_new_balance;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    -- Check if balance is not negative
    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Balance cannot be negative after adjustment';
    END IF;

    -- Create transaction record
    INSERT INTO public.wallet_transactions (
        wallet_id,
        transaction_type,
        direction,
        amount,
        balance_after,
        reason
    )
    VALUES (
        p_wallet_id,
        'ADMIN_ADJUSTMENT',
        p_direction,
        p_amount,
        v_new_balance,
        p_reason
    );

    RETURN v_new_balance;
END;
$$;

-- transaction history of user
CREATE OR REPLACE FUNCTION public.wallet_transaction_history(
    p_wallet_id UUID
)
RETURNS TABLE (
    transaction_id UUID,
    transaction_type TEXT,
    direction TEXT,
    amount NUMERIC,
    balance_after NUMERIC,
    reason TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.transaction_type,
        t.direction,
        t.amount,
        t.balance_after,
        t.reason,
        t.created_at
    FROM public.wallet_transactions t
    WHERE t.wallet_id = p_wallet_id
    ORDER BY t.created_at DESC;
END;
$$;

-- wallet reconsile / check the tranaction history to verify ledger balance = cached balance
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
BEGIN
    -- Get cached balance
    SELECT w.balance_cached INTO v_cached FROM public.wallets w WHERE w.id = p_wallet_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    -- Calculate ledger balance from transactions
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

CREATE OR REPLACE FUNCTION public.wallet_get_by_member()
RETURNS TABLE (
    id UUID,
    member_id UUID,
    balance_cached NUMERIC,
    currency TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        w.id,
        w.member_id,
        w.balance_cached,
        w.currency,
        w.status,
        w.created_at,
        w.updated_at
    FROM public.wallets w
    WHERE w.member_id = auth.uid();
END;
$$;