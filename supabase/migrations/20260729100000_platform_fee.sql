-- ============================================================
-- Platform Fee System
--
-- 1. platform_settings  — single-row config (post_publish_fee)
-- 2. posts.status       — PUBLISHED | DRAFT column
-- 3. post_publish       — user RPC: debit wallet atomically then insert post
-- 4. post_publish_free  — admin RPC: insert post without fee
-- 5. platform_fee_update— admin RPC: update the publish fee
-- ============================================================

-- ── 1. platform_settings ──────────────────────────────────────────────────

CREATE TABLE public.platform_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by UUID REFERENCES public.profiles(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the default fee (0 = free until admin sets it)
INSERT INTO public.platform_settings (key, value)
VALUES ('post_publish_fee', '0')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings (so the UI can show the fee)
CREATE POLICY "Anyone can read platform settings"
ON public.platform_settings FOR SELECT TO authenticated
USING (true);

-- Only service-role / RPCs may write (no direct client writes)

-- ── 2. Add status column to posts ─────────────────────────────────────────

ALTER TABLE public.posts
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PUBLISHED'
        CHECK (status IN ('PUBLISHED', 'DRAFT'));

-- Back-fill existing rows just in case
UPDATE public.posts SET status = 'PUBLISHED' WHERE status IS NULL;

-- Index for fast draft queries
CREATE INDEX IF NOT EXISTS idx_posts_status ON public.posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_user_status ON public.posts(user_id, status);

-- Update the public read policy: only PUBLISHED posts are visible to everyone;
-- users can still see their own DRAFT posts.
DROP POLICY IF EXISTS "Anyone can read posts" ON public.posts;

CREATE POLICY "Published posts are public"
ON public.posts FOR SELECT TO authenticated
USING (
    status = 'PUBLISHED'
    OR user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = TRUE
    )
);

-- ── 3. RPC: platform_fee_update (admin-only) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.platform_fee_update(p_fee NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;

    IF p_fee < 0 THEN
        RAISE EXCEPTION 'Fee cannot be negative';
    END IF;

    INSERT INTO public.platform_settings (key, value, updated_by, updated_at)
    VALUES ('post_publish_fee', p_fee::TEXT, auth.uid(), now())
    ON CONFLICT (key) DO UPDATE
        SET value      = EXCLUDED.value,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_fee_update(NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_fee_update(NUMERIC) TO authenticated;

-- ── 4. RPC: post_publish (user-facing) ───────────────────────────────────
-- Atomically:
--   a) Read current publish fee
--   b) If fee > 0: check user has a wallet with enough balance, debit it
--   c) Insert post with status = PUBLISHED  (or DRAFT if insufficient funds)
-- Returns a JSON object: { post_id, status, fee_charged, new_balance }

CREATE OR REPLACE FUNCTION public.post_publish(
    p_title   TEXT,
    p_content TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fee           NUMERIC;
    v_wallet_id     UUID;
    v_balance       NUMERIC;
    v_new_balance   NUMERIC;
    v_post_id       BIGINT;
    v_status        TEXT;
    v_fee_charged   NUMERIC := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Read fee
    SELECT value::NUMERIC INTO v_fee
    FROM public.platform_settings WHERE key = 'post_publish_fee';
    v_fee := COALESCE(v_fee, 0);

    IF v_fee > 0 THEN
        -- Look up user's wallet
        SELECT id, balance_cached INTO v_wallet_id, v_balance
        FROM public.wallets
        WHERE member_id = auth.uid()
        FOR UPDATE;                  -- lock row to prevent race conditions

        IF NOT FOUND THEN
            -- No wallet → save as draft
            v_status := 'DRAFT';
        ELSIF v_balance < v_fee THEN
            -- Insufficient balance → save as draft
            v_status := 'DRAFT';
        ELSE
            -- Enough balance → debit and publish
            v_new_balance := v_balance - v_fee;

            UPDATE public.wallets
            SET balance_cached = v_new_balance,
                updated_at     = now()
            WHERE id = v_wallet_id;

            INSERT INTO public.wallet_transactions (
                wallet_id, transaction_type, direction, amount,
                balance_after, reason, actor_type, actor_id
            ) VALUES (
                v_wallet_id, 'POST_PUBLISH_FEE', 'DEBIT', v_fee,
                v_new_balance, 'Platform fee for publishing post',
                'SYSTEM', auth.uid()
            );

            v_fee_charged := v_fee;
            v_status      := 'PUBLISHED';
        END IF;
    ELSE
        -- Fee is 0 → always publish free
        v_status := 'PUBLISHED';
    END IF;

    -- Insert the post
    INSERT INTO public.posts (user_id, title, content, status)
    VALUES (auth.uid(), p_title, p_content, v_status)
    RETURNING id INTO v_post_id;

    RETURN jsonb_build_object(
        'post_id',      v_post_id,
        'status',       v_status,
        'fee_charged',  v_fee_charged,
        'new_balance',  COALESCE(v_new_balance, v_balance, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.post_publish(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.post_publish(TEXT, TEXT) TO authenticated;

-- ── 5. RPC: post_publish_free (admin-only) ────────────────────────────────
-- Admin can publish a draft post without charging any fee.

CREATE OR REPLACE FUNCTION public.post_publish_free(p_post_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;

    UPDATE public.posts
    SET status     = 'PUBLISHED',
        updated_at = now()
    WHERE id = p_post_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Post % not found', p_post_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.post_publish_free(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.post_publish_free(BIGINT) TO authenticated;

-- ── 6. Allow POST_PUBLISH_FEE in wallet_transactions ─────────────────────
-- The existing CHECK constraint only allows TOP_UP, TRANSFER, ADMIN_ADJUSTMENT.
-- Add POST_PUBLISH_FEE to the allowed list.

ALTER TABLE public.wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;

ALTER TABLE public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type IN (
        'TOP_UP',
        'TRANSFER',
        'ADMIN_ADJUSTMENT',
        'POST_PUBLISH_FEE'
    ));
