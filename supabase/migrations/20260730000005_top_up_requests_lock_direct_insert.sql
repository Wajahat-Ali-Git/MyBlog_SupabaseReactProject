-- ============================================================
-- Close the top_up_requests wallet-ownership bypass.
--
-- The INSERT policy's WITH CHECK only verified `member_id = auth.uid()`
-- — nothing tied `wallet_id` to that member. wallet_id and member_id are
-- independent columns (separate FKs to wallets(id) / profiles(id) with
-- no constraint linking them), so a client could insert a request for
-- their own member_id pointing at ANY wallet_id:
--
--   supabase.from('top_up_requests').insert({
--     wallet_id: someoneElsesWalletId, member_id: auth.uid(), amount: 5000, ...
--   })
--
-- wallet_approve_top_up() trusts wallet_id from the row without
-- cross-checking it against member_id, so an admin approving in good
-- faith credits the wrong wallet. This also skips assert_aal2()
-- entirely, since wallet_submit_top_up_request() — the only place that
-- calls it — never runs on this path.
--
-- No code in src/ inserts into top_up_requests directly; the only write
-- path used by the app is supabase.rpc('wallet_submit_top_up_request'),
-- which already validates wallet ownership and requires AAL2. Removing
-- direct INSERT access (same treatment as posts in
-- 20260730000004_posts_lock_direct_writes.sql) closes the bypass
-- completely rather than just patching the ownership check, since RLS
-- alone can't cleanly restore the AAL2 gate.
--
-- Also adds a defense-in-depth cross-check inside wallet_approve_top_up
-- itself, given this codebase's history of guards silently disappearing
-- across CREATE OR REPLACE forks (see wallet_transfer /
-- wallet_admin_adjust regressions fixed earlier) — if some future
-- migration reopens an insert path, this still catches a mismatched
-- wallet_id/member_id pair before crediting.
-- ============================================================

DROP POLICY IF EXISTS "Members can submit top-up requests" ON public.top_up_requests;

CREATE OR REPLACE FUNCTION public.wallet_approve_top_up(p_request_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet_id     UUID;
    v_member_id     UUID;
    v_amount        NUMERIC;
    v_status_req    TEXT;
    v_wallet_status TEXT;
    v_new_balance   NUMERIC;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE
    ) THEN RAISE EXCEPTION 'Not authorized: admin role required'; END IF;
    PERFORM public.assert_aal2();

    SELECT wallet_id, member_id, amount, status
    INTO   v_wallet_id, v_member_id, v_amount, v_status_req
    FROM   public.top_up_requests WHERE id = p_request_id FOR UPDATE;

    IF NOT FOUND     THEN RAISE EXCEPTION 'Top-up request % not found', p_request_id; END IF;
    IF v_status_req <> 'PENDING' THEN RAISE EXCEPTION 'Request is already % — cannot approve', v_status_req; END IF;

    -- Defense-in-depth: the request's wallet must actually belong to the
    -- member who submitted it. wallet_submit_top_up_request() already
    -- guarantees this at insert time, and direct client INSERT is now
    -- blocked entirely (see DROP POLICY above) — this is a second,
    -- independent gate in case that ever regresses.
    IF NOT EXISTS (
        SELECT 1 FROM public.wallets WHERE id = v_wallet_id AND member_id = v_member_id
    ) THEN
        RAISE EXCEPTION 'Top-up request wallet does not belong to the requesting member';
    END IF;

    SELECT status INTO v_wallet_status FROM public.wallets WHERE id = v_wallet_id FOR UPDATE;
    IF v_wallet_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Wallet is % — cannot credit a non-active wallet', v_wallet_status;
    END IF;

    UPDATE public.wallets
    SET balance_cached = balance_cached + v_amount, updated_at = now()
    WHERE id = v_wallet_id
    RETURNING balance_cached INTO v_new_balance;

    INSERT INTO public.wallet_transactions (
        wallet_id, transaction_type, direction, amount,
        balance_after, reason, actor_type, actor_id
    ) VALUES (
        v_wallet_id, 'TOP_UP', 'CREDIT', v_amount,
        v_new_balance, 'Top-up approved by admin', 'ADMIN', auth.uid()
    );

    UPDATE public.top_up_requests
    SET status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_request_id;

    RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_approve_top_up(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_approve_top_up(UUID) TO authenticated;
