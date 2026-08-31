import { supabase } from '../../services/supabase';
import { activePaymentTopUpAdapter } from '../adapters';
import type { TopUpPaymentResult } from '../adapters';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WalletInfo {
  id: string;
  member_id: string;
  balance_cached: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  transaction_id: string;
  transaction_type:
    | 'TOP_UP'
    | 'TRANSFER'
    | 'ADMIN_ADJUSTMENT'
    | 'POST_PUBLISH_FEE'
    | 'SUBSCRIPTION_CHARGE'
    | 'RECURRING_POST_FEE';
  direction: 'CREDIT' | 'DEBIT';
  amount: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
  seq: number;
}

export interface TopUpResult {
  wallet_id: string;
  new_balance: number;
  transaction_id: string;
}

export interface TransferResult {
  sender_balance: number;
  receiver_balance: number;
}

export interface LookupResult {
  wallet_id: string;
  member_id: string;
  username: string;
  full_name: string | null;
  email: string;
}

export interface ReconcileResult {
  cached_balance: number;
  ledger_balance: number;
  matches: boolean;
}

// ─── Service Functions ───────────────────────────────────────────────────────

/** Fetch the wallet for the currently logged-in user, or null if not yet enabled */
export async function getMyWallet(): Promise<WalletInfo | null> {
  const { data, error } = await supabase.rpc('wallet_get_by_member');
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0] as WalletInfo;
}

/** Enable the wallet for the currently logged-in user (idempotent) */
export async function createWallet(): Promise<void> {
  const { error } = await supabase.rpc('wallet_create');
  if (error) throw error;
}

/** Get the real balance (recalculated from ledger) */
export async function getBalance(walletId: string): Promise<number> {
  const { data, error } = await supabase.rpc('wallet_get_balance', {
    p_wallet_id: walletId,
  });
  if (error) throw error;
  return data as number;
}

/**
 * @deprecated Not called by any UI path as of 20260729000000_top_up_requests.sql.
 *
 * Top-ups now go through the admin-approval workflow:
 *   submitTopUpRequest() → admin approves → wallet credited
 *
 * This function routes through StubPaymentTopUpAdapter which calls the
 * wallet_top_up RPC. That RPC was locked to admin-only in
 * 20260729200000_security_hardening.sql — invoking this from a regular
 * user session will throw "Not authorized: wallet_top_up is internal/admin only".
 *
 * Kept for the PaymentTopUpPort abstraction boundary (Phase 5 real payment
 * rail). See src/wallet/adapters/StubPaymentTopUpAdapter.ts for full notes.
 */
export async function topUp(
  walletId: string,
  amount: number,
  memberId = '',
  currency = 'USD',
): Promise<TopUpPaymentResult> {
  return activePaymentTopUpAdapter.processTopUp({
    walletId,
    memberId,
    amount,
    currency,
  });
}

/** Transfer from my wallet to another wallet */
export async function transfer(
  senderWalletId: string,
  receiverWalletId: string,
  amount: number,
): Promise<TransferResult> {
  const { data, error } = await supabase.rpc('wallet_transfer', {
    p_sender_wallet: senderWalletId,
    p_receiver_wallet: receiverWalletId,
    p_amount: amount,
  });
  if (error) throw error;
  return (data as TransferResult[])[0];
}

/** Get paginated transaction history, ordered by insertion sequence (newest first) */
export async function getTransactionHistory(
  walletId: string,
  limit = 50,
  offset = 0,
): Promise<Transaction[]> {
  const { data, error } = await supabase.rpc('wallet_transaction_history', {
    p_wallet_id: walletId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as Transaction[];
}

/** Verify the cached balance still matches the summed ledger */
export async function reconcileWallet(walletId: string): Promise<ReconcileResult> {
  const { data, error } = await supabase.rpc('wallet_reconcile', {
    p_wallet_id: walletId,
  });
  if (error) throw error;
  return (data as ReconcileResult[])[0];
}

/**
 * Search for users by partial username or full name.
 * Returns up to 10 matches (username + full_name only — no email).
 * Backed by the wallet_search_users SECURITY DEFINER RPC.
 * The server enforces a minimum of 3 characters; shorter queries
 * return an empty array without error.
 */
export async function searchWalletUsers(query: string): Promise<LookupResult[]> {
  if (!query.trim()) return [];
  const { data, error } = await supabase.rpc('wallet_search_users', {
    p_search: query.trim(),
  });
  if (error) throw error;
  return (data ?? []) as LookupResult[];
}

/** Admin-only credit/debit with mandatory reason (wallet_admin_adjust RPC). */
export async function adminAdjustWallet(
  walletId: string,
  amount: number,
  direction: 'CREDIT' | 'DEBIT',
  reason: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('wallet_admin_adjust', {
    p_wallet_id: walletId,
    p_amount: amount,
    p_direction: direction,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as number;
}

// ─── Top-Up Request Types ────────────────────────────────────────────────────

export type TopUpRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface TopUpRequest {
  id: string;
  wallet_id: string;
  member_id: string;
  amount: number;
  currency: string;
  status: TopUpRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_note: string | null;
  payment_reference: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Top-Up Request Service Functions ───────────────────────────────────────

/**
 * Submit a top-up request for admin approval.
 * Inserts a PENDING row via the wallet_submit_top_up_request RPC.
 * Returns the new request UUID.
 */
export async function submitTopUpRequest(
  walletId: string,
  amount: number,
  paymentReference?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('wallet_submit_top_up_request', {
    p_wallet_id: walletId,
    p_amount: amount,
    p_payment_reference: paymentReference ?? null,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Fetch all top-up requests for the currently logged-in user.
 * Ordered newest-first.
 */
export async function getMyTopUpRequests(): Promise<TopUpRequest[]> {
  const { data, error } = await supabase
    .from('top_up_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TopUpRequest[];
}

/**
 * Admin: fetch all top-up requests across all users.
 * Ordered newest-first.
 */
export async function getAllTopUpRequests(): Promise<TopUpRequest[]> {
  const { data, error } = await supabase
    .from('top_up_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TopUpRequest[];
}

/**
 * Admin-only: approve a pending top-up request.
 * Atomically credits the wallet and marks the request APPROVED.
 * Returns the wallet's new balance.
 */
export async function approveTopUpRequest(requestId: string): Promise<number> {
  const { data, error } = await supabase.rpc('wallet_approve_top_up', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data as number;
}

/**
 * Admin-only: reject a pending top-up request with an optional note.
 */
export async function rejectTopUpRequest(
  requestId: string,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('wallet_reject_top_up', {
    p_request_id: requestId,
    p_note: note ?? null,
  });
  if (error) throw error;
}
