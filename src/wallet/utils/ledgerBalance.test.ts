import { describe, expect, it } from 'vitest';
import {
  allWalletsReconcile,
  applyWalletOp,
  reconcileCachedWithLedger,
  sumLedgerEntries,
  validateAdjustmentReason,
  type SimulatedWallet,
  type WalletOp,
} from './ledgerBalance';

describe('ledgerBalance', () => {
  it('sums credits minus debits like wallet_reconcile', () => {
    const total = sumLedgerEntries([
      { direction: 'CREDIT', amount: 100 },
      { direction: 'DEBIT', amount: 25 },
      { direction: 'CREDIT', amount: 10 },
    ]);
    expect(total).toBe(85);
    expect(reconcileCachedWithLedger(85, [
      { direction: 'CREDIT', amount: 100 },
      { direction: 'DEBIT', amount: 25 },
      { direction: 'CREDIT', amount: 10 },
    ])).toBe(true);
  });

  it('requires a non-empty adjustment reason', () => {
    expect(validateAdjustmentReason('')).toMatch(/required/i);
    expect(validateAdjustmentReason('   ')).toMatch(/required/i);
    expect(validateAdjustmentReason('Promo credit Q3')).toBeNull();
  });

  it('keeps cached balance equal to ledger sum after a randomized operation sequence', () => {
    const state = new Map<string, SimulatedWallet>();
    const walletIds = ['w-a', 'w-b', 'w-c'];
    let seed = 42;

    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const pickWallet = () => walletIds[Math.floor(rand() * walletIds.length)]!;
    const amount = () => Math.round((rand() * 40 + 1) * 100) / 100;

    const ops: WalletOp[] = [];
    for (let i = 0; i < 200; i++) {
      const roll = rand();
      if (roll < 0.35) {
        ops.push({ kind: 'TOP_UP', walletId: pickWallet(), amount: amount() });
      } else if (roll < 0.55) {
        ops.push({
          kind: 'ADMIN_ADJUST',
          walletId: pickWallet(),
          direction: rand() < 0.6 ? 'CREDIT' : 'DEBIT',
          amount: amount(),
        });
      } else {
        const from = pickWallet();
        let to = pickWallet();
        while (to === from) to = pickWallet();
        ops.push({ kind: 'TRANSFER', fromWalletId: from, toWalletId: to, amount: amount() });
      }
    }

    for (const op of ops) {
      try {
        applyWalletOp(state, op);
      } catch {
        // Insufficient balance / invalid transfer — skip like a failed RPC would
      }
      expect(allWalletsReconcile(state)).toBe(true);
    }
  });
});
