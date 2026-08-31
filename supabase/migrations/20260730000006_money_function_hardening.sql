-- ============================================================
-- Money-function hardening.
--
-- 1. [Medium] wallet_submit_top_up_request was the only money-moving RPC
--    without the 2-decimal-place guard every sibling RPC has (wallet_transfer,
--    wallet_admin_adjust, wallet_approve_top_up). top_up_requests.amount is
--    NUMERIC(12,2), so an imprecise value (e.g. 0.005) would be silently
--    rounded at insert rather than rejected with a clear error — inconsistent
--    with the explicit-reject pattern used everywhere else. Added the same
--    check.
--
-- 2. [Medium] platform_fee_update accepted NULL, sub-cent values, and
--    unbounded values:
--      - `IF p_fee < 0` never fires for NULL (`NULL < 0` is NULL, not TRUE,
--        so plpgsql's IF treats it as false) — NULL slipped past the
--        validation and would have hit platform_settings.value's NOT NULL
--        constraint with a confusing generic error instead of a clear one.
--      - No 2dp check — platform_settings.value is TEXT (not NUMERIC), so
--        there's no column-level rounding safety net like other tables;
--        an imprecise fee (0.005) would be stored verbatim and later cast
--        back via `value::NUMERIC` in post_publish, while actual charges
--        (wallet_transactions.amount, NUMERIC(12,2)) would round — a
--        display/audit mismatch between the stored fee and what's charged.
--      - No upper bound — 1e30 accepted with no sanity ceiling.
--    Added explicit NULL/2dp/upper-bound checks with clear error messages.
--
-- 3. [Design note, not a bug] The publish fee debited in post_publish /
--    post_publish_retry has no matching credit anywhere in the ledger —
--    it's destroyed, not collected into a platform/revenue wallet. This
--    matches how platform_fee.sql was originally written and is being kept
--    as-is; this comment exists so the decision is explicit rather than an
--    accidental gap. If a real revenue-tracking requirement shows up later,
--    it needs a platform wallet to credit, which doesn't exist today.
--
-- 4. [High — broken user flow] Drafts created by insufficient balance had
--    no way to ever be published by their owner: post_publish only creates
--    NEW posts, post_publish_free is admin-only, and the frontend's
--    getMyDrafts() was dead code (never imported). Added
--    post_publish_retry(), a self-service "publish this draft now" RPC that
--    charges the fee and flips DRAFT -> PUBLISHED, mirroring post_publish's
--    fee logic exactly. Wired into the UI in the same change (see home.tsx).
-- ============================================================

-- ── 1. wallet_submit_top_up_request: add 2dp guard ──────────────────────────

CREATE OR REPLACE FUNCTION public.wallet_submit_top_up_request(
    p_wallet_id         UUID,
    p_amount            NUMERIC,
    p_payment_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_member_id  UUID;
    v_request_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    SELECT member_id INTO v_member_id FROM public.wallets WHERE id = p_wallet_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Wallet % not found', p_wallet_id; END IF;
    IF v_member_id <> auth.uid() THEN
        RAISE EXCEPTION 'Not authorized: wallet does not belong to current user';
    END IF;

    IF p_amount IS NULL OR p_amount <> round(p_amount, 2) THEN
        RAISE EXCEPTION 'Amount must have at most 2 decimal places';
    END IF;
    IF p_amount <= 0 THEN RAISE EXCEPTION 'Top-up amount must be positive'; END IF;

    INSERT INTO public.top_up_requests (wallet_id, member_id, amount, payment_reference)
    VALUES (p_wallet_id, auth.uid(), p_amount, p_payment_reference)
    RETURNING id INTO v_request_id;

    RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) TO authenticated;

-- ── 2. platform_fee_update: NULL / 2dp / upper-bound validation ────────────

CREATE OR REPLACE FUNCTION public.platform_fee_update(p_fee NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_admin = TRUE
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
    VALUES ('post_publish_fee', p_fee::TEXT, auth.uid(), now())
    ON CONFLICT (key) DO UPDATE
        SET value      = EXCLUDED.value,
            updated_by = EXCLUDED.updated_by,
            updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_fee_update(NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_fee_update(NUMERIC) TO authenticated;

-- ── 3. post_publish_retry: self-service "publish this draft now" ───────────

CREATE OR REPLACE FUNCTION public.post_publish_retry(p_post_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_post_owner    UUID;
    v_post_status   TEXT;
    v_fee           NUMERIC;
    v_wallet_id     UUID;
    v_wallet_status TEXT;
    v_balance       NUMERIC;
    v_new_balance   NUMERIC;
    v_fee_charged   NUMERIC := 0;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    PERFORM public.assert_aal2();

    SELECT user_id, status INTO v_post_owner, v_post_status
    FROM public.posts WHERE id = p_post_id FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Post % not found', p_post_id; END IF;
    IF v_post_owner <> auth.uid() THEN
        RAISE EXCEPTION 'Not authorized: you do not own this post';
    END IF;
    IF v_post_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Post is already %', v_post_status;
    END IF;

    SELECT value::NUMERIC INTO v_fee FROM public.platform_settings WHERE key = 'post_publish_fee';
    v_fee := COALESCE(v_fee, 0);

    IF v_fee > 0 THEN
        SELECT id, balance_cached, status INTO v_wallet_id, v_balance, v_wallet_status
        FROM public.wallets WHERE member_id = auth.uid() FOR UPDATE;

        IF NOT FOUND OR v_wallet_status <> 'ACTIVE' OR v_balance < v_fee THEN
            RAISE EXCEPTION 'Insufficient balance to publish this draft';
        END IF;

        v_new_balance := v_balance - v_fee;
        UPDATE public.wallets SET balance_cached = v_new_balance, updated_at = now() WHERE id = v_wallet_id;
        INSERT INTO public.wallet_transactions (
            wallet_id, transaction_type, direction, amount,
            balance_after, reason, actor_type, actor_id
        ) VALUES (
            v_wallet_id, 'POST_PUBLISH_FEE', 'DEBIT', v_fee,
            v_new_balance, 'Platform fee for publishing draft post', 'SYSTEM', auth.uid()
        );
        v_fee_charged := v_fee;
    END IF;

    UPDATE public.posts SET status = 'PUBLISHED', updated_at = now() WHERE id = p_post_id;

    RETURN jsonb_build_object(
        'post_id',     p_post_id,
        'status',      'PUBLISHED',
        'fee_charged', v_fee_charged,
        'new_balance', COALESCE(v_new_balance, v_balance, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.post_publish_retry(BIGINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.post_publish_retry(BIGINT) TO authenticated;
