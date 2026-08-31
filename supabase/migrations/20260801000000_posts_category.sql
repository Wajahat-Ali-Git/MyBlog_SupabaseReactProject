-- ============================================================
-- Add a category to posts so the home page can filter by topic.
--
-- Single fixed-list TEXT column with a CHECK constraint (same pattern
-- as posts.status) rather than a separate categories table — one
-- category per post is enough to support filtering, and a join table
-- would be premature for a feature that's just "pick one from a list."
--
-- post_publish gains an optional p_category (default 'Uncategorized'
-- so existing callers keep working). Signature is DROP + CREATE, not
-- CREATE OR REPLACE, per the "return type/shape changed" migration
-- rule — an added parameter is a different function identity even
-- though the return type (JSONB) is unchanged. Canonical body carried
-- forward from 20260729400001_mfa_aal2_enforcement.sql (the latest
-- prior version — auth check, assert_aal2(), fee logic all unchanged).
-- ============================================================

-- ── 1. posts.category ────────────────────────────────────────────────────────

ALTER TABLE public.posts
    ADD COLUMN category TEXT NOT NULL DEFAULT 'Uncategorized'
        CHECK (category IN (
            'Technology', 'Business', 'Lifestyle', 'Health',
            'Travel', 'Food', 'Education', 'Entertainment', 'Uncategorized'
        ));

CREATE INDEX idx_posts_category ON public.posts(category) WHERE status = 'PUBLISHED';

-- ── 2. post_publish: accept an optional category ────────────────────────────

DROP FUNCTION IF EXISTS public.post_publish(TEXT, TEXT);

CREATE FUNCTION public.post_publish(
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
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    IF p_category IS NULL OR p_category NOT IN (
        'Technology', 'Business', 'Lifestyle', 'Health',
        'Travel', 'Food', 'Education', 'Entertainment', 'Uncategorized'
    ) THEN
        RAISE EXCEPTION 'Invalid category: %', p_category;
    END IF;

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

    INSERT INTO public.posts (user_id, title, content, status, category)
    VALUES (auth.uid(), p_title, p_content, v_status, p_category)
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
