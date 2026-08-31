-- ============================================================
-- pg_cron wiring for scheduled_jobs.
--
-- Requires the pg_cron extension. On hosted Supabase: Dashboard ->
-- Database -> Extensions -> enable "pg_cron" (installs into the
-- `extensions` schema and exposes the `cron` schema). On self-hosted
-- Postgres, pg_cron must be present in shared_preload_libraries at
-- the server/container level — if CREATE EXTENSION below fails with
-- "could not open extension control file", it isn't installed on
-- this instance and this migration cannot apply until it is.
--
-- Both jobs poll every minute (pg_cron's finest native grain). Actual
-- cadence is controlled by data — scheduled_jobs.next_run_at and
-- job_subscriptions.next_charge_at — not by this cron expression, so
-- any admin-configured interval_minutes >= 1 is honored exactly
-- without ever touching this file again.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
    'scheduled-jobs-publish',
    '* * * * *',
    $$SELECT public.scheduled_jobs_run_due();$$
);

SELECT cron.schedule(
    'job-subscriptions-charge',
    '* * * * *',
    $$SELECT public.job_subscriptions_charge_due();$$
);
