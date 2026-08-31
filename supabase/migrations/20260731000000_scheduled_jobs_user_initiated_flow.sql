-- ============================================================
-- Scheduled jobs: flip initiation from admin -> user, add an
-- admin approval gate, differentiate fee handling for one-time
-- vs. recurring jobs, and let the owner edit their draft content
-- any time before it publishes.
--
-- New flow:
--   1. User drafts a post + picks a date/time + recurring on/off
--      (+ optional interval/ends_at/subscription_fee if recurring)
--      -> user_create_scheduled_job() inserts PENDING_APPROVAL.
--   2. Admin reviews and approve/reject
--      (admin_approve_scheduled_job / admin_reject_scheduled_job).
--      Approval flips PENDING_APPROVAL -> ACTIVE; the existing cron
--      (scheduled_jobs_run_due, unchanged polling cadence) picks up
--      anything ACTIVE whose next_run_at has passed, so a job
--      approved after its scheduled time fires on the next tick
--      instead of being skipped.
--   3. One-time jobs (interval_minutes IS NULL): at run time, the
--      platform_settings.post_publish_fee (admin-configured, see
--      20260729100000_platform_fee.sql) is deducted from the
--      owner's wallet, same as post_publish() for un-scheduled
--      posts. Recurring jobs skip this charge entirely — the
--      owner monetizes a recurring "premium" post through
--      job_subscriptions/subscription_fee (unchanged) instead of
--      paying per publish.
--   4. The owner can edit title/content any time before the job's
--      terminal state via user_update_scheduled_job_draft(), for
--      both PENDING_APPROVAL and already-ACTIVE/PAUSED jobs, one-time
--      or recurring alike. This deliberately does NOT revoke approval
--      on edit — admin approval here is acceptance of the schedule/
--      subscription *request* (is this user allowed to run a paid
--      recurring job / get charged the publish fee), not a content
--      review, so there is nothing for an edit to bypass. Admin
--      still holds the kill switch via
--      admin_set_job_status('PAUSED'/'CANCELLED'); the owner has the
--      matching user_cancel_scheduled_job() before their own job runs.
--   5. Approval resets next_run_at to GREATEST(next_run_at, now()).
--      Without this, a recurring job whose approval was delayed past
--      several intervals would "catch up" by firing once per cron
--      tick (every minute) until caught up to now() — a burst of
--      near-simultaneous publishes instead of resuming the intended
--      cadence from the moment it goes live.
--   6. scheduled_jobs is added to the supabase_realtime publication
--      so a client hook (mirroring useTopUpNotifications) can tell
--      the owner of a recurring job "you can still edit this before
--      it publishes" without a separate notifications table — same
--      minimal pattern the wallet/top-up features already use.
--
-- Retired: admin_create_scheduled_job (admin no longer originates
-- jobs on a user's behalf under this flow). Its signature isn't
-- reused so DROP FUNCTION is used per the "return type/shape
-- changed" migration rule rather than CREATE OR REPLACE.
-- ============================================================

-- ── 1. Schema changes ────────────────────────────────────────────────────────

ALTER TABLE public.scheduled_jobs
    ADD COLUMN reviewed_by UUID REFERENCES public.profiles(id),
    ADD COLUMN reviewed_at TIMESTAMPTZ;

ALTER TABLE public.scheduled_jobs
    ALTER COLUMN status SET DEFAULT 'PENDING_APPROVAL';

ALTER TABLE public.scheduled_jobs
    DROP CONSTRAINT IF EXISTS scheduled_jobs_status_check;

ALTER TABLE public.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_status_check
    CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED', 'REJECTED'));

-- Admin's approval queue is now a hot query — same partial-index
-- pattern as the existing idx_scheduled_jobs_due.
CREATE INDEX idx_scheduled_jobs_pending ON public.scheduled_jobs (created_at) WHERE status = 'PENDING_APPROVAL';

-- ── 2. Retire admin-initiated creation ───────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_create_scheduled_job(UUID, TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ);

-- ── 3. user_create_scheduled_job ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_create_scheduled_job(
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
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Title is required';
    END IF;
    IF p_content IS NULL OR btrim(p_content) = '' THEN
        RAISE EXCEPTION 'Content is required';
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
    IF p_interval_minutes IS NULL AND p_subscription_fee <> 0 THEN
        RAISE EXCEPTION 'subscription_fee only applies to recurring jobs';
    END IF;

    INSERT INTO public.scheduled_jobs (
        created_by, user_id, title, content, interval_minutes,
        ends_at, subscription_fee, next_run_at, status
    ) VALUES (
        auth.uid(), auth.uid(), btrim(p_title), p_content, p_interval_minutes,
        p_ends_at, p_subscription_fee, p_scheduled_for, 'PENDING_APPROVAL'
    ) RETURNING id INTO v_job_id;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.user_create_scheduled_job(TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_create_scheduled_job(TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ) TO authenticated;

-- ── 4. user_update_scheduled_job_draft ───────────────────────────────────────
-- Owner-only edit of title/content. Allowed pre-terminal states only
-- (PENDING_APPROVAL/ACTIVE/PAUSED) — CANCELLED/COMPLETED/REJECTED jobs
-- are frozen. See header note on why this does not reset approval.

CREATE OR REPLACE FUNCTION public.user_update_scheduled_job_draft(
    p_job_id  UUID,
    p_title   TEXT,
    p_content TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    IF p_title IS NULL OR btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Title is required';
    END IF;
    IF p_content IS NULL OR btrim(p_content) = '' THEN
        RAISE EXCEPTION 'Content is required';
    END IF;

    UPDATE public.scheduled_jobs
    SET title = btrim(p_title), content = p_content, updated_at = now()
    WHERE id = p_job_id
      AND user_id = auth.uid()
      AND status IN ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found, not yours, or no longer editable', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.user_update_scheduled_job_draft(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_update_scheduled_job_draft(UUID, TEXT, TEXT) TO authenticated;

-- ── 5. admin_approve_scheduled_job / admin_reject_scheduled_job ─────────────

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

    -- Resume from "now", not from the original (possibly long-past)
    -- schedule — see header note 5 on the catch-up burst this avoids.
    UPDATE public.scheduled_jobs
    SET status = 'ACTIVE',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now(),
        next_run_at = GREATEST(next_run_at, now())
    WHERE id = p_job_id AND status = 'PENDING_APPROVAL';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found or not pending approval', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_scheduled_job(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_approve_scheduled_job(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_scheduled_job(p_job_id UUID)
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
    SET status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE id = p_job_id AND status = 'PENDING_APPROVAL';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found or not pending approval', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reject_scheduled_job(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_reject_scheduled_job(UUID) TO authenticated;

-- ── 6. user_cancel_scheduled_job ─────────────────────────────────────────────
-- The owner-side counterpart to admin_set_job_status — lets a user withdraw
-- their own request at any point before it reaches a terminal state.

CREATE OR REPLACE FUNCTION public.user_cancel_scheduled_job(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    UPDATE public.scheduled_jobs
    SET status = 'CANCELLED', updated_at = now()
    WHERE id = p_job_id
      AND user_id = auth.uid()
      AND status IN ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found, not yours, or already in a terminal state', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.user_cancel_scheduled_job(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_cancel_scheduled_job(UUID) TO authenticated;

-- ── 7. scheduled_jobs_run_due — one-time jobs only pay the publish fee ──────
-- Canonical body carried forward from 20260730000003 (advisory lock +
-- SKIP LOCKED unchanged); the only behavioral change is gating the fee
-- charge on `interval_minutes IS NULL` so recurring jobs publish for
-- free to their owner and monetize via subscription_fee instead.

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
    PERFORM pg_advisory_xact_lock(hashtext('scheduled_jobs_cron'));

    FOR v_job IN
        SELECT * FROM public.scheduled_jobs
        WHERE status = 'ACTIVE' AND next_run_at <= now()
        ORDER BY next_run_at
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            v_post_status := 'PUBLISHED';

            IF v_job.interval_minutes IS NULL THEN
                SELECT value::NUMERIC INTO v_fee
                FROM public.platform_settings WHERE key = 'post_publish_fee';
                v_fee := COALESCE(v_fee, 0);

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

-- ── 8. Realtime, for the "edit before it publishes" nudge ──────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_jobs;
