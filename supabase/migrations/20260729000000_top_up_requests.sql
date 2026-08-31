-- ============================================================
-- Top-Up Requests
-- Implements a pending-approval flow for wallet top-ups.
--
-- Flow:
--   1. User submits a top-up request → row inserted with status='PENDING'
--   2. Admin approves → wallet_approve_top_up RPC credits wallet atomically
--   3. Admin rejects → wallet_reject_top_up RPC updates status='REJECTED'
--   4. Both sides use Supabase Realtime on this table for live updates.
-- ============================================================

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE public.top_up_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    wallet_id       UUID NOT NULL
        REFERENCES public.wallets(id)
        ON DELETE CASCADE,

    member_id       UUID NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    amount          NUMERIC(12,2) NOT NULL
        CHECK (amount > 0),

    currency        TEXT NOT NULL DEFAULT 'USD',

    status          TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),

    -- Set by the approve/reject RPCs
    reviewed_by     UUID REFERENCES public.profiles(id),
    reviewed_at     TIMESTAMPTZ,
    rejection_note  TEXT,

    -- Payment reference forwarded from the payment adapter (stub or real)
    payment_reference TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX idx_top_up_requests_member   ON public.top_up_requests(member_id);
CREATE INDEX idx_top_up_requests_wallet   ON public.top_up_requests(wallet_id);
CREATE INDEX idx_top_up_requests_status   ON public.top_up_requests(status);
CREATE INDEX idx_top_up_requests_created  ON public.top_up_requests(created_at DESC);

-- ── updated_at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_top_up_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_top_up_requests_updated_at
BEFORE UPDATE ON public.top_up_requests
FOR EACH ROW EXECUTE FUNCTION public.set_top_up_requests_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.top_up_requests ENABLE ROW LEVEL SECURITY;

-- Members can INSERT their own requests
CREATE POLICY "Members can submit top-up requests"
ON public.top_up_requests
FOR INSERT
TO authenticated
WITH CHECK (member_id = auth.uid());

-- Members can SELECT their own requests (for status polling / realtime)
CREATE POLICY "Members can view their own top-up requests"
ON public.top_up_requests
FOR SELECT
TO authenticated
USING (member_id = auth.uid());

-- Admins can SELECT all requests
CREATE POLICY "Admins can view all top-up requests"
ON public.top_up_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = TRUE
    )
);

-- No direct UPDATE/DELETE from client — all mutations go through RPCs.

-- ── Enable Realtime ────────────────────────────────────────────────────────
-- Supabase requires the table to be added to the publication for realtime.
-- The 'supabase_realtime' publication is created by the platform automatically.

ALTER PUBLICATION supabase_realtime ADD TABLE public.top_up_requests;

-- ── RPC: wallet_submit_top_up_request ──────────────────────────────────────
-- Called by the user's client to create a PENDING top-up request.
-- Validates ownership and positive amount; stores an optional payment reference.

CREATE OR REPLACE FUNCTION public.wallet_submit_top_up_request(
    p_wallet_id         UUID,
    p_amount            NUMERIC,
    p_payment_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_id UUID;
    v_request_id UUID;
BEGIN
    -- Verify the wallet belongs to the caller
    SELECT member_id INTO v_member_id
    FROM public.wallets
    WHERE id = p_wallet_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found', p_wallet_id;
    END IF;

    IF v_member_id <> auth.uid() THEN
        RAISE EXCEPTION 'Not authorized: wallet does not belong to current user';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Top-up amount must be positive';
    END IF;

    INSERT INTO public.top_up_requests (
        wallet_id, member_id, amount, payment_reference
    )
    VALUES (
        p_wallet_id, auth.uid(), p_amount, p_payment_reference
    )
    RETURNING id INTO v_request_id;

    RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_submit_top_up_request(UUID, NUMERIC, TEXT) TO authenticated;

-- ── RPC: wallet_approve_top_up ─────────────────────────────────────────────
-- Admin-only. Atomically:
--   1. Checks admin role
--   2. Marks request APPROVED
--   3. Credits wallet via wallet_top_up logic (inline to stay atomic)
--   4. Returns the new wallet balance

CREATE OR REPLACE FUNCTION public.wallet_approve_top_up(
    p_request_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet_id  UUID;
    v_member_id  UUID;
    v_amount     NUMERIC;
    v_status     TEXT;
    v_new_balance NUMERIC;
    v_tx_id      UUID;
BEGIN
    -- Admin check
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;

    -- Lock the request row
    SELECT wallet_id, member_id, amount, status
    INTO v_wallet_id, v_member_id, v_amount, v_status
    FROM public.top_up_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Top-up request % not found', p_request_id;
    END IF;

    IF v_status <> 'PENDING' THEN
        RAISE EXCEPTION 'Request is already % — cannot approve', v_status;
    END IF;

    -- Credit the wallet
    UPDATE public.wallets
    SET balance_cached = balance_cached + v_amount,
        updated_at     = now()
    WHERE id = v_wallet_id
    RETURNING balance_cached INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet % not found during approval', v_wallet_id;
    END IF;

    -- Write ledger entry (TOP_UP type, actor = admin)
    INSERT INTO public.wallet_transactions (
        wallet_id, transaction_type, direction, amount,
        balance_after, reason, actor_type, actor_id
    )
    VALUES (
        v_wallet_id, 'TOP_UP', 'CREDIT', v_amount,
        v_new_balance,
        'Top-up approved by admin',
        'ADMIN', auth.uid()
    )
    RETURNING id INTO v_tx_id;

    -- Mark request as approved
    UPDATE public.top_up_requests
    SET status      = 'APPROVED',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;

    RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_approve_top_up(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_approve_top_up(UUID) TO authenticated;

-- ── RPC: wallet_reject_top_up ──────────────────────────────────────────────
-- Admin-only. Marks the request REJECTED with an optional note.

CREATE OR REPLACE FUNCTION public.wallet_reject_top_up(
    p_request_id    UUID,
    p_note          TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    -- Admin check
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = TRUE
    ) THEN
        RAISE EXCEPTION 'Not authorized: admin role required';
    END IF;

    SELECT status INTO v_status
    FROM public.top_up_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Top-up request % not found', p_request_id;
    END IF;

    IF v_status <> 'PENDING' THEN
        RAISE EXCEPTION 'Request is already % — cannot reject', v_status;
    END IF;

    UPDATE public.top_up_requests
    SET status         = 'REJECTED',
        reviewed_by    = auth.uid(),
        reviewed_at    = now(),
        rejection_note = p_note
    WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_reject_top_up(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.wallet_reject_top_up(UUID, TEXT) TO authenticated;
