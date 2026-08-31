/**
 * useAdminJobNotifications
 *
 * Admin-side realtime subscription on the `scheduled_jobs` table.
 *
 * - Maintains a live list of all jobs (INSERT + UPDATE events).
 * - Fires onNewRequest(job) whenever a new PENDING_APPROVAL job
 *   arrives so the admin page can show a toast / badge increment.
 *
 * Mirrors useAdminTopUpNotifications.ts exactly.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  getAllJobs,
  type ScheduledJob,
} from '../services/scheduledJobsService';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseAdminJobNotificationsOptions {
  isAdmin: boolean;
  onNewRequest?: (job: ScheduledJob) => void;
}

interface UseAdminJobNotificationsResult {
  jobs: ScheduledJob[];
  pendingCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAdminJobNotifications({
  isAdmin,
  onNewRequest,
}: UseAdminJobNotificationsOptions): UseAdminJobNotificationsResult {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadJobs = async () => {
    if (!isAdmin) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      const data = await getAllJobs();
      setJobs(data);
    } catch (err) {
      console.error('useAdminJobNotifications: failed to load jobs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount/on-admin-change
    void loadJobs();

    const channel = supabase
      .channel('scheduled_jobs:admin')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'scheduled_jobs',
        },
        (payload) => {
          const newJob = payload.new as ScheduledJob;
          setJobs((prev) => [newJob, ...prev]);
          if (newJob.status === 'PENDING_APPROVAL') {
            onNewRequest?.(newJob);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'scheduled_jobs',
        },
        (payload) => {
          const updated = payload.new as ScheduledJob;
          setJobs((prev) =>
            prev.map((j) => (j.id === updated.id ? updated : j)),
          );
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const pendingCount = jobs.filter((j) => j.status === 'PENDING_APPROVAL').length;

  return { jobs, pendingCount, loading, refresh: loadJobs };
}
