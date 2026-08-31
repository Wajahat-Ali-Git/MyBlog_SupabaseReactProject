-- ============================================================
-- Let a prospective subscriber see the category and author of a
-- recurring feed before subscribing — title/content stay withheld
-- (that's the actual paywalled product), but "what topic is this"
-- and "who writes it" are reasonable to show up front so someone can
-- decide whether to pay for it at all.
--
-- Adds category (already on scheduled_jobs, 20260803000000) and a
-- live-joined author display name to list_subscribable_jobs(). The
-- author lookup happens inside this SECURITY DEFINER function, which
-- already bypasses profiles' RLS safely — this is not the same as
-- opening profiles up to the client (see 20260805000000's header
-- comment for why that was avoided for posts). Unlike posts, this
-- isn't denormalized/snapshotted: the RPC is already a controlled,
-- narrow read path (not a raw table select), so a live join here
-- costs nothing extra in attack surface and stays current if the
-- author renames themselves.
--
-- Return type changes (two new output columns), so this is a
-- DROP + CREATE, not CREATE OR REPLACE, per the migration rule for
-- functions whose return shape changes.
-- ============================================================

DROP FUNCTION IF EXISTS public.list_subscribable_jobs();

CREATE FUNCTION public.list_subscribable_jobs()
RETURNS TABLE (
    id                   UUID,
    interval_minutes     INT,
    subscription_fee     NUMERIC,
    next_run_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ,
    category             TEXT,
    author_display_name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    RETURN QUERY
    SELECT
        sj.id, sj.interval_minutes, sj.subscription_fee, sj.next_run_at, sj.created_at,
        sj.category,
        COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Unknown') AS author_display_name
    FROM public.scheduled_jobs sj
    JOIN public.profiles p ON p.id = sj.user_id
    WHERE sj.status = 'ACTIVE' AND sj.interval_minutes IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.list_subscribable_jobs() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_subscribable_jobs() TO authenticated;
