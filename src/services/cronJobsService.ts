import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

// pg_cron statuses observed in cron.job_run_details: 'succeeded' | 'failed' |
// 'running' | 'starting'. Typed as a union with a string fallback since it's
// reported by the extension, not enforced by a CHECK constraint we control.
export type CronRunStatus = 'succeeded' | 'failed' | 'running' | 'starting' | (string & {});

// 'cron' = a real pg_cron tick; 'manual' = triggered via admin_run_cron_job_now,
// logged to cron_manual_runs since pg_cron never records those itself.
export type CronRunSource = 'cron' | 'manual';

// One affected item within a run — which post/subscriber/job-owner it was,
// and what happened to it. Shape depends on which job produced it: the
// publisher sets post_id/title/user, subscription billing sets
// subscriber/job_title/amount, annual-fee billing sets owner/job_title/amount.
// Never all fields at once — check for the ones your job type sets.
export interface CronRunDetailItem {
  status: 'SUCCESS' | 'FAILED';
  error: string | null;
  post_id?: number | null;
  title?: string | null;
  user?: string;
  subscriber?: string;
  owner?: string;
  job_title?: string | null;
  amount?: number;
}

export interface CronJobSummary {
  jobid: number;
  jobname: string;
  schedule: string;
  command: string;
  active: boolean;
  last_run_status: CronRunStatus | null;
  last_run_started_at: string | null;
  last_run_ended_at: string | null;
  last_run_message: string | null;
  last_run_source: CronRunSource | null;
  // Count of successful items in last_run_detail_items — null when the run
  // never happened, or when this job type has no itemized correlation
  // (e.g. the housekeeping cleanup job).
  last_run_result_count: number | null;
  // Which posts/subscribers/owners the last run actually touched. Null
  // under the same conditions as last_run_result_count.
  last_run_detail_items: CronRunDetailItem[] | null;
  runs_last_24h: number;
  failures_last_24h: number;
}

export interface CronJobRun {
  runid: number | null;
  status: CronRunStatus;
  return_message: string | null;
  start_time: string;
  end_time: string | null;
  source: CronRunSource;
  result_count: number | null;
  detail_items: CronRunDetailItem[] | null;
}

// ─── Service functions ────────────────────────────────────────────────────────

/** Admin: list every registered pg_cron job with its latest run + 24h health. */
export async function getCronJobs(): Promise<CronJobSummary[]> {
  const { data, error } = await supabase.rpc('admin_list_cron_jobs');
  if (error) throw error;
  return (data ?? []) as CronJobSummary[];
}

/** Admin: fetch run history for one cron job, newest first. */
export async function getCronJobRuns(jobname: string, limit = 50): Promise<CronJobRun[]> {
  const { data, error } = await supabase.rpc('admin_list_cron_job_runs', {
    p_jobname: jobname,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as CronJobRun[];
}

/** Admin: pause or resume the underlying pg_cron job (stops/resumes every tick, platform-wide). */
export async function setCronJobActive(jobname: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_cron_job_active', {
    p_jobname: jobname,
    p_active: active,
  });
  if (error) throw error;
}

/** Admin: manually trigger one of the known batch functions immediately, outside its schedule. */
export async function runCronJobNow(jobname: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_run_cron_job_now', {
    p_jobname: jobname,
  });
  if (error) throw error;
  return data as number;
}
