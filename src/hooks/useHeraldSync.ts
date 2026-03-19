import { useEffect, useRef, useState } from 'react';
import { getUnsyncedReports, markSynced } from '@/lib/herald-storage';
import { syncReport } from '@/lib/herald-api';
import { supabase } from '@/integrations/supabase/client';

export function useHeraldSync() {
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error' | 'offline' | 'auth_error'>('ok');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const doSync = async () => {
      if (!navigator.onLine) {
        setSyncStatus('offline');
        return;
      }

      // Revalidate session before syncing (especially after coming back online)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSyncStatus('auth_error');
        return;
      }

      const unsynced = getUnsyncedReports();
      if (unsynced.length === 0) {
        setSyncStatus('ok');
        return;
      }

      const userId = session.user.id;
      let allOk = true;
      for (const report of unsynced) {
        try {
          const result = await syncReport({
            id: report.id,
            timestamp: report.timestamp,
            transcript: report.transcript,
            assessment: report.assessment,
            synced: true,
            confirmed_at: report.confirmed_at,
            headline: report.assessment?.headline,
            priority: report.assessment?.priority,
            service: report.assessment?.service,
            lat: report.lat,
            lng: report.lng,
            location_accuracy: report.location_accuracy,
            original_assessment: (report as any).original_assessment ?? null,
            final_assessment: (report as any).final_assessment ?? null,
            diff: (report as any).diff ?? null,
            edited: (report as any).edited ?? false,
            session_callsign: report.session_callsign ?? null,
            session_operator_id: report.session_operator_id ?? null,
            session_service: report.session_service ?? null,
            session_station: report.session_station ?? null,
            user_id: userId,
          });
          if (result === 'auth_error') {
            setSyncStatus('auth_error');
            return;
          }
          if (result) {
            markSynced(report.id);
          } else {
            allOk = false;
          }
        } catch {
          allOk = false;
        }
      }
      setSyncStatus(allOk ? 'ok' : 'error');
    };

    doSync();
    intervalRef.current = setInterval(doSync, 30000);

    // Also sync when coming back online
    const onOnline = () => doSync();
    window.addEventListener('online', onOnline);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return syncStatus;
}
