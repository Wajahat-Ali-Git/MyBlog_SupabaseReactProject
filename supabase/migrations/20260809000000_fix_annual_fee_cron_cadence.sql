-- ============================================================
-- Fix: scheduled_jobs_charge_annual_fee_due() was wired to a daily
-- cron ('0 3 * * *') in 20260808000000, already pushed. Daily is
-- fine for a *renewal* a year later, but admin_approve_scheduled_job
-- sets next_annual_fee_at to "now" (immediately due) for a job's
-- *first* charge — so a newly-approved recurring post's owner went
-- uncharged for up to ~24h until the next 3 AM run, instead of being
-- charged within a minute like every other fee/charge in this app
-- (scheduled_jobs_run_due, job_subscriptions_charge_due).
--
-- 20260808000000 is already applied, so per the "never edit an
-- already-pushed migration" rule this re-registers the cron job's
-- schedule as a new migration rather than editing that file.
-- cron.schedule(job_name, schedule, command) upserts by job name —
-- calling it again with the same name updates the existing job's
-- schedule in place rather than creating a duplicate.
-- ============================================================

SELECT cron.schedule(
    'scheduled-jobs-annual-fee',
    '* * * * *',
    $$SELECT public.scheduled_jobs_charge_annual_fee_due();$$
);
