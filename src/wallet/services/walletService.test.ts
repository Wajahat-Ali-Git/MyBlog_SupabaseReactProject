import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();

vi.mock('../../services/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock('../adapters', () => ({
  activePaymentTopUpAdapter: { processTopUp: vi.fn() },
}));

import { approveTopUpRequest, rejectTopUpRequest } from './walletService';

describe('approveTopUpRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls wallet_approve_top_up with the request id and returns the new balance', async () => {
    mockRpc.mockResolvedValue({ data: 150.5, error: null });

    const result = await approveTopUpRequest('req-1');

    expect(mockRpc).toHaveBeenCalledWith('wallet_approve_top_up', { p_request_id: 'req-1' });
    expect(result).toBe(150.5);
  });

  it('rejects a double-approve: propagates the RPC error when the request is already APPROVED', async () => {
    // Mirrors wallet_approve_top_up's own guard: `IF v_status_req <> 'PENDING' THEN RAISE EXCEPTION`.
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Request is already APPROVED — cannot approve' },
    });

    await expect(approveTopUpRequest('req-1')).rejects.toEqual({
      message: 'Request is already APPROVED — cannot approve',
    });
  });
});

describe('rejectTopUpRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls wallet_reject_top_up with the request id and an optional note', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await rejectTopUpRequest('req-2', 'duplicate submission');

    expect(mockRpc).toHaveBeenCalledWith('wallet_reject_top_up', {
      p_request_id: 'req-2',
      p_note: 'duplicate submission',
    });
  });

  it('rejects a double-reject the same way the RPC would', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Request is already REJECTED — cannot reject' },
    });

    await expect(rejectTopUpRequest('req-2')).rejects.toEqual({
      message: 'Request is already REJECTED — cannot reject',
    });
  });
});
