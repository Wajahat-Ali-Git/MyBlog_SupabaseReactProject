-- wallet_create previously accepted an arbitrary p_member_id, so any
-- authenticated caller could create a wallet row for someone else's
-- profile. Rebind it to the caller's own auth.uid(), and make it
-- idempotent so "enable wallet" can be safely retried.

DROP FUNCTION IF EXISTS public.wallet_create(UUID);

CREATE OR REPLACE FUNCTION public.wallet_create()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_wallet_id UUID;
BEGIN
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE member_id = auth.uid();

    IF v_wallet_id IS NOT NULL THEN
        RETURN v_wallet_id;
    END IF;

    INSERT INTO public.wallets (member_id)
    VALUES (auth.uid())
    RETURNING id INTO v_wallet_id;

    RETURN v_wallet_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_create() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wallet_create() TO authenticated;
