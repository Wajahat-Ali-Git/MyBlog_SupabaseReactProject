-- ============================================================
-- scheduled_jobs security fixes
--
-- Post-review fixes to the scheduled_jobs feature already applied in
-- 20260730000000 / 20260730000001 / 20260730000002. Applied as a new
-- migration rather than editing those files, per this project's rule
-- (never edit an already-applied migration).
--
-- 1. [High] "Users can read active or paused jobs" had no ownership
--    scoping at all — any authenticated user could read title/content
--    for every ACTIVE/PAUSED job, leaking unpublished post content and
--    defeating the subscription_fee paywall entirely (readable without
--    ever subscribing). Replaced with a policy scoped to the job's
--    target user and its active subscribers, plus a new
--    list_subscribable_jobs() RPC that restores browse/discovery
--    without exposing title/content to non-subscribers.
--
-- 2. [High] job_subscriptions_charge_due()'s cursor joins scheduled_jobs
--    on `sj.status = 'ACTIVE'` but never locks `sj` — only `js`. A batch
--    spanning many subscriptions can outlive an admin pausing/cancelling
--    the job mid-batch (admin_set_job_status commits immediately since
--    sj was never locked), so a subscriber could still be charged for a
--    job that was just paused/cancelled. Fixed by re-fetching AND
--    locking the job row with the status predicate immediately before
--    charging, skipping (not charging) if it's no longer ACTIVE.
--
-- 3. [Medium] Both cron functions run on the same every-minute schedule
--    and each accumulates FOR UPDATE locks on wallets across many loop
--    iterations within one transaction, in different row orders from
--    each other (next_run_at vs next_charge_at). Left unserialized, two
--    concurrent runs touching overlapping wallets could deadlock. Fixed
--    with a shared advisory lock that fully serializes the two cron
--    functions against each other (and against overlapping invocations
--    of themselves).
-- ============================================================

-- ── Fix 1: scheduled_jobs SELECT policy + discovery RPC ─────────────────────

DROP POLICY IF EXISTS "Users can read active or paused jobs" ON public.scheduled_jobs;

CREATE POLICY "Users can read own or subscribed jobs" ON public.scheduled_jobs
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.job_subscriptions
            WHERE job_id = scheduled_jobs.id
              AND user_id = auth.uid()
              AND status = 'ACTIVE'
        )
    );

CREATE OR REPLACE FUNCTION public.list_subscribable_jobs()
RETURNS TABLE (
    id                UUID,
    interval_minutes  INT,
    subscription_fee  NUMERIC,
    next_run_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    RETURN QUERY
    SELECT sj.id, sj.interval_minutes, sj.subscription_fee, sj.next_run_at, sj.created_at
    FROM public.scheduled_jobs sj
    WHERE sj.status = 'ACTIVE' AND sj.interval_minutes IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.list_subscribable_jobs() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_subscribable_jobs() TO authenticated;

-- ── Fix 2 + 3: canonical scheduled_jobs_run_due ─────────────────────────────

CREATE OR REPLACE FUNCTION public.scheduled_jobs_run_due()
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
    v_post_status   TEXT;
    v_post_id       BIGINT;
    v_published     INT := 0;
BEGIN
    -- Serializes this function against job_subscriptions_charge_due()
    -- (Fix 3) — see that function for the full explanation.
    PERFORM pg_advisory_xact_lock(hashtext('scheduled_jobs_cron'));

    FOR v_job IN
        SELECT * FROM public.scheduled_jobs
        WHERE status = 'ACTIVE' AND next_run_at <= now()
        ORDER BY next_run_at
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            SELECT value::NUMERIC INTO v_fee
            FROM public.platform_settings WHERE key = 'post_publish_fee';
            v_fee := COALESCE(v_fee, 0);

            v_post_status := 'PUBLISHED';

            IF v_fee > 0 THEN
                SELECT id, balance_cached, status INTO v_wallet_id, v_balance, v_wallet_status
                FROM public.wallets WHERE member_id = v_job.user_id FOR UPDATE;

                IF NOT FOUND OR v_wallet_status <> 'ACTIVE' OR v_balance < v_fee THEN
                    v_post_status := 'DRAFT';
                ELSE
                    PERFORM public._wallet_debit(
                        v_wallet_id, v_fee, 'POST_PUBLISH_FEE',
                        'Platform fee for scheduled post', 'SYSTEM', NULL
                    );
                END IF;
            END IF;

            INSERT INTO public.posts (user_id, title, content, status)
            VALUES (v_job.user_id, v_job.title, v_job.content, v_post_status)
            RETURNING id INTO v_post_id;

            INSERT INTO public.scheduled_job_runs (job_id, post_id, status)
            VALUES (v_job.id, v_post_id, 'PUBLISHED');

            v_published := v_published + 1;

            IF v_job.interval_minutes IS NULL THEN
                UPDATE public.scheduled_jobs
                SET status = 'COMPLETED', last_run_at = now(), updated_at = now()
                WHERE id = v_job.id;
            ELSE
                UPDATE public.scheduled_jobs
                SET next_run_at = v_job.next_run_at + make_interval(mins => v_job.interval_minutes),
                    last_run_at = now(),
                    updated_at  = now(),
                    status      = CASE
                                    WHEN v_job.ends_at IS NOT NULL
                                         AND v_job.next_run_at + make_interval(mins => v_job.interval_minutes) > v_job.ends_at
                                    THEN 'COMPLETED'
                                    ELSE status
                                  END
                WHERE id = v_job.id;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.scheduled_job_runs (job_id, status, error)
            VALUES (v_job.id, 'FAILED', SQLERRM);

            UPDATE public.scheduled_jobs
            SET last_run_at = now(), updated_at = now()
            WHERE id = v_job.id;
        END;
    END LOOP;

    RETURN v_published;
END;
$$;

REVOKE ALL ON FUNCTION public.scheduled_jobs_run_due() FROM PUBLIC;

-- ── Fix 2 + 3: canonical job_subscriptions_charge_due ───────────────────────

CREATE OR REPLACE FUNCTION public.job_subscriptions_charge_due()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sub           RECORD;
    v_fee           NUMERIC;
    v_interval      INT;
    v_wallet_id     UUID;
    v_wallet_status TEXT;
    v_balance       NUMERIC;
    v_debit         RECORD;
    v_charged       INT := 0;
    v_max_failures  CONSTANT INT := 3;
BEGIN
    -- Fix 3: serializes this function against scheduled_jobs_run_due().
    -- Both run on the same every-minute schedule and each accumulates
    -- FOR UPDATE locks on wallets across many loop iterations within one
    -- transaction, in different row orders from each other. Left
    -- unserialized, two concurrent runs touching overlapping wallets
    -- could deadlock.
    PERFORM pg_advisory_xact_lock(hashtext('scheduled_jobs_cron'));

    FOR v_sub IN
        SELECT js.*
        FROM public.job_subscriptions js
        JOIN public.scheduled_jobs sj ON sj.id = js.job_id
        WHERE js.status = 'ACTIVE'
          AND js.next_charge_at <= now()
          AND sj.status = 'ACTIVE'          -- paused/cancelled jobs stop billing
        ORDER BY js.next_charge_at
        FOR UPDATE OF js SKIP LOCKED
    LOOP
        BEGIN
            -- Fix 2: re-fetch AND lock the job row here, re-checking status.
            -- The outer cursor's `sj.status = 'ACTIVE'` join runs against an
            -- unlocked snapshot of scheduled_jobs, so a batch spanning many
            -- subscriptions can outlive an admin pausing/cancelling the job
            -- mid-batch. Locking and re-checking here closes that window —
            -- if the job is no longer ACTIVE, skip without charging.
            SELECT subscription_fee, interval_minutes INTO v_fee, v_interval
            FROM public.scheduled_jobs
            WHERE id = v_sub.job_id AND status = 'ACTIVE'
            FOR UPDATE;

            IF NOT FOUND THEN
                CONTINUE;
            END IF;

            IF v_fee = 0 THEN
                UPDATE public.job_subscriptions
                SET next_charge_at       = now() + make_interval(mins => v_interval),
                    last_charged_at      = now(),
                    consecutive_failures = 0
                WHERE id = v_sub.id;
                CONTINUE;
            END IF;

            SELECT id, balance_cached, status INTO v_wallet_id, v_balance, v_wallet_status
            FROM public.wallets WHERE member_id = v_sub.user_id FOR UPDATE;

            IF NOT FOUND OR v_wallet_status <> 'ACTIVE' OR v_balance < v_fee THEN
                RAISE EXCEPTION 'Insufficient balance or inactive wallet';
            END IF;

            SELECT * INTO v_debit FROM public._wallet_debit(
                v_wallet_id, v_fee, 'SUBSCRIPTION_CHARGE',
                'Subscription charge', 'SYSTEM', NULL
            );

            INSERT INTO public.job_charges (subscription_id, wallet_transaction_id, amount, status)
            VALUES (v_sub.id, v_debit.transaction_id, v_fee, 'SUCCESS');

            UPDATE public.job_subscriptions
            SET next_charge_at       = now() + make_interval(mins => v_interval),
                last_charged_at      = now(),
                consecutive_failures = 0
            WHERE id = v_sub.id;

            v_charged := v_charged + 1;

        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.job_charges (subscription_id, amount, status, error)
            VALUES (v_sub.id, COALESCE(v_fee, 0), 'FAILED', SQLERRM);

            UPDATE public.job_subscriptions
            SET consecutive_failures = consecutive_failures + 1,
                next_charge_at       = now() + make_interval(mins => COALESCE(v_interval, 60)),
                status = CASE WHEN consecutive_failures + 1 >= v_max_failures
                              THEN 'CANCELLED_PAYMENT_FAILED' ELSE status END,
                cancelled_at = CASE WHEN consecutive_failures + 1 >= v_max_failures
                                    THEN now() ELSE cancelled_at END
            WHERE id = v_sub.id;
        END;
    END LOOP;

    RETURN v_charged;
END;
$$;

REVOKE ALL ON FUNCTION public.job_subscriptions_charge_due() FROM PUBLIC;
