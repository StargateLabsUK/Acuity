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
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;
    let checkOnce: (() => Promise<void>) | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const setup = async () => {
      const session = await getSession();
      if (!session?.shift_id || disposed) return;

      const shiftId = session.shift_id;
      const operatorId = session.operator_id;

      // Check both shift ended AND crew member removed
      checkOnce = async () => {
        try {
          // Check if shift ended
          const { data: shiftData } = await supabase
            .from('shifts')
            .select('ended_at')
            .eq('id', shiftId)
            .single();

          if (shiftData?.ended_at) {
            clearSession();
            cbRef.current();
            return;
          }

          // Check if this crew member was removed (left_at set)
          // Only clear the field device — don't clear shared session
          // so the incidents page keeps working
          if (operatorId) {
            const { data: linkData } = await supabase
              .from('shift_link_codes')
              .select('left_at')
              .eq('shift_id', shiftId)
              .eq('operator_id', operatorId)
              .not('used_at', 'is', null)
              .order('used_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (linkData?.left_at) {
              // Don't call clearSession() — that would kill the incidents page session too
              // Just trigger the callback which resets the React state
              cbRef.current();
              return;
            }
          }
        } catch {
          // silent
        }
      };

      checkOnce();
      window.addEventListener('focus', checkOnce);

      // Poll every 10 seconds for removal detection
      pollInterval = setInterval(checkOnce, 10000);

      // Realtime subscription for shift end
      channel = supabase
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
    };

    setup();

    return () => {
      disposed = true;
      if (checkOnce) window.removeEventListener('focus', checkOnce);
      if (channel) supabase.removeChannel(channel);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);
}
