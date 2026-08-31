/**
 * Regression tests for wallet_transfer guards.
 *
 * These call applyWalletOp() from ledgerBalance.ts directly — no local
 * reimplementation of the guards. An earlier version of this file defined
 * its own simulateTransfer() wrapper that duplicated every guard check and
 * threw before ever calling applyWalletOp(), so the tests validated the
 * wrapper, not the production module: deleting a guard from applyWalletOp
 * itself did not fail any test. The 2dp and wallet-status guards have
 * since been moved into applyWalletOp() itself (see ledgerBalance.ts) so
 * these tests actually exercise the shared code path.
 *
 * This still only proves the TypeScript simulation is internally
 * consistent — it cannot prove the real Postgres RPC matches it. The
 * specific regression this guards against:
 *
 *   20260729500000_admin_adjust_audit_constraint.sql re-issued
 *   wallet_transfer via CREATE OR REPLACE, forked from a copy that
 *   pre-dated the SUSPENDED/CLOSED wallet status guard added in
 *   20260729300001. This silently stripped the guard from the live
 *   function. 20260729500001 is the canonical fix.
 *
 * A genuine regression guard for the SQL itself would need an integration
 * test calling supabase.rpc('wallet_transfer', ...) against a real
 * Postgres instance (e.g. local `supabase start`) — not written here,
 * since there's no live database available to verify it against in this
 * environment. Treat these unit tests as a fast feedback loop for the JS
 * simulation only, not a substitute for that integration test.
 */

import { describe, expect, it } from 'vitest';
import {
  applyWalletOp,
  type SimulatedWallet,
} from './ledgerBalance';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeState(
  wallets: Record<string, { balance: number; status?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' }>,
): Map<string, SimulatedWallet> {
  const map = new Map<string, SimulatedWallet>();
  for (const [id, { balance, status = 'ACTIVE' }] of Object.entries(wallets)) {
    map.set(id, { cachedBalance: balance, ledger: [], status });
  }
  return map;
}

function transfer(
  state: Map<string, SimulatedWallet>,
  fromWalletId: string,
  toWalletId: string,
  amount: number,
): void {
  applyWalletOp(state, { kind: 'TRANSFER', fromWalletId, toWalletId, amount });
}

// ─── Status guard regression tests ────────────────────────────────────────────

describe('wallet_transfer status guard (regression: _500000 stripped this check)', () => {
  it('allows transfer between two ACTIVE wallets', () => {
    const state = makeState({ alice: { balance: 100 }, bob: { balance: 0 } });
    expect(() => transfer(state, 'alice', 'bob', 50)).not.toThrow();
    expect(state.get('alice')!.cachedBalance).toBe(50);
    expect(state.get('bob')!.cachedBalance).toBe(50);
  });

  it('blocks transfer from a SUSPENDED sender wallet', () => {
    const state = makeState({
      alice: { balance: 100, status: 'SUSPENDED' },
      bob:   { balance: 0 },
    });
    expect(() => transfer(state, 'alice', 'bob', 50))
      .toThrow(/SUSPENDED.*cannot send/i);
    // Balances must be unchanged
    expect(state.get('alice')!.cachedBalance).toBe(100);
    expect(state.get('bob')!.cachedBalance).toBe(0);
  });

  it('blocks transfer from a CLOSED sender wallet', () => {
    const state = makeState({
      alice: { balance: 100, status: 'CLOSED' },
      bob:   { balance: 0 },
    });
    expect(() => transfer(state, 'alice', 'bob', 50))
      .toThrow(/CLOSED.*cannot send/i);
  });

  it('blocks transfer to a SUSPENDED receiver wallet', () => {
    const state = makeState({
      alice: { balance: 100 },
      bob:   { balance: 0, status: 'SUSPENDED' },
    });
    expect(() => transfer(state, 'alice', 'bob', 50))
      .toThrow(/SUSPENDED.*cannot receive/i);
    expect(state.get('alice')!.cachedBalance).toBe(100);
  });

  it('blocks transfer to a CLOSED receiver wallet', () => {
    const state = makeState({
      alice: { balance: 100 },
      bob:   { balance: 0, status: 'CLOSED' },
    });
    expect(() => transfer(state, 'alice', 'bob', 50))
      .toThrow(/CLOSED.*cannot receive/i);
  });
});

// ─── 2-decimal-place guard ─────────────────────────────────────────────────────

describe('wallet_transfer 2dp guard', () => {
  it('allows amounts with exactly 2 decimal places', () => {
    const state = makeState({ alice: { balance: 100 }, bob: { balance: 0 } });
    expect(() => transfer(state, 'alice', 'bob', 1.50)).not.toThrow();
  });

  it('blocks amounts with more than 2 decimal places', () => {
    const state = makeState({ alice: { balance: 100 }, bob: { balance: 0 } });
    expect(() => transfer(state, 'alice', 'bob', 0.005))
      .toThrow(/2 decimal places/i);
    // No money should have moved
    expect(state.get('alice')!.cachedBalance).toBe(100);
  });
});

// ─── Insufficient balance guard ────────────────────────────────────────────────

describe('wallet_transfer balance guard', () => {
  it('blocks transfer when sender has insufficient balance', () => {
    const state = makeState({ alice: { balance: 10 }, bob: { balance: 0 } });
    expect(() => transfer(state, 'alice', 'bob', 50))
      .toThrow(/insufficient balance/i);
    expect(state.get('alice')!.cachedBalance).toBe(10);
  });

  it('allows transfer of the exact balance (zero-out)', () => {
    const state = makeState({ alice: { balance: 50 }, bob: { balance: 0 } });
    expect(() => transfer(state, 'alice', 'bob', 50)).not.toThrow();
    expect(state.get('alice')!.cachedBalance).toBe(0);
    expect(state.get('bob')!.cachedBalance).toBe(50);
  });
});

// ─── Self-transfer guard ───────────────────────────────────────────────────────

describe('wallet_transfer self-transfer guard', () => {
  it('blocks sending to own wallet', () => {
    const state = makeState({ alice: { balance: 100 } });
    expect(() => transfer(state, 'alice', 'alice', 10))
      .toThrow(/same wallet/i);
  });
});
