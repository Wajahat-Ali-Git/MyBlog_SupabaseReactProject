-- ============================================
-- Wallet Lookup by Username
-- Lets an authenticated user find another user's
-- wallet ID by their profile username, so transfers
-- can be initiated without exposing full profile data.
-- SECURITY DEFINER bypasses RLS safely; only the
-- wallet ID (not balance or personal info) is returned.
-- ============================================

CREATE OR REPLACE FUNCTION public.wallet_lookup_by_username(
    p_username TEXT
)
RETURNS TABLE (
    wallet_id UUID,
    member_id UUID,
    username TEXT,
    full_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        w.id        AS wallet_id,
        p.id        AS member_id,
        p.username  AS username,
        p.full_name AS full_name
    FROM public.profiles p
    JOIN public.wallets w ON w.member_id = p.id
    WHERE p.username ILIKE p_username
      AND p.id <> auth.uid()  -- cannot look yourself up
    LIMIT 1;
END;
$$;
