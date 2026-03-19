import { useEffect, useRef, useState } from 'react';
import { getUnsyncedReports, markSynced } from '@/lib/herald-storage';
import { syncReport } from '@/lib/herald-api';

export function useHeraldSync() {
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error' | 'offline'>('ok');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const doSync = async () => {
      if (!navigator.onLine) {
        setSyncStatus('offline');
        return;
      }

      const unsynced = getUnsyncedReports();
      if (unsynced.length === 0) {
        setSyncStatus('ok');
        return;
      }

      let allOk = true;
      for (const report of unsynced) {
        try {
          const ok = await syncReport({
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
          });
          if (ok) {
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
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return syncStatus;
}
