import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getSession, clearSession } from '@/lib/herald-session';

/**
 * Subscribes to realtime changes on the shifts table to detect when
 * the shift has been ended (e.g. from another device).
 * Falls back to a single check on mount + focus.
 */
export function useShiftEndedPoll(onShiftEnded: () => void) {
  const cbRef = useRef(onShiftEnded);
  cbRef.current = onShiftEnded;

  useEffect(() => {
    const session = getSession();
    if (!session?.shift_id) return;

    const shiftId = session.shift_id;

    // One-time check on mount
    const checkOnce = async () => {
      try {
        const { data } = await supabase
          .from('shifts')
          .select('ended_at')
          .eq('id', shiftId)
          .single();

        if (data?.ended_at) {
          clearSession();
          cbRef.current();
        }
      } catch {
        // silent
      }
    };

    checkOnce();
    window.addEventListener('focus', checkOnce);

    // Realtime subscription for instant detection
    const channel = supabase
      .channel(`shift-ended-${shiftId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shifts',
          filter: `id=eq.${shiftId}`,
        },
        (payload) => {
          if (payload.new && (payload.new as any).ended_at) {
            clearSession();
            cbRef.current();
          }
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('focus', checkOnce);
      supabase.removeChannel(channel);
    };
  }, []);
}
