-- ============================================================
-- Fixes the scaling half of the cron-monitor review finding, but NOT the
-- way originally suggested (extending the 14-day cleanup job to also
-- prune scheduled_job_runs / job_charges / annual_fee_charges).
--
-- On reflection that would be wrong: those three tables are financial/
-- content audit trails, not operational cron bookkeeping like
-- cron.job_run_details / cron_manual_runs (which the existing cleanup job
-- correctly does prune — see 20260812000000). job_charges and
-- annual_fee_charges each reference a wallet_transactions row via
-- wallet_transaction_id, and wallet_transactions is explicitly append-
-- only and never pruned (20260730000008) — deleting the charge-attempt
-- record after 14 days while the ledger entry it explains lives forever
-- would leave permanent wallet_transactions rows with no record of which
-- subscription/job produced them. Same problem for scheduled_job_runs,
-- which explains why a still-existing post was (or wasn't) published.
-- Pruning these would be a real audit-trail regression, not a cleanup.
--
-- The actual performance problem — _cron_run_detail_items (20260813000000/
-- 20260814000000) filtering scheduled_job_runs.ran_at / job_charges
-- .charged_at / annual_fee_charges.charged_at with BETWEEN, with no
-- index led by those timestamp columns (the existing indexes are all led
-- by a foreign key) — is fixed directly with indexes instead, so the
-- correlation query stays a range scan no matter how large these tables
-- grow.
-- ============================================================

CREATE INDEX idx_scheduled_job_runs_ran_at ON public.scheduled_job_runs (ran_at);
CREATE INDEX idx_job_charges_charged_at ON public.job_charges (charged_at);
CREATE INDEX idx_annual_fee_charges_charged_at ON public.annual_fee_charges (charged_at);
