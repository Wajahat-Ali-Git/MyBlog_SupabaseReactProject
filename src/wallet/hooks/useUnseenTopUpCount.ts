/**
 * useUnseenTopUpCount
 *
 * Lightweight hook for non-wallet pages (e.g. home, header).
 * Returns the count of top-up requests that were APPROVED or REJECTED
 * after the user last visited the wallet page.
 *
 * "Seen" is persisted in localStorage under key `wallet_last_seen_<userId>`
 * so it survives page refreshes. wallet.tsx calls markAllSeen() on mount.
 */

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TopUpRequest } from '../services/walletService';

const storageKey = (userId: string) => `wallet_last_seen_${userId}`;

export function getLastSeenAt(userId: string): string {
  return localStorage.getItem(storageKey(userId)) ?? new Date(0).toISOString();
}

export function markAllSeen(userId: string) {
  localStorage.setItem(storageKey(userId), new Date().toISOString());
}

interface UseUnseenTopUpCountResult {
  unseenCount: number;
}

export function useUnseenTopUpCount(userId: string | null): UseUnseenTopUpCountResult {
  const [unseenCount, setUnseenCount] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const recompute = async (uid: string) => {
    const lastSeen = getLastSeenAt(uid);
    const { data, error } = await supabase
      .from('top_up_requests')
      .select('id, status, updated_at')
      .eq('member_id', uid)
      .in('status', ['APPROVED', 'REJECTED'])
      .gt('updated_at', lastSeen);

    if (!error) {
      setUnseenCount((data ?? []).length);
    }
  };

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting local count when the user logs out
      setUnseenCount(0);
      return;
    }

    void recompute(userId);

    // Subscribe to status changes on the user's own requests
    const channel = supabase
      .channel(`unseen_top_up:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'top_up_requests',
          filter: `member_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as TopUpRequest;
          if (updated.status === 'APPROVED' || updated.status === 'REJECTED') {
            void recompute(userId);
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId]);

  return { unseenCount };
}
