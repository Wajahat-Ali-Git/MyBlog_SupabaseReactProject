export type LedgerDirection = 'CREDIT' | 'DEBIT';

export type LedgerEntry = {
  direction: LedgerDirection;
  amount: number;
};

/** Matches wallet_reconcile: sum(CREDIT amounts) - sum(DEBIT amounts). */
export function ledgerDelta(entry: LedgerEntry): number {
  return entry.direction === 'CREDIT' ? entry.amount : -entry.amount;
}

export function sumLedgerEntries(entries: LedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + ledgerDelta(entry), 0);
}

export function reconcileCachedWithLedger(cachedBalance: number, entries: LedgerEntry[]): boolean {
  return cachedBalance === sumLedgerEntries(entries);
}

export function validateAdjustmentReason(reason: string): string | null {
  if (!reason.trim()) {
    return 'Reason is required for every admin adjustment.';
  }
  return null;
}

export type WalletStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type SimulatedWallet = {
  cachedBalance: number;
  ledger: LedgerEntry[];
  status?: WalletStatus;
};

export type WalletOp =
  | { kind: 'TOP_UP'; walletId: string; amount: number }
  | {
      kind: 'ADMIN_ADJUST';
      walletId: string;
      direction: LedgerDirection;
      amount: number;
    }
  | { kind: 'TRANSFER'; fromWalletId: string; toWalletId: string; amount: number };

function getWallet(state: Map<string, SimulatedWallet>, walletId: string): SimulatedWallet {
  let wallet = state.get(walletId);
  if (!wallet) {
    wallet = { cachedBalance: 0, ledger: [], status: 'ACTIVE' };
    state.set(walletId, wallet);
  }
  return wallet;
}

/** In-memory simulation of wallet RPC balance + ledger rules (for reconciliation tests). */
export function applyWalletOp(state: Map<string, SimulatedWallet>, op: WalletOp): void {
  if (op.kind === 'TOP_UP') {
    const wallet = getWallet(state, op.walletId);
    if (op.amount <= 0) throw new Error('Top up amount must be positive');
    wallet.cachedBalance += op.amount;
    wallet.ledger.push({ direction: 'CREDIT', amount: op.amount });
    return;
  }

  if (op.kind === 'ADMIN_ADJUST') {
    const wallet = getWallet(state, op.walletId);
    if (op.amount <= 0) throw new Error('Adjustment amount must be positive');
    if (op.direction === 'CREDIT') {
      wallet.cachedBalance += op.amount;
    } else {
      if (wallet.cachedBalance < op.amount) {
        throw new Error('Balance cannot be negative after adjustment');
      }
      wallet.cachedBalance -= op.amount;
    }
    wallet.ledger.push({ direction: op.direction, amount: op.amount });
    return;
  }

  const sender = getWallet(state, op.fromWalletId);
  const receiver = getWallet(state, op.toWalletId);

  // Mirrors wallet_transfer's canonical guard order (20260729500001_wallet_transfer_canonical.sql):
  // 2dp -> positive -> self-transfer -> sender status -> receiver status -> balance.
  if (op.amount !== Math.round(op.amount * 100) / 100) {
    throw new Error('Amount must have at most 2 decimal places');
  }
  if (op.amount <= 0) throw new Error('Transfer amount must be positive');
  if (op.fromWalletId === op.toWalletId) throw new Error('Cannot transfer to the same wallet');
  if ((sender.status ?? 'ACTIVE') !== 'ACTIVE') {
    throw new Error(`Your wallet is ${sender.status} and cannot send funds`);
  }
  if ((receiver.status ?? 'ACTIVE') !== 'ACTIVE') {
    throw new Error(`Recipient wallet is ${receiver.status} and cannot receive funds`);
  }
  if (sender.cachedBalance < op.amount) throw new Error('Insufficient balance');

  sender.cachedBalance -= op.amount;
  receiver.cachedBalance += op.amount;
  sender.ledger.push({ direction: 'DEBIT', amount: op.amount });
  receiver.ledger.push({ direction: 'CREDIT', amount: op.amount });
}

export function allWalletsReconcile(state: Map<string, SimulatedWallet>): boolean {
  for (const wallet of state.values()) {
    if (!reconcileCachedWithLedger(wallet.cachedBalance, wallet.ledger)) {
      return false;
    }
  }
  return true;
}
