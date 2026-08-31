-- ============================================================
-- Add structured result counts to the cron-monitor listing RPCs
-- (20260812000000_admin_cron_job_monitoring.sql, already applied).
--
-- That migration's admin_list_cron_jobs/_job_runs baked a manual run's
-- outcome into one pre-formatted sentence ("Manually triggered —
-- processed N item(s)"). The admin frontend needs to phrase that outcome
-- in job-specific terms instead ("3 posts published" vs "3 subscribers
-- charged"), which requires the raw count as its own column rather than
-- text baked into SQL. Both functions' return type is changing (an added
-- column), so per this project's migration rule 5, DROP FUNCTION IF
-- EXISTS is used before recreating them rather than CREATE OR REPLACE.
-- ============================================================

DROP FUNCTION IF EXISTS public.admin_list_cron_jobs();

CREATE FUNCTION public.admin_list_cron_jobs()
RETURNS TABLE (
    jobid                  BIGINT,
    jobname                TEXT,
    schedule               TEXT,
    command                TEXT,
    active                 BOOLEAN,
    last_run_status        TEXT,
    last_run_started_at    TIMESTAMPTZ,
    last_run_ended_at      TIMESTAMPTZ,
    last_run_message       TEXT,
    last_run_source        TEXT,
    last_run_result_count  INT,
    runs_last_24h          BIGINT,
    failures_last_24h      BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;

    -- last_run_message/last_run_result_count are kept separate (rather than
    -- pre-formatted into one sentence here) so the client can phrase the
    -- outcome in job-specific terms ("3 posts published" vs "3 subscribers
    -- charged") instead of a generic "processed 3 item(s)".
    RETURN QUERY
    WITH runs AS (
        SELECT d.jobid, d.status, d.start_time, d.end_time, d.return_message,
               'cron'::TEXT AS source, NULL::INT AS result_count
        FROM cron.job_run_details d
        UNION ALL
        SELECT j.jobid,
               CASE WHEN m.status = 'SUCCESS' THEN 'succeeded' ELSE 'failed' END,
               m.started_at, m.ended_at, m.error,
               'manual'::TEXT, m.result_count
        FROM public.cron_manual_runs m
        JOIN cron.job j ON j.jobname = m.jobname
    )
    SELECT
        j.jobid,
        j.jobname,
        j.schedule,
        j.command,
        j.active,
        lr.status,
        lr.start_time,
        lr.end_time,
        lr.return_message,
        lr.source,
        lr.result_count,
        COALESCE(stats.total, 0),
        COALESCE(stats.failed, 0)
    FROM cron.job j
    LEFT JOIN LATERAL (
        SELECT r.status, r.start_time, r.end_time, r.return_message, r.source, r.result_count
        FROM runs r
        WHERE r.jobid = j.jobid
        ORDER BY r.start_time DESC NULLS LAST
        LIMIT 1
    ) lr ON TRUE
    LEFT JOIN LATERAL (
        SELECT count(*) AS total,
               count(*) FILTER (WHERE r.status = 'failed') AS failed
        FROM runs r
        WHERE r.jobid = j.jobid AND r.start_time >= now() - interval '24 hours'
    ) stats ON TRUE
    ORDER BY j.jobname;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cron_jobs() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_cron_jobs() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_list_cron_job_runs(TEXT, INT);

CREATE FUNCTION public.admin_list_cron_job_runs(
    p_jobname TEXT,
    p_limit   INT DEFAULT 50
)
RETURNS TABLE (
    runid          BIGINT,
    status         TEXT,
    return_message TEXT,
    start_time     TIMESTAMPTZ,
    end_time       TIMESTAMPTZ,
    source         TEXT,
    result_count   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jobid BIGINT;
    v_limit INT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;

    SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = p_jobname;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cron job % not found', p_jobname;
    END IF;

    v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

    -- return_message/result_count kept separate here too (see
    -- admin_list_cron_jobs) so the client can phrase a successful manual
    -- run in job-specific terms instead of a canned sentence.
    RETURN QUERY
    SELECT combined.runid, combined.status, combined.return_message, combined.start_time,
           combined.end_time, combined.source, combined.result_count
    FROM (
        SELECT d.runid, d.status, d.return_message, d.start_time, d.end_time,
               'cron'::TEXT AS source, NULL::INT AS result_count
        FROM cron.job_run_details d
        WHERE d.jobid = v_jobid
        UNION ALL
        SELECT NULL::BIGINT,
               CASE WHEN m.status = 'SUCCESS' THEN 'succeeded' ELSE 'failed' END,
               m.error, m.started_at, m.ended_at, 'manual'::TEXT, m.result_count
        FROM public.cron_manual_runs m
        WHERE m.jobname = p_jobname
    ) combined
    ORDER BY combined.start_time DESC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cron_job_runs(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_cron_job_runs(TEXT, INT) TO authenticated;
