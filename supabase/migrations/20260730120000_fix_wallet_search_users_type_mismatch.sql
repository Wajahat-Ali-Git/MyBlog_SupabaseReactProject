-- ============================================================
-- Fix: wallet_search_users returns varchar(255) columns
--      (username, full_name) but the RETURNS TABLE declares TEXT.
--
-- Postgres 42804: "Returned type character varying(255) does not
-- match expected type text in column N."
--
-- Root cause: profiles.username / profiles.full_name are VARCHAR(255).
-- Selecting them directly into a RETURNS TABLE(… TEXT) requires an
-- explicit cast — Postgres does not widen varchar→text automatically
-- in this context.
--
-- Fix: DROP + recreate (same 4-column signature) with ::TEXT casts.
-- ============================================================

DROP FUNCTION IF EXISTS public.wallet_search_users(TEXT);

CREATE FUNCTION public.wallet_search_users(p_search TEXT)
RETURNS TABLE (
    wallet_id  UUID,
    member_id  UUID,
    username   TEXT,
    full_name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean   TEXT;
    v_pattern TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Return empty set for short input so the UI stays responsive
    -- while the user is still typing.
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
        w.id           AS wallet_id,
        p.id           AS member_id,
        p.username::TEXT   AS username,   -- explicit cast: varchar(255) → text
        p.full_name::TEXT  AS full_name   -- explicit cast: varchar(255) → text
    FROM public.profiles p
    JOIN public.wallets  w ON w.member_id = p.id
    WHERE
        p.id <> auth.uid()        -- cannot search yourself
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
