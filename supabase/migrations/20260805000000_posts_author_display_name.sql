-- ============================================================
-- Show a byline (author name) on posts without opening up profiles.
--
-- profiles RLS only allows a user to read their own row
-- ("Users can view own profile" USING (auth.uid() = id), from
-- 20260722000000) — there is no policy letting one user read
-- another's profile. A client-side embedded join
-- (posts.select("*, profiles(username,full_name)")) would silently
-- return profiles: null for every post not authored by the viewer.
--
-- Rather than loosen profiles RLS (used elsewhere for wallet-search
-- privacy — see wallet_search_users' own comment on why that stayed
-- an RPC instead of a broader policy) or add a new lookup RPC, this
-- denormalizes a snapshot of the author's display name onto posts
-- at publish time — same pattern as category/is_recurring_feed
-- earlier in this feature. Trade-off: a post's byline reflects the
-- author's name *at the time they published*, not their current
-- name if they've since changed it. Acceptable for a byline (most
-- platforms behave this way for historical posts) and avoids a
-- second query or RLS change entirely.
-- ============================================================

ALTER TABLE public.posts
    ADD COLUMN author_display_name TEXT NOT NULL DEFAULT 'Unknown';

-- ── post_publish: stamp the author's display name ──────────────────────────
-- Canonical body carried forward from 20260801000000 (category
-- validation, fee logic, assert_aal2() all unchanged) — only the
-- author name lookup + INSERT column are new.

CREATE OR REPLACE FUNCTION public.post_publish(
    p_title    TEXT,
    p_content  TEXT,
    p_category TEXT DEFAULT 'Uncategorized'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_fee           NUMERIC;
    v_wallet_id     UUID;
    v_wallet_status TEXT;
    v_balance       NUMERIC;
    v_new_balance   NUMERIC;
    v_post_id       BIGINT;
    v_status        TEXT;
    v_fee_charged   NUMERIC := 0;
    v_author_name   TEXT;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    IF p_category IS NULL OR p_category NOT IN (
        'Technology', 'Business', 'Lifestyle', 'Health',
        'Travel', 'Food', 'Education', 'Entertainment', 'Uncategorized'
    ) THEN
        RAISE EXCEPTION 'Invalid category: %', p_category;
    END IF;

    SELECT COALESCE(NULLIF(btrim(full_name), ''), NULLIF(btrim(username), ''), 'Unknown')
    INTO v_author_name
    FROM public.profiles WHERE id = auth.uid();
    v_author_name := COALESCE(v_author_name, 'Unknown');

    SELECT value::NUMERIC INTO v_fee FROM public.platform_settings WHERE key = 'post_publish_fee';
    v_fee := COALESCE(v_fee, 0);

    IF v_fee > 0 THEN
        SELECT id, balance_cached, status INTO v_wallet_id, v_balance, v_wallet_status
        FROM public.wallets WHERE member_id = auth.uid() FOR UPDATE;

        IF NOT FOUND OR v_wallet_status <> 'ACTIVE' OR v_balance < v_fee THEN
            v_status := 'DRAFT';
        ELSE
            v_new_balance := v_balance - v_fee;
            UPDATE public.wallets SET balance_cached = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
            INSERT INTO public.wallet_transactions (
                wallet_id, transaction_type, direction, amount,
                balance_after, reason, actor_type, actor_id
            ) VALUES (
                v_wallet_id, 'POST_PUBLISH_FEE', 'DEBIT', v_fee,
                v_new_balance, 'Platform fee for publishing post', 'SYSTEM', auth.uid()
            );
            v_fee_charged := v_fee;
            v_status      := 'PUBLISHED';
        END IF;
    ELSE
        v_status := 'PUBLISHED';
    END IF;

    INSERT INTO public.posts (user_id, title, content, status, category, author_display_name)
    VALUES (auth.uid(), p_title, p_content, v_status, p_category, v_author_name)
    RETURNING id INTO v_post_id;

    RETURN jsonb_build_object(
        'post_id',     v_post_id,
        'status',      v_status,
        'fee_charged', v_fee_charged,
        'new_balance', COALESCE(v_new_balance, v_balance, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.post_publish(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.post_publish(TEXT, TEXT, TEXT) TO authenticated;

-- ── scheduled_jobs_run_due: stamp the job owner's display name ─────────────
-- Canonical body carried forward from 20260803000000 (advisory lock,
-- SKIP LOCKED, one-time-only fee gate, is_recurring_feed, category —
-- all unchanged). Looked up by v_job.user_id (the post owner), not
-- auth.uid() — this function runs unattended via pg_cron, so there is
-- no calling user.

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
    v_author_name   TEXT;
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

            SELECT COALESCE(NULLIF(btrim(full_name), ''), NULLIF(btrim(username), ''), 'Unknown')
            INTO v_author_name
            FROM public.profiles WHERE id = v_job.user_id;
            v_author_name := COALESCE(v_author_name, 'Unknown');

            INSERT INTO public.posts (user_id, title, content, status, is_recurring_feed, category, author_display_name)
            VALUES (v_job.user_id, v_job.title, v_job.content, v_post_status, v_job.interval_minutes IS NOT NULL, v_job.category, v_author_name)
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
