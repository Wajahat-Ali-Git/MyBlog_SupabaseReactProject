-- ============================================================
-- Scheduled Jobs: RPCs
--
-- Deliberately NOT retrofitted into this migration: wallet_transfer,
-- wallet_admin_adjust, and post_publish keep their existing inline
-- debit logic. They are already fixed/tested (20260729500001,
-- 20260729500002) and re-touching them here would only be a DRY
-- improvement, not a functional requirement — not worth the
-- regression risk of editing already-stabilized money-moving
-- functions in the same change that introduces new ones. New code
-- (job_subscriptions_charge_due, scheduled_jobs_run_due) uses the
-- shared _wallet_debit() helper below so duplication doesn't grow
-- any further.
-- ============================================================

-- ── 0. Internal helper: _wallet_debit ───────────────────────────────────────
-- Not part of the public API: REVOKE ALL FROM PUBLIC and no GRANT to
-- `authenticated` at all. It performs no auth.uid()/ownership check —
-- callers are responsible for authorizing the action before calling this.
-- Callable only by other SECURITY DEFINER functions owned by the same
-- role (Postgres checks EXECUTE privilege against the effective owner
-- role inside a SECURITY DEFINER function, and owners always have
-- implicit EXECUTE on their own functions regardless of REVOKE).

CREATE OR REPLACE FUNCTION public._wallet_debit(
    p_wallet_id        UUID,
    p_amount           NUMERIC,
    p_transaction_type TEXT,
    p_reason           TEXT,
    p_actor_type       TEXT,
    p_actor_id         UUID
)
RETURNS TABLE (new_balance NUMERIC, transaction_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_balance     NUMERIC;
    v_status      TEXT;
    v_new_balance NUMERIC;
    v_tx_id       UUID;
BEGIN
    SELECT balance_cached, status INTO v_balance, v_status
    FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;
    IF v_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Wallet is % and cannot be debited', v_status;
    END IF;
    IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'Amount must have at most 2 decimal places';
    END IF;
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;
    IF v_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    v_new_balance := v_balance - p_amount;

    UPDATE public.wallets
    SET balance_cached = v_new_balance, updated_at = now()
    WHERE id = p_wallet_id;

    INSERT INTO public.wallet_transactions (
        wallet_id, transaction_type, direction, amount, balance_after, reason, actor_type, actor_id
    ) VALUES (
        p_wallet_id, p_transaction_type, 'DEBIT', p_amount, v_new_balance, p_reason, p_actor_type, p_actor_id
    ) RETURNING id INTO v_tx_id;

    RETURN QUERY SELECT v_new_balance, v_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public._wallet_debit(UUID, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;

-- ── 1. admin_create_scheduled_job ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_create_scheduled_job(
    p_user_id           UUID,
    p_title             TEXT,
    p_content           TEXT,
    p_scheduled_for     TIMESTAMPTZ,
    p_interval_minutes  INT DEFAULT NULL,
    p_subscription_fee  NUMERIC DEFAULT 0,
    p_ends_at           TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;
    PERFORM public.assert_aal2();

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Title is required';
    END IF;
    IF p_content IS NULL OR btrim(p_content) = '' THEN
        RAISE EXCEPTION 'Content is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Target user % not found', p_user_id;
    END IF;
    IF p_scheduled_for IS NULL OR p_scheduled_for <= now() THEN
        RAISE EXCEPTION 'scheduled_for must be in the future';
    END IF;
    IF p_interval_minutes IS NOT NULL AND p_interval_minutes < 1 THEN
        RAISE EXCEPTION 'interval_minutes must be at least 1';
    END IF;
    IF p_ends_at IS NOT NULL AND p_interval_minutes IS NULL THEN
        RAISE EXCEPTION 'ends_at only applies to recurring jobs';
    END IF;
    IF p_ends_at IS NOT NULL AND p_ends_at <= p_scheduled_for THEN
        RAISE EXCEPTION 'ends_at must be after scheduled_for';
    END IF;
    IF p_subscription_fee IS NULL OR p_subscription_fee < 0
       OR p_subscription_fee <> round(p_subscription_fee, 2) THEN
        RAISE EXCEPTION 'subscription_fee must be a non-negative amount with at most 2 decimal places';
    END IF;

    INSERT INTO public.scheduled_jobs (
        created_by, user_id, title, content, interval_minutes,
        ends_at, subscription_fee, next_run_at
    ) VALUES (
        auth.uid(), p_user_id, btrim(p_title), p_content, p_interval_minutes,
        p_ends_at, p_subscription_fee, p_scheduled_for
    ) RETURNING id INTO v_job_id;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_scheduled_job(UUID, TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_create_scheduled_job(UUID, TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ) TO authenticated;

-- ── 2. admin_update_job_interval ────────────────────────────────────────────
-- The "dynamic, down to minutes" knob. Takes effect on the job's NEXT tick —
-- no cron schedule change needed, since both cron functions poll every
-- minute regardless of any individual job's configured cadence.

CREATE OR REPLACE FUNCTION public.admin_update_job_interval(
    p_job_id           UUID,
    p_interval_minutes INT
)
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

    IF p_interval_minutes IS NULL OR p_interval_minutes < 1 THEN
        RAISE EXCEPTION 'interval_minutes must be at least 1';
    END IF;

    UPDATE public.scheduled_jobs
    SET interval_minutes = p_interval_minutes, updated_at = now()
    WHERE id = p_job_id
      AND status IN ('ACTIVE', 'PAUSED')
      AND interval_minutes IS NOT NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found, not editable, or not a recurring job', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_job_interval(UUID, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_job_interval(UUID, INT) TO authenticated;

-- ── 3. admin_set_job_status (pause / resume / cancel) ───────────────────────

CREATE OR REPLACE FUNCTION public.admin_set_job_status(
    p_job_id UUID,
    p_status TEXT
)
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

    IF p_status NOT IN ('ACTIVE', 'PAUSED', 'CANCELLED') THEN
        RAISE EXCEPTION 'status must be ACTIVE, PAUSED, or CANCELLED';
    END IF;

    UPDATE public.scheduled_jobs
    SET status = p_status, updated_at = now()
    WHERE id = p_job_id AND status IN ('ACTIVE', 'PAUSED');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found or already in a terminal state', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_job_status(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_job_status(UUID, TEXT) TO authenticated;

-- ── 4. subscribe_to_job ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.subscribe_to_job(p_job_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job_status      TEXT;
    v_interval        INT;
    v_wallet_status   TEXT;
    v_subscription_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    SELECT status, interval_minutes INTO v_job_status, v_interval
    FROM public.scheduled_jobs WHERE id = p_job_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found', p_job_id;
    END IF;
    IF v_job_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Job is % and not accepting subscriptions', v_job_status;
    END IF;
    IF v_interval IS NULL THEN
        RAISE EXCEPTION 'This is a one-time job and cannot be subscribed to';
    END IF;

    -- Validate the subscriber's wallet up front — fail fast at subscribe
    -- time rather than silently accumulating a subscription that will
    -- never successfully bill.
    SELECT status INTO v_wallet_status FROM public.wallets WHERE member_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'You need a wallet before subscribing';
    END IF;
    IF v_wallet_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Your wallet is % and cannot be used for a subscription', v_wallet_status;
    END IF;

    INSERT INTO public.job_subscriptions (job_id, user_id, next_charge_at)
    VALUES (p_job_id, auth.uid(), now() + make_interval(mins => v_interval))
    ON CONFLICT (job_id, user_id) DO UPDATE
        SET status               = 'ACTIVE',
            next_charge_at       = now() + make_interval(mins => v_interval),
            consecutive_failures = 0,
            cancelled_at         = NULL
        WHERE job_subscriptions.status <> 'ACTIVE'
    RETURNING id INTO v_subscription_id;

    IF v_subscription_id IS NULL THEN
        RAISE EXCEPTION 'You are already subscribed to this job';
    END IF;

    RETURN v_subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.subscribe_to_job(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.subscribe_to_job(UUID) TO authenticated;

-- ── 5. unsubscribe_from_job ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unsubscribe_from_job(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    UPDATE public.job_subscriptions
    SET status = 'CANCELLED', cancelled_at = now()
    WHERE job_id = p_job_id AND user_id = auth.uid() AND status = 'ACTIVE';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active subscription found for this job';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unsubscribe_from_job(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.unsubscribe_from_job(UUID) TO authenticated;

-- ── 6. scheduled_jobs_run_due — CRON ONLY ───────────────────────────────────
-- Unattended: no auth.uid(), so no admin/AAL2 check makes sense here.
-- Authorization boundary is the grant list below — do NOT add a GRANT to
-- `authenticated` for this function.

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
            -- One job's failure must not sink the whole batch, and must not
            -- leave a half-charged, unpublished post — the nested block's
            -- implicit savepoint rolls back everything since BEGIN above.
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

-- ── 7. job_subscriptions_charge_due — CRON ONLY ─────────────────────────────
-- Same authorization model as scheduled_jobs_run_due(): no GRANT to
-- `authenticated`, ever.

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
            SELECT subscription_fee, interval_minutes INTO v_fee, v_interval
            FROM public.scheduled_jobs WHERE id = v_sub.job_id;

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
