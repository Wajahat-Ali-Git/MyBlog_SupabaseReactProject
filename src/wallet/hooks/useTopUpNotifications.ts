/**
 * useTopUpNotifications
 *
 * Subscribes to realtime changes on the `top_up_requests` table
 * for the currently logged-in user.
 *
 * When a request transitions to APPROVED or REJECTED:
 *  - fires onApproved(requestId, newBalance) or onRejected(requestId, note)
 *  - the caller is responsible for updating UI / showing toast
 *
 * The hook also exposes the latest list of the user's requests
 * (kept in sync with realtime) and a pending count.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import {
  getMyTopUpRequests,
  type TopUpRequest,
} from '../services/walletService';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseTopUpNotificationsOptions {
  userId: string | null;
  onApproved?: (requestId: string, newBalance: number) => void;
  onRejected?: (requestId: string, note: string | null) => void;
}

interface UseTopUpNotificationsResult {
  requests: TopUpRequest[];
  pendingCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useTopUpNotifications({
  userId,
  onApproved,
  onRejected,
}: UseTopUpNotificationsOptions): UseTopUpNotificationsResult {
  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadRequests = async () => {
    if (!userId) {
      setRequests([]);
      setLoading(false);
      return;
    }
    try {
      const data = await getMyTopUpRequests();
      setRequests(data);
    } catch (err) {
      console.error('useTopUpNotifications: failed to load requests', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-mount/on-user-change
    void loadRequests();

    // Subscribe to changes on the user's own rows only
    const channel = supabase
      .channel(`top_up_requests:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'top_up_requests',
          filter: `member_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as TopUpRequest | undefined;
          const old = payload.old as Partial<TopUpRequest> | undefined;

          if (!updated) return;

          // Update local list
          setRequests((prev) => {
            const exists = prev.some((r) => r.id === updated.id);
            if (exists) {
              return prev.map((r) => (r.id === updated.id ? updated : r));
            }
            return [updated, ...prev];
          });

          // Fire callbacks on status transitions
          const prevStatus = old?.status;
          if (prevStatus === 'PENDING' && updated.status === 'APPROVED') {
            // We don't have the new balance here — the wallet.tsx realtime
            // subscription on `wallets` will catch the balance change.
            // We still fire so the page can show the toast immediately.
            onApproved?.(updated.id, 0);
          }
          if (prevStatus === 'PENDING' && updated.status === 'REJECTED') {
            onRejected?.(updated.id, updated.rejection_note);
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

  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  return { requests, pendingCount, loading, refresh: loadRequests };
}
