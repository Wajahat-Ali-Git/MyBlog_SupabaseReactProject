-- ============================================================
-- Fix: active subscribers could not see the recurring-feed posts
-- they're paying for.
--
-- The RESTRICTIVE SELECT policy on posts from
-- 20260804000000_posts_recurring_feed_rls.sql (already pushed) checks
-- subscription access via a direct subquery against
-- scheduled_job_runs. But scheduled_job_runs has its own RLS policy
-- ("Admins can read job runs" USING (is_admin = TRUE), from
-- 20260730000000_scheduled_jobs_schema.sql) that only ever allows
-- admins to read that table — unconditionally, regardless of which
-- rows a subquery's WHERE clause narrows to. Postgres RLS applies
-- per-table to every query touching that table, including subqueries
-- nested inside another table's policy expression, so a non-admin
-- subscriber's subquery against scheduled_job_runs always returned
-- zero rows. The EXISTS(...) collapsed to FALSE for everyone except
-- admins, no matter their actual subscription status. Only the post
-- owner (user_id = auth.uid(), the OR branch before it) and admins
-- could ever see a recurring-feed post.
--
-- (job_subscriptions itself was never the problem — its policy is
-- user_id = auth.uid(), exactly what the subquery already filters
-- to, so RLS there never blocked anything.)
--
-- Fix: move the cross-table check into a SECURITY DEFINER function,
-- which executes as the function owner and so bypasses
-- scheduled_job_runs' RLS internally — the same established pattern
-- every other cross-table check in this codebase already uses (e.g.
-- list_subscribable_jobs()). auth.uid() inside the function still
-- resolves to the calling user, so this only fixes RLS getting in
-- its own way — it does not broaden who can see what.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_active_subscriber_of_post(p_post_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.scheduled_job_runs r
        JOIN public.job_subscriptions s ON s.job_id = r.job_id
        WHERE r.post_id = p_post_id
          AND s.user_id = auth.uid()
          AND s.status = 'ACTIVE'
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_subscriber_of_post(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_active_subscriber_of_post(BIGINT) TO authenticated;

DROP POLICY IF EXISTS "Recurring feed posts require ownership, admin, or active subscription" ON public.posts;

CREATE POLICY "Recurring feed posts require ownership, admin, or active subscription"
ON public.posts AS RESTRICTIVE FOR SELECT TO authenticated
USING (
    NOT is_recurring_feed
    OR user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
    )
    OR public.is_active_subscriber_of_post(id)
);
