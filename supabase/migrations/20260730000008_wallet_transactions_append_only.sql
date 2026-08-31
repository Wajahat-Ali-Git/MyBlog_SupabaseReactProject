-- ============================================================
-- Append-only ledger: block UPDATE/DELETE on wallet_transactions
--
-- Problem:
--   No RLS policy grants authenticated clients UPDATE/DELETE on
--   wallet_transactions, so client-side mutation is already blocked.
--   But nothing stops a row from being altered or removed as the table
--   owner (e.g. via the Supabase SQL editor or service_role) — a mutable
--   financial ledger is an integrity risk independent of who can reach it.
--   Proof: UPDATE/DELETE as table owner currently succeed.
--
-- Fix:
--   A BEFORE UPDATE OR DELETE trigger that unconditionally raises.
--   Triggers fire for every role, including the table owner, so this
--   closes the gap RLS can't reach.
--
-- Side effect (verified against a live db, not just read from the schema):
--   wallet_transactions.wallet_id has ON DELETE CASCADE from wallets, which
--   in turn cascades from profiles, which cascades from auth.users. This
--   trigger fires on cascade deletes too, so deleting a user/profile/wallet
--   that has any transaction history now fails instead of silently wiping
--   the ledger. No code path in this repo deletes users/profiles/wallets
--   today, so this is currently dormant — but if a "delete account" feature
--   is ever added, it will need to soft-delete/anonymize rather than hard
--   delete through this chain.
-- ============================================================

CREATE OR REPLACE FUNCTION public.wallet_transactions_prevent_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'wallet_transactions is an append-only ledger — % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS wallet_transactions_append_only ON public.wallet_transactions;

CREATE TRIGGER wallet_transactions_append_only
BEFORE UPDATE OR DELETE
ON public.wallet_transactions
FOR EACH ROW
EXECUTE FUNCTION public.wallet_transactions_prevent_mutation();
