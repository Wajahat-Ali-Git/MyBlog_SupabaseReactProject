-- ============================================================
-- Admin visibility into the underlying pg_cron jobs themselves
-- (cron.job / cron.job_run_details), not just the application-level
-- scheduled_job_runs table.
--
-- scheduled_job_runs (20260730000000) only records an attempt once
-- scheduled_jobs_run_due() actually starts iterating a due job — it
-- can't tell the admin whether the pg_cron *tick* that invokes that
-- function ran at all, or why it errored before reaching application
-- code. cron.job_run_details is pg_cron's own ledger of every
-- invocation of every registered job ('scheduled-jobs-publish',
-- 'job-subscriptions-charge', 'scheduled-jobs-annual-fee'), with
-- status + return_message (the failure reason) per run.
--
-- The `cron` schema is created by the pg_cron extension itself
-- (see 20260730000002's header comment) and is not exposed via
-- PostgREST or granted to `authenticated`. These RPCs are the only
-- sanctioned read/write path — same pattern as every other admin
-- RPC in this codebase: admin check, then act.
--
-- Also included:
--   - cron_manual_runs: an audit table for admin-triggered manual
--     runs (admin_run_cron_job_now). A manual run bypasses pg_cron's
--     own scheduler entirely — it calls the batch function directly
--     — so it would otherwise never appear in cron.job_run_details
--     and be invisible on the very page whose purpose is showing
--     "did it run, and why". admin_list_cron_jobs/_job_runs merge
--     this table with cron.job_run_details so manual runs show up
--     in "last run" and history exactly like real ticks do.
--   - A pg_cron version guard, since cron.alter_job (used by
--     admin_set_cron_job_active) was only added in pg_cron 1.4 —
--     fail loudly at migration time instead of on first toggle.
--   - A daily cleanup job pruning old cron.job_run_details /
--     cron_manual_runs rows — pg_cron does not do this itself, and
--     an unbounded run-history table would eventually slow down
--     admin_list_cron_job_runs's ORDER BY start_time.
-- ============================================================

-- ── 0. pg_cron version guard ─────────────────────────────────────────────────
-- cron.alter_job was added in pg_cron 1.4. CREATE FUNCTION does not validate
-- that referenced functions/tables exist (plpgsql bodies are opaque until
-- first call), so without this check an old pg_cron would apply this
-- migration cleanly and only fail confusingly the first time an admin uses
-- the pause/resume toggle.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'cron' AND p.proname = 'alter_job'
    ) THEN
        RAISE EXCEPTION
            'pg_cron % is missing cron.alter_job (added in pg_cron 1.4) — upgrade the pg_cron extension before applying this migration',
            (SELECT extversion FROM pg_extension WHERE extname = 'pg_cron');
    END IF;
END;
$$;

-- ── 1. cron_manual_runs ──────────────────────────────────────────────────────
-- Audit trail of every admin-triggered manual run. Writes only via
-- admin_run_cron_job_now() below — no INSERT/UPDATE/DELETE policy is granted
-- to `authenticated`, matching this codebase's "no direct writes" convention
-- (see posts_lock_direct_writes, top_up_requests_lock_direct_insert).

CREATE TABLE public.cron_manual_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jobname       TEXT NOT NULL,
    triggered_by  UUID NOT NULL REFERENCES public.profiles(id),
    status        TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
    result_count  INT,
    error         TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    ended_at      TIMESTAMPTZ
);

CREATE INDEX idx_cron_manual_runs_jobname ON public.cron_manual_runs (jobname, started_at DESC);

ALTER TABLE public.cron_manual_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read manual cron runs" ON public.cron_manual_runs
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ── 2. admin_list_cron_jobs ──────────────────────────────────────────────────
-- One row per registered cron job. last_run_* is the more recent of the
-- latest real pg_cron tick and the latest manual run (last_run_source tells
-- the client which); runs/failures_last_24h count both sources too.

CREATE OR REPLACE FUNCTION public.admin_list_cron_jobs()
RETURNS TABLE (
    jobid                BIGINT,
    jobname              TEXT,
    schedule             TEXT,
    command              TEXT,
    active               BOOLEAN,
    last_run_status      TEXT,
    last_run_started_at  TIMESTAMPTZ,
    last_run_ended_at    TIMESTAMPTZ,
    last_run_message     TEXT,
    last_run_source      TEXT,
    runs_last_24h        BIGINT,
    failures_last_24h    BIGINT
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

    RETURN QUERY
    WITH runs AS (
        SELECT d.jobid, d.status, d.start_time, d.end_time, d.return_message, 'cron'::TEXT AS source
        FROM cron.job_run_details d
        UNION ALL
        SELECT j.jobid,
               CASE WHEN m.status = 'SUCCESS' THEN 'succeeded' ELSE 'failed' END,
               m.started_at, m.ended_at,
               COALESCE(m.error, 'Manually triggered — processed ' || COALESCE(m.result_count, 0) || ' item(s)'),
               'manual'::TEXT
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
        COALESCE(stats.total, 0),
        COALESCE(stats.failed, 0)
    FROM cron.job j
    LEFT JOIN LATERAL (
        SELECT r.status, r.start_time, r.end_time, r.return_message, r.source
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

-- ── 3. admin_list_cron_job_runs ──────────────────────────────────────────────
-- Full run history for one job, newest first — real ticks and manual runs
-- interleaved by time, each tagged with its source.

CREATE OR REPLACE FUNCTION public.admin_list_cron_job_runs(
    p_jobname TEXT,
    p_limit   INT DEFAULT 50
)
RETURNS TABLE (
    runid          BIGINT,
    status         TEXT,
    return_message TEXT,
    start_time     TIMESTAMPTZ,
    end_time       TIMESTAMPTZ,
    source         TEXT
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

    RETURN QUERY
    SELECT combined.runid, combined.status, combined.return_message, combined.start_time, combined.end_time, combined.source
    FROM (
        SELECT d.runid, d.status, d.return_message, d.start_time, d.end_time, 'cron'::TEXT AS source
        FROM cron.job_run_details d
        WHERE d.jobid = v_jobid
        UNION ALL
        SELECT NULL::BIGINT,
               CASE WHEN m.status = 'SUCCESS' THEN 'succeeded' ELSE 'failed' END,
               COALESCE(m.error, 'Manually triggered — processed ' || COALESCE(m.result_count, 0) || ' item(s)'),
               m.started_at, m.ended_at, 'manual'::TEXT
        FROM public.cron_manual_runs m
        WHERE m.jobname = p_jobname
    ) combined
    ORDER BY combined.start_time DESC
    LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cron_job_runs(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_cron_job_runs(TEXT, INT) TO authenticated;

-- ── 4. admin_set_cron_job_active — pause/resume the underlying pg_cron job ──
-- Distinct from admin_set_job_status (which pauses one application-level
-- scheduled_jobs row): this pauses the whole cron tick, i.e. every job of
-- that kind stops being processed platform-wide. AAL2-gated since it can
-- halt billing/publishing entirely.

CREATE OR REPLACE FUNCTION public.admin_set_cron_job_active(
    p_jobname TEXT,
    p_active  BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jobid BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;
    PERFORM public.assert_aal2();

    IF p_active IS NULL THEN
        RAISE EXCEPTION 'active flag is required';
    END IF;

    SELECT j.jobid INTO v_jobid FROM cron.job j WHERE j.jobname = p_jobname;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cron job % not found', p_jobname;
    END IF;

    PERFORM cron.alter_job(v_jobid, active => p_active);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_cron_job_active(TEXT, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_cron_job_active(TEXT, BOOLEAN) TO authenticated;

-- ── 5. admin_run_cron_job_now — manual trigger, whitelisted ─────────────────
-- Deliberately NOT "SELECT cron.job.command" + EXECUTE — that would let
-- this function run whatever SQL happens to be registered under a given
-- jobname, which is not an auditable surface for a client-callable RPC.
-- Instead it's a closed CASE over the three known batch functions, so the
-- set of things an admin can trigger here can never silently grow via a
-- cron.job edit. Same money-moving posture as the functions themselves —
-- AAL2-gated.
--
-- Requires the job to be `active` in cron.job, matching the frontend's own
-- disabled state for the "Run now" button — a paused job must be resumed
-- (admin_set_cron_job_active) before it can be run, rather than the two
-- surfaces silently disagreeing on whether that's allowed.
--
-- Every attempt — success or failure — is logged to cron_manual_runs so it
-- shows up in admin_list_cron_jobs/_job_runs; on failure the row is written
-- before the original error is re-raised, so the caller still sees the
-- real error message.

CREATE OR REPLACE FUNCTION public.admin_run_cron_job_now(p_jobname TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result     INT;
    v_started_at CONSTANT TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;
    PERFORM public.assert_aal2();

    IF p_jobname NOT IN ('scheduled-jobs-publish', 'job-subscriptions-charge', 'scheduled-jobs-annual-fee') THEN
        RAISE EXCEPTION 'Unknown or non-runnable cron job: %', p_jobname;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = p_jobname AND active) THEN
        RAISE EXCEPTION 'Cron job % is disabled — resume it before running manually', p_jobname;
    END IF;

    BEGIN
        CASE p_jobname
            WHEN 'scheduled-jobs-publish' THEN
                SELECT public.scheduled_jobs_run_due() INTO v_result;
            WHEN 'job-subscriptions-charge' THEN
                SELECT public.job_subscriptions_charge_due() INTO v_result;
            WHEN 'scheduled-jobs-annual-fee' THEN
                SELECT public.scheduled_jobs_charge_annual_fee_due() INTO v_result;
        END CASE;

        INSERT INTO public.cron_manual_runs (jobname, triggered_by, status, result_count, started_at, ended_at)
        VALUES (p_jobname, auth.uid(), 'SUCCESS', v_result, v_started_at, clock_timestamp());

    EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.cron_manual_runs (jobname, triggered_by, status, error, started_at, ended_at)
        VALUES (p_jobname, auth.uid(), 'FAILED', SQLERRM, v_started_at, clock_timestamp());
        RAISE;
    END;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_run_cron_job_now(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_run_cron_job_now(TEXT) TO authenticated;

-- ── 6. Run-history cleanup ───────────────────────────────────────────────────
-- pg_cron does not prune cron.job_run_details itself — left unbounded it
-- would eventually slow down admin_list_cron_job_runs's ORDER BY start_time.
-- Prunes both the pg_cron ledger and our own manual-run audit table.

SELECT cron.schedule(
    'cron-job-run-details-cleanup',
    '0 4 * * *',
    $$
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days';
    DELETE FROM public.cron_manual_runs WHERE COALESCE(ended_at, started_at) < now() - interval '14 days';
    $$
);
