-- ============================================
-- Wallet Feature - Row Level Security
-- ============================================

-- Enable RLS
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- WALLETS POLICIES
-- ============================================

-- Members can view only their own wallet
CREATE POLICY "Users can view their own wallet"
ON public.wallets
FOR SELECT
TO authenticated
USING (
    member_id = auth.uid()
);

-- Members cannot directly update wallets.
-- Wallet balances should only be modified through
-- server-side logic (RPC, Edge Functions, or backend).

-- Admins can view every wallet
CREATE POLICY "Admins can view all wallets"
ON public.wallets
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.is_admin = TRUE
    )
);

-- ============================================
-- WALLET TRANSACTIONS POLICIES
-- ============================================

-- Members can view only their own transactions
CREATE POLICY "Users can view their own transactions"
ON public.wallet_transactions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.wallets w
        WHERE w.id = wallet_transactions.wallet_id
          AND w.member_id = auth.uid()
    )
);

-- Admins can view every transaction
CREATE POLICY "Admins can view all wallet transactions"
ON public.wallet_transactions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.is_admin = TRUE
    )
);

-- ============================================
-- IMPORTANT
-- ============================================
--
-- No INSERT, UPDATE, or DELETE policies are created.
--
-- Wallet balances and ledger entries should NEVER be
-- modified directly from the client.
--
-- All balance-changing operations (top-up, transfer,
-- admin adjustment) should go through trusted backend
-- code (RPC, Edge Functions, or your backend API)
-- to guarantee atomic transactions and ledger integrity.
--