-- ============================================================
-- Flag posts published from a recurring scheduled job so the
-- frontend can highlight them (star icon) as premium-feed content,
-- distinct from a regular self-published or one-time-scheduled post.
--
-- Denormalized boolean on posts rather than a join through
-- scheduled_job_runs -> scheduled_jobs at read time: the home page
-- renders this per-card on every page load, and scheduled_jobs_run_due()
-- already knows interval_minutes IS NOT NULL at insert time — storing
-- it once there is simpler than joining three tables on every feed
-- fetch for a value that never changes after publish.
--
-- Only scheduled_jobs_run_due() sets this to TRUE (for recurring jobs
-- only; one-time jobs still insert FALSE via the same column, since
-- v_job.interval_minutes IS NULL for those). post_publish (regular
-- user posts) and post_publish_retry (flips an existing draft's
-- status) are untouched — both correctly leave it at the FALSE default.
-- ============================================================

ALTER TABLE public.posts
    ADD COLUMN is_recurring_feed BOOLEAN NOT NULL DEFAULT FALSE;

-- ── scheduled_jobs_run_due: set is_recurring_feed on insert ────────────────
-- Canonical body carried forward from 20260731000000 (advisory lock,
-- SKIP LOCKED, and the one-time-only fee gate all unchanged) — the only
-- change is the added `is_recurring_feed` column in the INSERT.

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

            INSERT INTO public.posts (user_id, title, content, status, is_recurring_feed)
            VALUES (v_job.user_id, v_job.title, v_job.content, v_post_status, v_job.interval_minutes IS NOT NULL)
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
