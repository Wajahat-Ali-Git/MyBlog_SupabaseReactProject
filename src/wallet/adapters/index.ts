// ============================================================
// Active Payment Top-Up Adapter — single swap point
//
// ⚠️  THIS IS CURRENTLY DEAD CODE ⚠️
//
// The UI no longer calls topUp() / activePaymentTopUpAdapter.
// As of 20260729000000_top_up_requests.sql, top-ups go through
// the approval workflow:
//   submitTopUpRequest() → admin approves → wallet credited
//
// This export is kept so the PaymentTopUpPort abstraction boundary
// remains intact for Phase 5 (real payment rail integration).
// See StubPaymentTopUpAdapter.ts for full migration notes.
//
// ─── To activate a real payment adapter ──────────────────────
//   1. Implement PaymentTopUpPort in a new adapter file.
//   2. Replace the two lines below with that adapter.
//   3. Wire it back into walletService.ts::submitTopUpRequest.
// ============================================================

import { StubPaymentTopUpAdapter } from './StubPaymentTopUpAdapter';
import type { PaymentTopUpPort } from '../ports/PaymentTopUpPort';

export const activePaymentTopUpAdapter: PaymentTopUpPort =
  new StubPaymentTopUpAdapter();

// Re-export the types so consumers only need to import from here
export type { PaymentTopUpPort, TopUpRequest, TopUpPaymentResult } from '../ports/PaymentTopUpPort';
