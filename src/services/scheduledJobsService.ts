import { supabase } from './supabase';
import { getCurrentUser } from './authService';
import type { PostCategory } from './postService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'COMPLETED' | 'REJECTED';
export type JobRunStatus = 'PUBLISHED' | 'FAILED';
export type SubscriptionStatus = 'ACTIVE' | 'CANCELLED' | 'CANCELLED_PAYMENT_FAILED';
export type ChargeStatus = 'SUCCESS' | 'FAILED';

export interface ScheduledJob {
  id: string;
  created_by: string;
  user_id: string;
  title: string;
  content: string;
  interval_minutes: number | null;
  ends_at: string | null;
  subscription_fee: number;
  status: JobStatus;
  category: PostCategory;
  next_run_at: string;
  last_run_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  next_annual_fee_at: string | null;
  last_annual_fee_at: string | null;
  annual_fee_failures: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduledJobRun {
  id: string;
  job_id: string;
  post_id: number | null;
  status: JobRunStatus;
  error: string | null;
  ran_at: string;
}

export interface JobSubscription {
  id: string;
  job_id: string;
  user_id: string;
  status: SubscriptionStatus;
  next_charge_at: string;
  last_charged_at: string | null;
  consecutive_failures: number;
  subscribed_at: string;
  cancelled_at: string | null;
}

export interface JobCharge {
  id: string;
  subscription_id: string;
  wallet_transaction_id: string | null;
  amount: number;
  status: ChargeStatus;
  error: string | null;
  charged_at: string;
}



export interface CreateScheduledJobParams {
  title: string;
  content: string;
  scheduledFor: string;        // ISO timestamp
  intervalMinutes?: number;
  subscriptionFee?: number;
  endsAt?: string;
  category?: PostCategory;
}

// ─── Service functions ────────────────────────────────────────────────────────

/** Admin: fetch all scheduled jobs ordered newest-first. */
export async function getAllJobs(): Promise<ScheduledJob[]> {
  const { data, error } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ScheduledJob[];
}

/** Admin: fetch only jobs awaiting approval, oldest-first (approval queue). */
export async function getPendingJobs(): Promise<ScheduledJob[]> {
  const { data, error } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .eq('status', 'PENDING_APPROVAL')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ScheduledJob[];
}

/** Admin: fetch run history for a specific job. */
export async function getJobRuns(jobId: string): Promise<ScheduledJobRun[]> {
  const { data, error } = await supabase
    .from('scheduled_job_runs')
    .select('*')
    .eq('job_id', jobId)
    .order('ran_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ScheduledJobRun[];
}

/** Admin: fetch all job subscriptions across all users. */
export async function getAllSubscriptions(): Promise<JobSubscription[]> {
  const { data, error } = await supabase
    .from('job_subscriptions')
    .select('*')
    .order('subscribed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as JobSubscription[];
}

/** Admin: fetch the full billing audit trail. */
export async function getAllCharges(): Promise<JobCharge[]> {
  const { data, error } = await supabase
    .from('job_charges')
    .select('*')
    .order('charged_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as JobCharge[];
}

/** Admin: pause, resume, or cancel a job. */
export async function setJobStatus(jobId: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED'): Promise<void> {
  const { error } = await supabase.rpc('admin_set_job_status', {
    p_job_id: jobId,
    p_status: status,
  });
  if (error) throw error;
}

/** Admin: update a recurring job's interval. Takes effect on the next tick. */
export async function updateJobInterval(jobId: string, intervalMinutes: number): Promise<void> {
  const { error } = await supabase.rpc('admin_update_job_interval', {
    p_job_id: jobId,
    p_interval_minutes: intervalMinutes,
  });
  if (error) throw error;
}

/** Admin: approve a pending schedule/subscription request, making it ACTIVE. */
export async function approveJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_approve_scheduled_job', {
    p_job_id: jobId,
  });
  if (error) throw error;
}

/** Admin: reject a pending schedule/subscription request. */
export async function rejectJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reject_scheduled_job', {
    p_job_id: jobId,
  });
  if (error) throw error;
}

// ─── User-facing Service functions ────────────────────────────────────────────

export interface SubscribableJob {
  id: string;
  interval_minutes: number;
  subscription_fee: number;
  next_run_at: string;
  created_at: string;
  category: PostCategory;
  author_display_name: string;
}

/** User: fetch available jobs (calls list_subscribable_jobs RPC to prevent leaking unpublished content before subscribing). */
export async function getAvailableJobs(): Promise<SubscribableJob[]> {
  const { data, error } = await supabase.rpc('list_subscribable_jobs');
  if (error) throw error;
  return (data ?? []) as SubscribableJob[];
}

/** User: fetch scheduled jobs they created (own posts, not subscriptions to others'). */
export async function getMyScheduledJobs(): Promise<ScheduledJob[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ScheduledJob[];
}

/** User: fetch their own active and past subscriptions. */
export async function getMySubscriptions(): Promise<JobSubscription[]> {
  const { data, error } = await supabase
    .from('job_subscriptions')
    .select('*')
    .order('subscribed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as JobSubscription[];
}

/** User: fetch their billing history for subscriptions. */
export async function getMyJobCharges(): Promise<JobCharge[]> {
  const { data, error } = await supabase
    .from('job_charges')
    .select('*')
    .order('charged_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as JobCharge[];
}

/** User: Subscribe to a scheduled job. */
export async function subscribeToJob(jobId: string): Promise<string> {
  const { data, error } = await supabase.rpc('subscribe_to_job', {
    p_job_id: jobId,
  });
  if (error) throw error;
  return data as string;
}

/** User: Cancel an active subscription. */
export async function unsubscribeFromJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('unsubscribe_from_job', {
    p_job_id: jobId,
  });
  if (error) throw error;
}

/** User: submit a new scheduled/recurring post request. Lands PENDING_APPROVAL. */
export async function createScheduledJob(params: CreateScheduledJobParams): Promise<string> {
  const { data, error } = await supabase.rpc('user_create_scheduled_job', {
    p_title: params.title,
    p_content: params.content,
    p_scheduled_for: params.scheduledFor,
    p_interval_minutes: params.intervalMinutes ?? null,
    p_subscription_fee: params.subscriptionFee ?? 0,
    p_ends_at: params.endsAt ?? null,
    p_category: params.category ?? 'Uncategorized',
  });
  if (error) throw error;
  return data as string;
}

/** User: edit a job's title/content/category any time before it reaches a terminal state. */
export async function updateScheduledJobDraft(
  jobId: string, title: string, content: string, category: PostCategory,
): Promise<void> {
  const { error } = await supabase.rpc('user_update_scheduled_job_draft', {
    p_job_id: jobId,
    p_title: title,
    p_content: content,
    p_category: category,
  });
  if (error) throw error;
}

/** User: withdraw their own job before it reaches a terminal state. */
export async function cancelMyScheduledJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('user_cancel_scheduled_job', {
    p_job_id: jobId,
  });
  if (error) throw error;
}
