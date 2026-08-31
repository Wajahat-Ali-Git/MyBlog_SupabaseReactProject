-- ============================================================
-- Fix wallet_search_users — close email leak & user enumeration
--
-- Problems in the previous version:
--
--   1. RETURNS TABLE included `email TEXT` — joined from auth.users
--      via SECURITY DEFINER, so every authenticated user could read
--      every other user's email just by calling the RPC.
--
--   2. Empty / single-character search built the pattern '%%' or '%_%'
--      which matches every row — effectively a full user dump.
--      The client-side `if (!query.trim()) return []` guard does not
--      protect direct RPC calls (curl, Postman, custom clients).
--
--   3. The LIKE pattern was not escaped, so a caller could pass
--      '%' or '_' to bypass intended prefix matching.
--
-- Fixes applied:
--
--   a. Drop email from the return type; the function no longer touches
--      auth.users at all (the SECURITY DEFINER access is still needed
--      to bypass RLS on profiles rows owned by other users).
--
--   b. Require length(trim(p_search)) >= 3.  Shorter inputs get an
--      empty result set rather than an error, to keep UI UX smooth.
--
--   c. Escape literal '%' and '_' in the search term before embedding
--      it in the LIKE pattern.
--
--   d. Add a case-insensitive UNIQUE index on profiles.username so
--      username alone is sufficient to identify a recipient without
--      needing email for disambiguation.
--
--   e. Re-assert REVOKE / GRANT (already in _200000, but idempotent
--      here so this migration is self-contained).
-- ============================================================

-- ── 1. Unique username index (case-insensitive) ───────────────────────────────
-- Using a partial unique index on lower(username) lets existing data stay
-- if there happen to be no duplicates; it fails fast at migration time if
-- duplicates exist, which is the correct behaviour — fix data first.

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique
    ON public.profiles (lower(username));

-- ── 2. Rebuild wallet_search_users without email ─────────────────────────────
-- CREATE OR REPLACE cannot change a function's return columns (Postgres
-- error 42P13: "cannot change return type of existing function" / "Row
-- type defined by OUT parameters is different"). The deployed version
-- returns 5 columns (…, email); this version drops to 4, so the old
-- signature must be dropped first.

DROP FUNCTION IF EXISTS public.wallet_search_users(TEXT);

CREATE FUNCTION public.wallet_search_users(p_search TEXT)
RETURNS TABLE (
    wallet_id  UUID,
    member_id  UUID,
    username   TEXT,
    full_name  TEXT
    -- email intentionally removed: SECURITY DEFINER must not leak auth.users data
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean   TEXT;
    v_pattern TEXT;
BEGIN
    -- Auth guard
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Minimum length guard — return empty set (not an error) for short input
    -- so the UI stays responsive while the user is still typing.
    v_clean := trim(p_search);
    IF length(v_clean) < 3 THEN
        RETURN;
    END IF;

    -- Escape LIKE metacharacters so callers cannot use '%' or '_' as wildcards.
    v_clean   := replace(replace(v_clean, '\', '\\'), '%', '\%');
    v_clean   := replace(v_clean, '_', '\_');
    v_pattern := '%' || v_clean || '%';

    RETURN QUERY
    SELECT
        w.id        AS wallet_id,
        p.id        AS member_id,
        p.username  AS username,
        p.full_name AS full_name
    FROM public.profiles p
    JOIN public.wallets  w ON w.member_id = p.id
    WHERE
        p.id <> auth.uid()   -- cannot search yourself
        AND w.status = 'ACTIVE'
        AND (
            p.username  ILIKE v_pattern ESCAPE '\'
            OR p.full_name ILIKE v_pattern ESCAPE '\'
        )
    ORDER BY
        (p.username ILIKE v_clean ESCAPE '\') DESC,   -- exact username hit first
        p.username ASC
    LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_search_users(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_search_users(TEXT) TO authenticated;
