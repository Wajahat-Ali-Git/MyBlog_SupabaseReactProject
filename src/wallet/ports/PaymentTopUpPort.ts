// ============================================================
// PaymentTopUpPort — the payment abstraction boundary
//
// This interface is the ONLY thing the wallet feature knows
// about "how a top-up payment is processed". It intentionally
// says nothing about Stripe, bank transfers, or any specific
// payment rail.
//
// Current status (as of 20260729000000_top_up_requests.sql):
//   Top-ups no longer go through this port in the live UI.
//   The flow is now:
//     1. User submits a top-up request (wallet_submit_top_up_request)
//     2. Admin reviews and approves (wallet_approve_top_up)
//     3. Wallet is credited atomically by the RPC
//   The StubPaymentTopUpAdapter / topUp() path is DEAD CODE.
//   See src/wallet/adapters/StubPaymentTopUpAdapter.ts for notes.
//
// Phase 5 (real payment rail):
//   When integrating a real processor (Stripe, etc.):
//     1. Implement PaymentTopUpPort in a new adapter.
//     2. Have it charge the card first, then either:
//        a. Call wallet_submit_top_up_request + auto-approve via
//           a service-role client, OR
//        b. Call wallet_approve_top_up directly (admin service role).
//     3. Wire the adapter back into the submitTopUpRequest path.
//     4. No changes to TopUpModal, wallet.tsx, or ledger logic.
// ============================================================

export interface TopUpRequest {
  /** The wallet UUID to credit */
  walletId: string;
  /** The member UUID who owns the wallet (for audit / receipt) */
  memberId: string;
  /** Amount to add in the wallet's currency */
  amount: number;
  /** ISO 4217 currency code, e.g. "USD" */
  currency: string;
}

export interface TopUpPaymentResult {
  /**
   * Opaque reference from the payment processor.
   * Stub produces "stub-<timestamp>-<random>".
   * Stripe produces a PaymentIntent ID ("pi_…").
   * Stored in the ledger reason field for traceability.
   */
  paymentReference: string;

  /**
   * Whether a real payment processor was charged.
   * false in the stub (mock-first), true in Phase 5.
   * Surfaces a "Simulated payment" badge in the UI when false.
   */
  charged: boolean;

  /** The wallet's new balance after the credit */
  newBalance: number;
}

/** The port every payment adapter must satisfy */
export interface PaymentTopUpPort {
  processTopUp(request: TopUpRequest): Promise<TopUpPaymentResult>;
}
