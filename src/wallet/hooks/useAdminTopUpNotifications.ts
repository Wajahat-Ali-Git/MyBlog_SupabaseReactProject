/**
 * useAdminTopUpNotifications
 *
 * Admin-side realtime subscription on the `top_up_requests` table.
 *
 * - Maintains a live list of all requests (INSERT + UPDATE events).
 * - Fires onNewRequest(request) whenever a new PENDING request arrives
 *   so the admin page can show a toast / badge increment.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import {
  getAllTopUpRequests,
  type TopUpRequest,
} from '../services/walletService';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseAdminTopUpNotificationsOptions {
  isAdmin: boolean;
  onNewRequest?: (request: TopUpRequest) => void;
}

interface UseAdminTopUpNotificationsResult {
  requests: TopUpRequest[];
  pendingCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAdminTopUpNotifications({
  isAdmin,
  onNewRequest,
}: UseAdminTopUpNotificationsOptions): UseAdminTopUpNotificationsResult {
  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadRequests = async () => {
    if (!isAdmin) {
      setRequests([]);
      setLoading(false);
      return;
    }
    try {
      const data = await getAllTopUpRequests();
      setRequests(data);
    } catch (err) {
      console.error('useAdminTopUpNotifications: failed to load requests', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount/on-admin-change
    void loadRequests();

    const channel = supabase
      .channel('top_up_requests:admin')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'top_up_requests',
        },
        (payload) => {
          const newReq = payload.new as TopUpRequest;
          setRequests((prev) => [newReq, ...prev]);
          if (newReq.status === 'PENDING') {
            onNewRequest?.(newReq);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'top_up_requests',
        },
        (payload) => {
          const updated = payload.new as TopUpRequest;
          setRequests((prev) =>
            prev.map((r) => (r.id === updated.id ? updated : r)),
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

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  return { requests, pendingCount, loading, refresh: loadRequests };
}
