// ============================================================
// StubPaymentTopUpAdapter — mock-first implementation of PaymentTopUpPort
//
// ⚠️  IMPORTANT — THIS ADAPTER IS NO LONGER CALLED BY THE UI ⚠️
//
// As of migration 20260729000000_top_up_requests.sql the top-up
// flow was changed from:
//
//   user clicks "Top Up" → StubPaymentTopUpAdapter.processTopUp()
//                         → wallet_top_up RPC (instant credit)
//
// to a two-step approval flow:
//
//   user clicks "Top Up" → submitTopUpRequest()
//                         → wallet_submit_top_up_request RPC (PENDING row)
//   admin approves       → wallet_approve_top_up RPC (credits wallet)
//
// topUp() / activePaymentTopUpAdapter are now dead code — see
// walletService.ts for the deprecation notice. This class is kept
// in the repo as the starting point for a future real-payment adapter
// (see Phase 5 below), but it is NOT invoked anywhere in production.
//
// Additionally, the wallet_top_up RPC it calls was locked to
// admin-only in 20260729200000_security_hardening.sql — calling it
// from a regular user session returns "Not authorized: wallet_top_up
// is internal/admin only".
//
// ─── Phase 5 (real payment rail) ─────────────────────────────────
// When integrating a real payment processor (e.g. Stripe):
//   1. Create src/wallet/adapters/StripeTopUpAdapter.ts implementing
//      PaymentTopUpPort. On success it should call
//      wallet_submit_top_up_request (or, if auto-approve is desired,
//      wallet_approve_top_up directly using a service-role client).
//   2. Update adapters/index.ts to export StripeTopUpAdapter as the
//      active adapter.
//   3. Wire the adapter back into the top-up submission path in
//      walletService.ts::submitTopUpRequest (currently a direct RPC).
//   4. No changes to TopUpModal, wallet.tsx, or any ledger logic.
// ============================================================

import { supabase } from '../../services/supabase';
import type { PaymentTopUpPort, TopUpRequest, TopUpPaymentResult } from '../ports/PaymentTopUpPort';

interface RpcTopUpRow {
  wallet_id: string;
  new_balance: number;
  transaction_id: string;
}

export class StubPaymentTopUpAdapter implements PaymentTopUpPort {
  async processTopUp(request: TopUpRequest): Promise<TopUpPaymentResult> {
    // Generate a stub payment reference for traceability in the ledger
    const paymentReference = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // NOTE: wallet_top_up is now admin-only (20260729200000_security_hardening.sql).
    // This call will fail for non-admin users. This adapter is not used in production —
    // see the file header for the current approval flow.
    const { data, error } = await supabase.rpc('wallet_top_up', {
      p_wallet_id: request.walletId,
      p_amount: request.amount,
    });

    if (error) throw error;

    const row = (data as RpcTopUpRow[])[0];

    return {
      paymentReference,
      charged: false, // no real charge in stub mode
      newBalance: row.new_balance,
    };
  }
}
