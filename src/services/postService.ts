import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PostStatus = 'PUBLISHED' | 'DRAFT';

export const POST_CATEGORIES = [
  'Technology', 'Business', 'Lifestyle', 'Health',
  'Travel', 'Food', 'Education', 'Entertainment', 'Uncategorized',
] as const;

export type PostCategory = typeof POST_CATEGORIES[number];

/** Shared per-category color, reused anywhere a category is picked or displayed. */
export const POST_CATEGORY_COLORS: Record<PostCategory, { bg: string; color: string }> = {
  Technology:     { bg: '#e0f2fe', color: '#0369a1' },
  Business:       { bg: '#fef3c7', color: '#92400e' },
  Lifestyle:      { bg: '#fce7f3', color: '#9d174d' },
  Health:         { bg: '#dcfce7', color: '#166534' },
  Travel:         { bg: '#e0e7ff', color: '#3730a3' },
  Food:           { bg: '#ffedd5', color: '#9a3412' },
  Education:      { bg: '#ede9fe', color: '#5b21b6' },
  Entertainment:  { bg: '#fee2e2', color: '#991b1b' },
  Uncategorized:  { bg: '#f1f5f9', color: '#475569' },
};

export interface PlatformSettings {
  post_publish_fee: number;
  recurring_post_annual_fee: number;
}

export interface PublishResult {
  post_id: number;
  status: PostStatus;
  fee_charged: number;
  new_balance: number;
}

export interface Post {
  id: number;
  user_id: string;
  title: string;
  content: string;
  status: PostStatus;
  category: PostCategory;
  is_recurring_feed: boolean;
  author_display_name: string;
  created_at: string;
  updated_at: string;
}

// ─── Platform settings ────────────────────────────────────────────────────────

/** Read the current platform settings (anyone authenticated). */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('key, value');
  if (error) throw error;

  const map = Object.fromEntries(
    ((data as { key: string; value: string }[]) ?? []).map((r) => [r.key, r.value]),
  );

  return {
    post_publish_fee: parseFloat(map['post_publish_fee'] ?? '0'),
    recurring_post_annual_fee: parseFloat(map['recurring_post_annual_fee'] ?? '0'),
  };
}

/**
 * Admin-only: update the post-publish fee.
 * Calls the platform_fee_update SECURITY DEFINER RPC.
 */
export async function setPlatformFee(fee: number): Promise<void> {
  const { error } = await supabase.rpc('platform_fee_update', { p_fee: fee });
  if (error) throw error;
}

/**
 * Admin-only: update the annual fee charged to owners of recurring
 * posts (separate from post_publish_fee; does not affect what
 * subscribers pay the owner).
 */
export async function setRecurringPostFee(fee: number): Promise<void> {
  const { error } = await supabase.rpc('platform_recurring_fee_update', { p_fee: fee });
  if (error) throw error;
}

// ─── Posts ────────────────────────────────────────────────────────────────────

/**
 * Publish a post for the current user.
 * The RPC atomically checks wallet balance, debits the platform fee,
 * and inserts the post as PUBLISHED (or DRAFT if funds are insufficient).
 */
export async function publishPost(
  title: string,
  content: string,
  category: PostCategory = 'Uncategorized',
): Promise<PublishResult> {
  const { data, error } = await supabase.rpc('post_publish', {
    p_title: title,
    p_content: content,
    p_category: category,
  });
  if (error) throw error;
  return data as PublishResult;
}

/**
 * Admin-only: publish a draft post without charging a fee.
 */
export async function publishPostFree(postId: number): Promise<void> {
  const { error } = await supabase.rpc('post_publish_free', { p_post_id: postId });
  if (error) throw error;
}

/**
 * Publish an existing draft owned by the current user, charging the
 * current platform fee. The only self-service path to move a draft to
 * PUBLISHED — post_publish only creates new posts, and post_publish_free
 * is admin-only.
 */
export async function publishDraft(postId: number): Promise<PublishResult> {
  const { data, error } = await supabase.rpc('post_publish_retry', { p_post_id: postId });
  if (error) throw error;
  return data as PublishResult;
}

/**
 * Delete a draft post owned by the current user. Only DRAFT posts can
 * be deleted — published posts are left alone.
 */
export async function deleteDraft(postId: number): Promise<void> {
  const { error } = await supabase.rpc('post_delete_draft', { p_post_id: postId });
  if (error) throw error;
}
