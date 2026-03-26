import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getSession, clearSession } from '@/lib/herald-session';

const POLL_MS = 15_000;

/**
 * Polls the shifts table to detect when the shift has been ended
 * (e.g. from another device). Calls onShiftEnded when detected.
 */
export function useShiftEndedPoll(onShiftEnded: () => void) {
  const cbRef = useRef(onShiftEnded);
  cbRef.current = onShiftEnded;

  useEffect(() => {
    const poll = async () => {
      const session = getSession();
      if (!session?.shift_id) return;

      try {
        const { data } = await supabase
          .from('shifts')
          .select('ended_at')
          .eq('id', session.shift_id)
          .single();

        if (data?.ended_at) {
          clearSession();
          cbRef.current();
        }
      } catch {
        // silent
      }
    };

    const id = setInterval(poll, POLL_MS);
    window.addEventListener('focus', poll);

    return () => {
      clearInterval(id);
      window.removeEventListener('focus', poll);
    };
  }, []);
}
