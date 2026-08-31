

-- ============================================
-- Wallet Feature
-- Creates:
--   - wallets
--   - wallet_transactions
-- ============================================

-- ============================================
-- Wallets
-- ============================================

CREATE TABLE public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    member_id UUID NOT NULL UNIQUE
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    balance_cached NUMERIC(12,2) NOT NULL DEFAULT 0.00,

    currency TEXT NOT NULL DEFAULT 'USD',

    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Wallet Transactions
-- ============================================

CREATE TABLE public.wallet_transactions (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    wallet_id UUID NOT NULL
        REFERENCES public.wallets(id)
        ON DELETE CASCADE,

    transaction_type TEXT NOT NULL
        CHECK (
            transaction_type IN (
                'TOP_UP',
                'TRANSFER',
                'ADMIN_ADJUSTMENT'
            )
        ),

    direction TEXT NOT NULL
        CHECK (
            direction IN (
                'CREDIT',
                'DEBIT'
            )
        ),

    amount NUMERIC(12,2) NOT NULL
        CHECK (amount > 0),

    balance_after NUMERIC(12,2) NOT NULL,

    related_wallet_id UUID
        REFERENCES public.wallets(id),

    transfer_group_id UUID,

    actor_type TEXT,

    actor_id UUID,

    reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX idx_wallet_member
ON public.wallets(member_id);

CREATE INDEX idx_wallet_transactions_wallet
ON public.wallet_transactions(wallet_id);

CREATE INDEX idx_wallet_transactions_transfer_group
ON public.wallet_transactions(transfer_group_id);

CREATE INDEX idx_wallet_transactions_created_at
ON public.wallet_transactions(created_at DESC);

-- Fix syntax errors in wallets creation
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL UNIQUE
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,
    balance_cached NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
