-- ============================================
-- Wallet User Search
-- Replaces wallet_lookup_by_username with a
-- richer search function that:
--   * searches partial matches on username OR full_name
--   * returns up to 10 results (for live search UI)
--   * includes the user's email from auth.users
--   * excludes the currently logged-in user
-- SECURITY DEFINER is required to:
--   1. bypass RLS on public.profiles (other users)
--   2. read email from auth.users
-- ============================================

-- Drop the old exact-match function first
DROP FUNCTION IF EXISTS public.wallet_lookup_by_username(TEXT);

-- New multi-result search function
CREATE OR REPLACE FUNCTION public.wallet_search_users(
    p_search TEXT
)
RETURNS TABLE (
    wallet_id  UUID,
    member_id  UUID,
    username   TEXT,
    full_name  TEXT,
    email      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pattern TEXT;
BEGIN
    -- Wrap search term in wildcards for partial matching
    v_pattern := '%' || TRIM(p_search) || '%';

    RETURN QUERY
    SELECT
        w.id            AS wallet_id,
        p.id            AS member_id,
        p.username      AS username,
        p.full_name     AS full_name,
        u.email::text   AS email
    FROM public.profiles p
    JOIN public.wallets  w ON w.member_id = p.id
    JOIN auth.users      u ON u.id        = p.id
    WHERE
        -- Exclude the caller so you can't send to yourself
        p.id <> auth.uid()
        -- Match username OR full_name, case-insensitive partial
        AND (
            p.username  ILIKE v_pattern
            OR p.full_name ILIKE v_pattern
        )
    ORDER BY
        -- Exact username hit ranks first
        (p.username ILIKE TRIM(p_search)) DESC,
        p.username ASC
    LIMIT 10;
END;
$$;
