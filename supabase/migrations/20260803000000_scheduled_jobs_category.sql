-- ============================================================
-- Give scheduled_jobs a category, matching posts.category (same
-- fixed list) so a user can categorize a scheduled/recurring post
-- the same way they categorize a regular one, and scheduled_jobs_run_due()
-- can carry that category onto the published post instead of always
-- falling back to 'Uncategorized' (the gap noted when
-- 20260802000000 was reviewed).
--
-- user_create_scheduled_job and user_update_scheduled_job_draft both
-- gain a p_category parameter — DROP + CREATE, not CREATE OR REPLACE,
-- since an added parameter is a different function signature even
-- though neither return type changes.
-- ============================================================

-- ── 1. scheduled_jobs.category ──────────────────────────────────────────────

ALTER TABLE public.scheduled_jobs
    ADD COLUMN category TEXT NOT NULL DEFAULT 'Uncategorized'
        CHECK (category IN (
            'Technology', 'Business', 'Lifestyle', 'Health',
            'Travel', 'Food', 'Education', 'Entertainment', 'Uncategorized'
        ));

-- ── 2. user_create_scheduled_job: accept a category ─────────────────────────

DROP FUNCTION IF EXISTS public.user_create_scheduled_job(TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ);

CREATE FUNCTION public.user_create_scheduled_job(
    p_title             TEXT,
    p_content           TEXT,
    p_scheduled_for     TIMESTAMPTZ,
    p_interval_minutes  INT DEFAULT NULL,
    p_subscription_fee  NUMERIC DEFAULT 0,
    p_ends_at           TIMESTAMPTZ DEFAULT NULL,
    p_category          TEXT DEFAULT 'Uncategorized'
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
    IF p_category IS NULL OR p_category NOT IN (
        'Technology', 'Business', 'Lifestyle', 'Health',
        'Travel', 'Food', 'Education', 'Entertainment', 'Uncategorized'
    ) THEN
        RAISE EXCEPTION 'Invalid category: %', p_category;
    END IF;

    INSERT INTO public.scheduled_jobs (
        created_by, user_id, title, content, interval_minutes,
        ends_at, subscription_fee, next_run_at, status, category
    ) VALUES (
        auth.uid(), auth.uid(), btrim(p_title), p_content, p_interval_minutes,
        p_ends_at, p_subscription_fee, p_scheduled_for, 'PENDING_APPROVAL', p_category
    ) RETURNING id INTO v_job_id;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.user_create_scheduled_job(TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_create_scheduled_job(TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TIMESTAMPTZ, TEXT) TO authenticated;

-- ── 3. user_update_scheduled_job_draft: allow changing category too ────────

DROP FUNCTION IF EXISTS public.user_update_scheduled_job_draft(UUID, TEXT, TEXT);

CREATE FUNCTION public.user_update_scheduled_job_draft(
    p_job_id   UUID,
    p_title    TEXT,
    p_content  TEXT,
    p_category TEXT
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
    IF p_category IS NULL OR p_category NOT IN (
        'Technology', 'Business', 'Lifestyle', 'Health',
        'Travel', 'Food', 'Education', 'Entertainment', 'Uncategorized'
    ) THEN
        RAISE EXCEPTION 'Invalid category: %', p_category;
    END IF;

    UPDATE public.scheduled_jobs
    SET title = btrim(p_title), content = p_content, category = p_category, updated_at = now()
    WHERE id = p_job_id
      AND user_id = auth.uid()
      AND status IN ('PENDING_APPROVAL', 'ACTIVE', 'PAUSED');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found, not yours, or no longer editable', p_job_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.user_update_scheduled_job_draft(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_update_scheduled_job_draft(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ── 4. scheduled_jobs_run_due: carry the job's category onto the post ──────
-- Canonical body carried forward from 20260802000000 (advisory lock,
-- SKIP LOCKED, one-time-only fee gate, is_recurring_feed flag all
-- unchanged) — the only change is passing v_job.category through
-- instead of leaving the post to fall back to its own default.

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

            INSERT INTO public.posts (user_id, title, content, status, is_recurring_feed, category)
            VALUES (v_job.user_id, v_job.title, v_job.content, v_post_status, v_job.interval_minutes IS NOT NULL, v_job.category)
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
