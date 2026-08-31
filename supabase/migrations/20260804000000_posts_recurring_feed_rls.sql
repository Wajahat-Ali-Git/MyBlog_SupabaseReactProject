-- ============================================================
-- Close a content leak: recurring-feed posts (posts.is_recurring_feed
-- = TRUE, produced by scheduled_jobs_run_due()) are inserted with
-- status = 'PUBLISHED' just like any regular post, and the existing
-- "Published posts are public" policy on posts makes any PUBLISHED
-- row readable by every authenticated user — subscribed or not. The
-- subscription paywall only ever existed at *discovery* time
-- (list_subscribable_jobs() withholds title/content pre-subscription);
-- once a job actually ran, the resulting post was unconditionally
-- public, defeating the whole subscription model. This is a
-- pre-existing gap (predates today's home-page work), just made
-- obvious once home.tsx started labeling/filtering these posts as
-- "Premium" for everyone to see.
--
-- Fix: a RESTRICTIVE SELECT policy, ANDed against the existing
-- permissive "Published posts are public" policy — a second PERMISSIVE
-- policy would have no effect here, since Postgres RLS grants access
-- if ANY permissive policy passes; only a RESTRICTIVE policy narrows
-- what a passing permissive policy already allowed. For rows where
-- is_recurring_feed = TRUE, the reader must be the post's owner, an
-- admin, or hold an ACTIVE subscription to the job that produced it
-- (traced via scheduled_job_runs -> job_subscriptions). Applies
-- uniformly regardless of subscription_fee — a $0 feed still requires
-- an explicit subscribe_to_job() call in this app's existing model,
-- so free recurring posts are gated the same as paid ones.
-- ============================================================

-- scheduled_job_runs had no index on post_id — the new policy's EXISTS
-- subquery looks up by post_id on every recurring-feed row read, and a
-- busy recurring job accumulates one run row per tick.
CREATE INDEX idx_scheduled_job_runs_post ON public.scheduled_job_runs(post_id) WHERE post_id IS NOT NULL;

CREATE POLICY "Recurring feed posts require ownership, admin, or active subscription"
ON public.posts AS RESTRICTIVE FOR SELECT TO authenticated
USING (
    NOT is_recurring_feed
    OR user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
    )
    OR EXISTS (
        SELECT 1
        FROM public.scheduled_job_runs r
        JOIN public.job_subscriptions s ON s.job_id = r.job_id
        WHERE r.post_id = posts.id
          AND s.user_id = auth.uid()
          AND s.status = 'ACTIVE'
    )
);
