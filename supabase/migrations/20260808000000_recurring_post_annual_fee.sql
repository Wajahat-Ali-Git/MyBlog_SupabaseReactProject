-- ============================================================
-- Annual platform fee for recurring posts, separate from
-- post_publish_fee (which stays as-is for simple + one-time
-- scheduled posts).
--
-- Design, per explicit product decision:
--   - A distinct admin-settable fee (recurring_post_annual_fee),
--     independent of post_publish_fee.
--   - The job owner is charged once when their recurring job is
--     approved (first year), then automatically again every 365
--     days for as long as the job stays ACTIVE — same "due date +
--     minute-polling cron + FOR UPDATE SKIP LOCKED" architecture
--     already used for scheduled_jobs_run_due and
--     job_subscriptions_charge_due, just on a yearly cadence.
--   - Money subscribers pay the owner (subscription_fee /
--     job_subscriptions / job_charges) is entirely the owner's —
--     this annual fee is a separate, platform-side charge and does
--     not touch or reduce subscriber revenue in any way.
--
-- Failure handling mirrors job_subscriptions_charge_due: on a failed
-- charge, retry sooner than a full year (3 days — waiting a full
-- year to retry a failed payment would effectively lock the owner
-- out for a year) and increment a failure counter; after 3
-- consecutive failures, PAUSE the job (stops scheduled_jobs_run_due
-- from publishing it further) rather than CANCEL — this is the
-- platform's own fee, not the owner's content decision, so leaving
-- it recoverable via admin_set_job_status('ACTIVE') once they've
-- topped up is more appropriate than destroying the job outright.
-- ============================================================

-- ── 1. platform_settings seed + wallet_transactions type ────────────────────

INSERT INTO public.platform_settings (key, value)
VALUES ('recurring_post_annual_fee', '0')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;

ALTER TABLE public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type IN (
        'TOP_UP',
        'TRANSFER',
        'ADMIN_ADJUSTMENT',
        'POST_PUBLISH_FEE',
        'SUBSCRIPTION_CHARGE',
        'RECURRING_POST_FEE'
    ));

-- ── 2. scheduled_jobs: annual billing state ──────────────────────────────────

ALTER TABLE public.scheduled_jobs
    ADD COLUMN next_annual_fee_at    TIMESTAMPTZ,
    ADD COLUMN last_annual_fee_at    TIMESTAMPTZ,
    ADD COLUMN annual_fee_failures   INT NOT NULL DEFAULT 0;

-- ── 3. platform_recurring_fee_update (admin-only) ────────────────────────────
-- Mirrors platform_fee_update's validation exactly (NULL / negative /
-- 2dp / upper-bound), see 20260730000006_money_function_hardening.sql.

CREATE OR REPLACE FUNCTION public.platform_recurring_fee_update(p_fee NUMERIC)
RETURNS VOID
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

    IF p_fee IS NULL THEN
        RAISE EXCEPTION 'Fee cannot be null';
    END IF;
    IF p_fee < 0 THEN
        RAISE EXCEPTION 'Fee cannot be negative';
    END IF;
    IF p_fee <> round(p_fee, 2) THEN
        RAISE EXCEPTION 'Fee must have at most 2 decimal places';
    END IF;
    IF p_fee > 100000 THEN
        RAISE EXCEPTION 'Fee exceeds the maximum allowed value (100000)';
    END IF;

    INSERT INTO public.platform_settings (key, value, updated_by, updated_at)
    VALUES ('recurring_post_annual_fee', p_fee::TEXT, auth.uid(), now())
    ON CONFLICT (key) DO UPDATE
        SET value      = EXCLUDED.value,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_recurring_fee_update(NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_recurring_fee_update(NUMERIC) TO authenticated;

-- ── 4. admin_approve_scheduled_job: start the annual billing clock ─────────
-- Canonical body carried forward from 20260731000000 (the
-- next_run_at catch-up-burst fix is unchanged) — only addition is
-- setting next_annual_fee_at to "now" (immediately due) for recurring
-- jobs on approval, so the next tick of the new cron function below
-- picks up the first year's charge. One-time jobs get NULL — not
-- applicable to them.

CREATE OR REPLACE FUNCTION public.admin_approve_scheduled_job(p_job_id UUID)
RETURNS VOID
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
    PERFORM public.assert_aal2();

    UPDATE public.scheduled_jobs
    SET status = 'ACTIVE',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now(),
        next_run_at = GREATEST(next_run_at, now()),
        next_annual_fee_at = CASE WHEN interval_minutes IS NOT NULL THEN now() ELSE NULL END
    WHERE id = p_job_id AND status = 'PENDING_APPROVAL';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found or not pending approval', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_scheduled_job(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_approve_scheduled_job(UUID) TO authenticated;

-- ── 5. scheduled_jobs_charge_annual_fee_due — CRON ONLY ─────────────────────
-- Same authorization model as the other two cron functions: no GRANT
-- to authenticated, ever. Shares their advisory lock key so all three
-- stay serialized against each other (see 20260730000003's Fix 3 for
-- why — concurrent FOR UPDATE on wallets in different row orders can
-- deadlock).

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

            PERFORM public._wallet_debit(
                v_wallet_id, v_fee, 'RECURRING_POST_FEE',
                'Annual fee for recurring post', 'SYSTEM', NULL
            );

            UPDATE public.scheduled_jobs
            SET next_annual_fee_at  = now() + interval '1 year',
                last_annual_fee_at  = now(),
                annual_fee_failures = 0,
                updated_at          = now()
            WHERE id = v_job.id;

            v_charged := v_charged + 1;

        EXCEPTION WHEN OTHERS THEN
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

REVOKE ALL ON FUNCTION public.scheduled_jobs_charge_annual_fee_due() FROM PUBLIC;

-- ── 6. Cron wiring ────────────────────────────────────────────────────────
-- Daily, not every minute like the other two — annual due dates don't
-- need minute-level precision, and there's no reason to invoke this
-- 1440x more often than the granularity it operates on actually needs.

SELECT cron.schedule(
    'scheduled-jobs-annual-fee',
    '0 3 * * *',
    $$SELECT public.scheduled_jobs_charge_annual_fee_due();$$
);
