-- ============================================================
-- Scheduled Jobs: admin-scheduled (one-time or recurring) posts
-- with optional per-user paid subscriptions.
--
-- Tables:
--   scheduled_jobs      — admin-defined job definition
--   scheduled_job_runs  — history of each publish attempt (one row/tick)
--   job_subscriptions   — users opted in to a job; independent billing clock
--   job_charges         — history of each billing attempt per subscription
--
-- All writes to these tables go through SECURITY DEFINER RPCs
-- (see 20260730000001_scheduled_jobs_functions.sql). No direct
-- INSERT/UPDATE/DELETE policies are granted to `authenticated`.
-- ============================================================

-- ── 1. scheduled_jobs ───────────────────────────────────────────────────────

CREATE TABLE public.scheduled_jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by        UUID NOT NULL REFERENCES public.profiles(id),
    user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,

    -- NULL = one-time job. Otherwise the recurrence cadence in minutes —
    -- admin-editable at any time via admin_update_job_interval(), and the
    -- cron scan (every 1 minute, pg_cron's finest grain) picks up any
    -- interval >= 1 minute automatically without touching the cron schedule.
    interval_minutes  INT NULL CHECK (interval_minutes IS NULL OR interval_minutes >= 1),

    -- Only meaningful for recurring jobs (enforced by the CHECK below).
    ends_at           TIMESTAMPTZ,

    subscription_fee  NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (subscription_fee >= 0 AND subscription_fee = round(subscription_fee, 2)),

    status            TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED')),

    next_run_at       TIMESTAMPTZ NOT NULL,
    last_run_at       TIMESTAMPTZ,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (ends_at IS NULL OR interval_minutes IS NOT NULL)
);

CREATE INDEX idx_scheduled_jobs_due  ON public.scheduled_jobs (next_run_at) WHERE status = 'ACTIVE';
CREATE INDEX idx_scheduled_jobs_user ON public.scheduled_jobs (user_id);

ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all scheduled jobs" ON public.scheduled_jobs
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- Users can browse ACTIVE/PAUSED jobs so they have something to subscribe to.
-- CANCELLED/COMPLETED jobs are admin-only (nothing to subscribe to there).
CREATE POLICY "Users can read active or paused jobs" ON public.scheduled_jobs
    FOR SELECT TO authenticated
    USING (status IN ('ACTIVE', 'PAUSED'));

-- ── 2. scheduled_job_runs ───────────────────────────────────────────────────
-- One row per publish attempt. A one-time job has at most one row here;
-- a recurring job accumulates one per tick. Kept separate from
-- scheduled_jobs because a job can run many times, each producing a
-- distinct posts row (or a distinct failure).

CREATE TABLE public.scheduled_job_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES public.scheduled_jobs(id) ON DELETE CASCADE,
    post_id     BIGINT REFERENCES public.posts(id),
    status      TEXT NOT NULL CHECK (status IN ('PUBLISHED', 'FAILED')),
    error       TEXT,
    ran_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_job_runs_job ON public.scheduled_job_runs (job_id, ran_at DESC);

ALTER TABLE public.scheduled_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read job runs" ON public.scheduled_job_runs
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ── 3. job_subscriptions ────────────────────────────────────────────────────
-- next_charge_at is anchored to when the user subscribed, independent of
-- the job's own next_run_at — joining mid-cycle doesn't skew billing.

CREATE TABLE public.job_subscriptions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id               UUID NOT NULL REFERENCES public.scheduled_jobs(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    status               TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'CANCELLED', 'CANCELLED_PAYMENT_FAILED')),

    next_charge_at       TIMESTAMPTZ NOT NULL,
    last_charged_at      TIMESTAMPTZ,
    consecutive_failures INT NOT NULL DEFAULT 0,

    subscribed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at         TIMESTAMPTZ,

    UNIQUE (job_id, user_id)
);

CREATE INDEX idx_job_subscriptions_due  ON public.job_subscriptions (next_charge_at) WHERE status = 'ACTIVE';
CREATE INDEX idx_job_subscriptions_user ON public.job_subscriptions (user_id);

ALTER TABLE public.job_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscriptions" ON public.job_subscriptions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Admins can read all subscriptions" ON public.job_subscriptions
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ── 4. job_charges ──────────────────────────────────────────────────────────
-- Audit trail of every billing attempt (success AND failure). On success,
-- wallet_transaction_id points at the real ledger row — wallet_transactions
-- stays the source of truth for balances; this table never duplicates it,
-- it only records the attempt (including attempts that never touched the
-- ledger because they failed).

CREATE TABLE public.job_charges (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id       UUID NOT NULL REFERENCES public.job_subscriptions(id) ON DELETE CASCADE,
    wallet_transaction_id UUID REFERENCES public.wallet_transactions(id),
    amount                NUMERIC(12,2) NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
    error                 TEXT,
    charged_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_charges_subscription ON public.job_charges (subscription_id, charged_at DESC);

ALTER TABLE public.job_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own charges" ON public.job_charges
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.job_subscriptions
        WHERE id = job_charges.subscription_id AND user_id = auth.uid()
    ));

CREATE POLICY "Admins can read all charges" ON public.job_charges
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ── 5. Allow SUBSCRIPTION_CHARGE in wallet_transactions ────────────────────

ALTER TABLE public.wallet_transactions
    DROP CONSTRAINT IF EXISTS wallet_transactions_transaction_type_check;

ALTER TABLE public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_transaction_type_check
    CHECK (transaction_type IN (
        'TOP_UP',
        'TRANSFER',
        'ADMIN_ADJUSTMENT',
        'POST_PUBLISH_FEE',
        'SUBSCRIPTION_CHARGE'
    ));
