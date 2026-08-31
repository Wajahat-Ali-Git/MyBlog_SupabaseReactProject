-- ============================================
-- Update updated_at automatically
-- ============================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER wallet_updated_at_trigger
BEFORE UPDATE
ON public.wallets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- Automatically create wallet for new profile
-- ============================================

CREATE OR REPLACE FUNCTION public.create_wallet_for_new_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.wallets (member_id)
    VALUES (NEW.id);

    RETURN NEW;
END;
$$;

CREATE TRIGGER create_wallet_after_profile_insert
AFTER INSERT
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.create_wallet_for_new_member();