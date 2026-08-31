import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { publishPost, publishDraft } from './postService';

describe('publishPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a PUBLISHED result and forwards fee_charged/new_balance when the wallet has enough balance', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: 42, status: 'PUBLISHED', fee_charged: 5, new_balance: 95 },
      error: null,
    });

    const result = await publishPost('title', 'content');

    expect(mockRpc).toHaveBeenCalledWith('post_publish', {
      p_title: 'title', p_content: 'content', p_category: 'Uncategorized',
    });
    expect(result).toEqual({ post_id: 42, status: 'PUBLISHED', fee_charged: 5, new_balance: 95 });
  });

  it('returns a DRAFT result with fee_charged 0 when the wallet balance is insufficient', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: 43, status: 'DRAFT', fee_charged: 0, new_balance: 1.5 },
      error: null,
    });

    const result = await publishPost('title', 'content');

    expect(result.status).toBe('DRAFT');
    expect(result.fee_charged).toBe(0);
  });

  it('throws when the RPC returns an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Not authenticated' } });

    await expect(publishPost('title', 'content')).rejects.toEqual({ message: 'Not authenticated' });
  });
});

describe('publishDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls post_publish_retry with the post id and returns the PublishResult', async () => {
    mockRpc.mockResolvedValue({
      data: { post_id: 7, status: 'PUBLISHED', fee_charged: 5, new_balance: 10 },
      error: null,
    });

    const result = await publishDraft(7);

    expect(mockRpc).toHaveBeenCalledWith('post_publish_retry', { p_post_id: 7 });
    expect(result.status).toBe('PUBLISHED');
  });

  it('throws when the RPC rejects (e.g. still insufficient balance)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Insufficient balance to publish this draft' },
    });

    await expect(publishDraft(7)).rejects.toEqual({
      message: 'Insufficient balance to publish this draft',
    });
  });
});
