-- ============================================================
-- _cron_run_detail_items (20260813000000): distinguish "ran, found 0
-- items due" from "this job type has no per-item tracking" (only the
-- housekeeping cleanup job falls into the latter).
--
-- jsonb_agg() over zero matching rows returns NULL, which made
-- admin_list_cron_jobs/_job_runs's `d.items IS NULL` check treat a
-- perfectly normal "nothing was due this tick" exactly like "this
-- jobname isn't one we track items for" — both produced a NULL
-- detail_items/result_count, forcing the frontend to fall back to
-- pg_cron's raw return_message ("1 row"), which is not a meaningful
-- log for an admin reading run history. Wrapping each of the three
-- tracked branches in COALESCE(..., '[]'::jsonb) makes "0 items, ran
-- fine" an actual empty array the frontend can render as "No posts
-- were due to publish" — while the untracked ELSE branch (cleanup
-- job) still correctly returns NULL, and admin_list_cron_jobs/
-- _job_runs need no changes since they already branch on
-- `items IS NULL` vs not.
--
-- Body-only change (RETURNS JSONB unchanged), CREATE OR REPLACE is
-- safe per this project's migration rule 5.
-- ============================================================

CREATE OR REPLACE FUNCTION public._cron_run_detail_items(
    p_jobname      TEXT,
    p_window_start TIMESTAMPTZ,
    p_window_end   TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_items JSONB;
BEGIN
    CASE p_jobname
        WHEN 'scheduled-jobs-publish' THEN
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'post_id', sjr.post_id,
                       'title',   po.title,
                       'user',    COALESCE(pr.full_name, pr.username, 'user ' || left(sj.user_id::text, 8)),
                       'status',  CASE WHEN sjr.status = 'PUBLISHED' THEN 'SUCCESS' ELSE 'FAILED' END,
                       'error',   sjr.error
                   ) ORDER BY sjr.ran_at), '[]'::jsonb)
              INTO v_items
              FROM public.scheduled_job_runs sjr
              JOIN public.scheduled_jobs sj ON sj.id = sjr.job_id
              LEFT JOIN public.profiles pr ON pr.id = sj.user_id
              LEFT JOIN public.posts po ON po.id = sjr.post_id
             WHERE sjr.ran_at BETWEEN p_window_start AND p_window_end;

        WHEN 'job-subscriptions-charge' THEN
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'subscriber', COALESCE(pr.full_name, pr.username, 'user ' || left(js.user_id::text, 8)),
                       'job_title',  sj.title,
                       'amount',     jc.amount,
                       'status',     jc.status,
                       'error',      jc.error
                   ) ORDER BY jc.charged_at), '[]'::jsonb)
              INTO v_items
              FROM public.job_charges jc
              JOIN public.job_subscriptions js ON js.id = jc.subscription_id
              JOIN public.scheduled_jobs sj ON sj.id = js.job_id
              LEFT JOIN public.profiles pr ON pr.id = js.user_id
             WHERE jc.charged_at BETWEEN p_window_start AND p_window_end;

        WHEN 'scheduled-jobs-annual-fee' THEN
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'owner',     COALESCE(pr.full_name, pr.username, 'user ' || left(sj.user_id::text, 8)),
                       'job_title', sj.title,
                       'amount',    afc.amount,
                       'status',    afc.status,
                       'error',     afc.error
                   ) ORDER BY afc.charged_at), '[]'::jsonb)
              INTO v_items
              FROM public.annual_fee_charges afc
              JOIN public.scheduled_jobs sj ON sj.id = afc.job_id
              LEFT JOIN public.profiles pr ON pr.id = sj.user_id
             WHERE afc.charged_at BETWEEN p_window_start AND p_window_end;

        ELSE
            v_items := NULL;
    END CASE;

    RETURN v_items;
END;
$$;
