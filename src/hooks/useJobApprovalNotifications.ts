/**
 * useJobApprovalNotifications
 *
 * Subscribes to realtime changes on the `scheduled_jobs` table for
 * the currently logged-in user's own jobs (scheduled_jobs is already
 * in the supabase_realtime publication — see
 * 20260731000000_scheduled_jobs_user_initiated_flow.sql).
 *
 * When a job transitions from PENDING_APPROVAL to ACTIVE or REJECTED:
 *  - fires onApproved(jobId) or onRejected(jobId)
 *  - the caller is responsible for updating UI / showing a toast
 *
 * The hook also exposes the latest list of the user's jobs (kept in
 * sync with realtime, including new INSERTs from creating a job) and
 * a pending count. Mirrors useTopUpNotifications.ts exactly.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  getMyScheduledJobs,
  type ScheduledJob,
} from '../services/scheduledJobsService';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseJobApprovalNotificationsOptions {
  userId: string | null;
  onApproved?: (jobId: string) => void;
  onRejected?: (jobId: string) => void;
}

interface UseJobApprovalNotificationsResult {
  jobs: ScheduledJob[];
  pendingCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useJobApprovalNotifications({
  userId,
  onApproved,
  onRejected,
}: UseJobApprovalNotificationsOptions): UseJobApprovalNotificationsResult {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadJobs = async () => {
    if (!userId) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const data = await getMyScheduledJobs();
      setJobs(data);
    } catch (err) {
      console.error('useJobApprovalNotifications: failed to load jobs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount/on-user-change
    void loadJobs();

    // Subscribe to changes on the user's own rows only
    const channel = supabase
      .channel(`scheduled_jobs:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scheduled_jobs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as ScheduledJob | undefined;
          const old = payload.old as Partial<ScheduledJob> | undefined;

          if (payload.eventType === 'DELETE') {
            const deletedId = old?.id;
            if (deletedId) setJobs((prev) => prev.filter((j) => j.id !== deletedId));
            return;
          }
          if (!updated) return;

          setJobs((prev) => {
            const exists = prev.some((j) => j.id === updated.id);
            if (exists) {
              return prev.map((j) => (j.id === updated.id ? updated : j));
            }
            return [updated, ...prev];
          });

          const prevStatus = old?.status;
          if (prevStatus === 'PENDING_APPROVAL' && updated.status === 'ACTIVE') {
            onApproved?.(updated.id);
          }
          if (prevStatus === 'PENDING_APPROVAL' && updated.status === 'REJECTED') {
            onRejected?.(updated.id);
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const pendingCount = jobs.filter((j) => j.status === 'PENDING_APPROVAL').length;

  return { jobs, pendingCount, loading, refresh: loadJobs };
}
