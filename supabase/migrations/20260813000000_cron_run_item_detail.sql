-- ============================================================
-- Per-item detail for cron runs: which post/subscriber/job-owner a run
-- actually touched, not just an aggregate count.
--
-- admin_list_cron_jobs/_job_runs (20260812000000, 20260812000001) already
-- show whether a run succeeded and how many items it processed, but not
-- *which* ones — an admin investigating a failed run has no way to see
-- which specific user/post/subscription it was without querying the
-- database directly. This migration correlates each pg_cron tick (or
-- manual run) to the application-level rows it produced and exposes them
-- as a JSONB array per run, so run history can show a compact summary
-- ("3 posts published") by default and the itemized detail (post id,
-- author, per-item status/error) on request.
--
-- Also fills a real gap: scheduled_jobs_charge_annual_fee_due() had no
-- per-attempt audit trail at all (unlike job_subscriptions_charge_due(),
-- which has job_charges) — annual_fee_charges below brings it to parity.
-- ============================================================

-- ── 1. annual_fee_charges ────────────────────────────────────────────────────
-- Mirrors job_charges exactly, but keyed by scheduled_jobs.id directly —
-- the annual fee is charged to the job owner, not through a subscription.

CREATE TABLE public.annual_fee_charges (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                UUID NOT NULL REFERENCES public.scheduled_jobs(id) ON DELETE CASCADE,
    wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
    amount                NUMERIC(12,2) NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
    error                 TEXT,
    charged_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_annual_fee_charges_job ON public.annual_fee_charges (job_id, charged_at DESC);

ALTER TABLE public.annual_fee_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read annual fee charges" ON public.annual_fee_charges
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE POLICY "Users can read own annual fee charges" ON public.annual_fee_charges
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.scheduled_jobs
        WHERE id = annual_fee_charges.job_id AND user_id = auth.uid()
    ));

-- ── 2. scheduled_jobs_charge_annual_fee_due — now logs to annual_fee_charges ─
-- Body-only change (RETURNS INT unchanged from 20260808000000, so
-- CREATE OR REPLACE is safe per this project's migration rule 5 — only a
-- return-type change requires DROP FUNCTION first). Cron-only, no GRANT
-- to authenticated, same as the original.

CREATE OR REPLACE FUNCTION public.scheduled_jobs_charge_annual_fee_due()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job           RECORD;
    v_fee           NUMERIC;
    v_wallet_id     UUID;
    v_wallet_status TEXT;
    v_balance       NUMERIC;
    v_debit         RECORD;
    v_charged       INT := 0;
    v_max_failures  CONSTANT INT := 3;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('scheduled_jobs_cron'));

    SELECT value::NUMERIC INTO v_fee
    FROM public.platform_settings WHERE key = 'recurring_post_annual_fee';
    v_fee := COALESCE(v_fee, 0);

    FOR v_job IN
        SELECT * FROM public.scheduled_jobs
        WHERE status = 'ACTIVE'
          AND interval_minutes IS NOT NULL
          AND next_annual_fee_at IS NOT NULL
          AND next_annual_fee_at <= now()
        ORDER BY next_annual_fee_at
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            IF v_fee = 0 THEN
                UPDATE public.scheduled_jobs
                SET next_annual_fee_at  = now() + interval '1 year',
                    last_annual_fee_at  = now(),
                    annual_fee_failures = 0,
                    updated_at          = now()
                WHERE id = v_job.id;
                CONTINUE;
            END IF;

            SELECT id, balance_cached, status INTO v_wallet_id, v_balance, v_wallet_status
            FROM public.wallets WHERE member_id = v_job.user_id FOR UPDATE;

            IF NOT FOUND OR v_wallet_status <> 'ACTIVE' OR v_balance < v_fee THEN
                RAISE EXCEPTION 'Insufficient balance or inactive wallet';
            END IF;

            SELECT * INTO v_debit FROM public._wallet_debit(
                v_wallet_id, v_fee, 'RECURRING_POST_FEE',
                'Annual fee for recurring post', 'SYSTEM', NULL
            );

            INSERT INTO public.annual_fee_charges (job_id, wallet_transaction_id, amount, status)
            VALUES (v_job.id, v_debit.transaction_id, v_fee, 'SUCCESS');

            UPDATE public.scheduled_jobs
            SET next_annual_fee_at  = now() + interval '1 year',
                last_annual_fee_at  = now(),
                annual_fee_failures = 0,
                updated_at          = now()
            WHERE id = v_job.id;

            v_charged := v_charged + 1;

        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.annual_fee_charges (job_id, amount, status, error)
            VALUES (v_job.id, v_fee, 'FAILED', SQLERRM);

            UPDATE public.scheduled_jobs
            SET annual_fee_failures = annual_fee_failures + 1,
                next_annual_fee_at  = now() + interval '3 days',
                status = CASE WHEN annual_fee_failures + 1 >= v_max_failures
                              THEN 'PAUSED' ELSE status END,
                updated_at = now()
            WHERE id = v_job.id;
        END;
    END LOOP;

    RETURN v_charged;
END;
$$;

-- ── 3. _cron_run_detail_items — internal correlation helper ─────────────────
-- Not part of the public API: REVOKE ALL FROM PUBLIC, no GRANT to
-- `authenticated` at all — same posture as _wallet_debit. Callable only
-- from other SECURITY DEFINER functions owned by the same role.
--
-- scheduled_job_runs.ran_at / job_charges.charged_at / annual_fee_charges
-- .charged_at all default to now() (transaction start), so every item row
-- produced by one invocation of scheduled_jobs_run_due() /
-- job_subscriptions_charge_due() / scheduled_jobs_charge_annual_fee_due()
-- shares the exact same timestamp. A real pg_cron tick's
-- [start_time, end_time] window (pg_cron's own wall-clock bookends,
-- necessarily wider than the transaction) reliably contains that instant.
-- Manual runs (admin_run_cron_job_now) capture their window with now()
-- too (see 20260812000000), so the same BETWEEN logic covers both.
--
-- The three batch functions share one advisory lock and are never run
-- concurrently (see scheduled_jobs_run_due's header note), so windows
-- from different invocations never overlap — no risk of one run's items
-- bleeding into another's.

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
            SELECT jsonb_agg(jsonb_build_object(
                       'post_id', sjr.post_id,
                       'title',   po.title,
                       'user',    COALESCE(pr.full_name, pr.username, 'user ' || left(sj.user_id::text, 8)),
                       'status',  CASE WHEN sjr.status = 'PUBLISHED' THEN 'SUCCESS' ELSE 'FAILED' END,
                       'error',   sjr.error
                   ) ORDER BY sjr.ran_at)
              INTO v_items
              FROM public.scheduled_job_runs sjr
              JOIN public.scheduled_jobs sj ON sj.id = sjr.job_id
              LEFT JOIN public.profiles pr ON pr.id = sj.user_id
              LEFT JOIN public.posts po ON po.id = sjr.post_id
             WHERE sjr.ran_at BETWEEN p_window_start AND p_window_end;

        WHEN 'job-subscriptions-charge' THEN
            SELECT jsonb_agg(jsonb_build_object(
                       'subscriber', COALESCE(pr.full_name, pr.username, 'user ' || left(js.user_id::text, 8)),
                       'job_title',  sj.title,
                       'amount',     jc.amount,
                       'status',     jc.status,
                       'error',      jc.error
                   ) ORDER BY jc.charged_at)
              INTO v_items
              FROM public.job_charges jc
              JOIN public.job_subscriptions js ON js.id = jc.subscription_id
              JOIN public.scheduled_jobs sj ON sj.id = js.job_id
              LEFT JOIN public.profiles pr ON pr.id = js.user_id
             WHERE jc.charged_at BETWEEN p_window_start AND p_window_end;

        WHEN 'scheduled-jobs-annual-fee' THEN
            SELECT jsonb_agg(jsonb_build_object(
                       'owner',     COALESCE(pr.full_name, pr.username, 'user ' || left(sj.user_id::text, 8)),
                       'job_title', sj.title,
                       'amount',    afc.amount,
                       'status',    afc.status,
                       'error',     afc.error
                   ) ORDER BY afc.charged_at)
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

REVOKE ALL ON FUNCTION public._cron_run_detail_items(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;

-- ── 4. admin_list_cron_jobs — adds last_run_detail_items ────────────────────
-- Return type changes (new column), so DROP FUNCTION IF EXISTS first per
-- migration rule 5.

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
    last_run_detail_items  JSONB,
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

    RETURN QUERY
    WITH runs AS (
        SELECT d.jobid, d.status, d.start_time, d.end_time, d.return_message, 'cron'::TEXT AS source
        FROM cron.job_run_details d
        UNION ALL
        SELECT j.jobid,
               CASE WHEN m.status = 'SUCCESS' THEN 'succeeded' ELSE 'failed' END,
               m.started_at, m.ended_at, m.error,
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
        CASE WHEN d.items IS NULL THEN NULL
             ELSE (SELECT count(*)::INT FROM jsonb_array_elements(d.items) e WHERE e->>'status' = 'SUCCESS')
        END,
        d.items,
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
        SELECT public._cron_run_detail_items(j.jobname, lr.start_time, COALESCE(lr.end_time, now())) AS items
    ) d ON TRUE
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

-- ── 5. admin_list_cron_job_runs — adds detail_items per row ─────────────────
-- LIMIT is applied in an inner subquery before the detail-item LATERAL so
-- _cron_run_detail_items runs at most p_limit times (≤200), not once per
-- historical row in cron.job_run_details.

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
    result_count   INT,
    detail_items   JSONB
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
    SELECT
        c.runid, c.status, c.return_message, c.start_time, c.end_time, c.source,
        CASE WHEN d.items IS NULL THEN NULL
             ELSE (SELECT count(*)::INT FROM jsonb_array_elements(d.items) e WHERE e->>'status' = 'SUCCESS')
        END,
        d.items
    FROM (
        SELECT * FROM (
            SELECT d0.runid, d0.status, d0.return_message, d0.start_time, d0.end_time, 'cron'::TEXT AS source
            FROM cron.job_run_details d0
            WHERE d0.jobid = v_jobid
            UNION ALL
            SELECT NULL::BIGINT,
                   CASE WHEN m.status = 'SUCCESS' THEN 'succeeded' ELSE 'failed' END,
                   m.error, m.started_at, m.ended_at, 'manual'::TEXT
            FROM public.cron_manual_runs m
            WHERE m.jobname = p_jobname
        ) all_runs
        ORDER BY start_time DESC
        LIMIT v_limit
    ) c
    LEFT JOIN LATERAL (
        SELECT public._cron_run_detail_items(p_jobname, c.start_time, COALESCE(c.end_time, now())) AS items
    ) d ON TRUE
    ORDER BY c.start_time DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cron_job_runs(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_cron_job_runs(TEXT, INT) TO authenticated;
