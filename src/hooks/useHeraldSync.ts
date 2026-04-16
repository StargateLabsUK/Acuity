import { useEffect, useRef, useState } from 'react';
import { getUnsyncedReports, markSynced } from '@/lib/herald-storage';
import { syncReport } from '@/lib/herald-api';
import { toSyncPayload } from '@/lib/herald-sync';
import { processQueue } from '@/lib/offline-queue-processor';
import { count as offlineQueueCount } from '@/lib/offline-queue';

const SYNC_INTERVAL_MS = 5000;

export function useHeraldSync() {
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error' | 'offline'>('ok');
  const [queuedCount, setQueuedCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const doSync = async () => {
      if (!navigator.onLine) {
        setSyncStatus('offline');
        setQueuedCount(await offlineQueueCount());
        return;
      }

      // 1. Drain the offline queue (dispositions, transfers, transcriptions)
      try {
        await processQueue();
      } catch {
        // queue processing is best-effort
      }
      setQueuedCount(await offlineQueueCount());

      // 2. Sync unsynced local reports (existing behaviour)
      const unsynced = await getUnsyncedReports();
      if (unsynced.length === 0) {
        const remaining = await offlineQueueCount();
        setSyncStatus(remaining > 0 ? 'error' : 'ok');
        return;
      }

      let allOk = true;
      for (const report of unsynced) {
        try {
          const ok = await syncReport(await toSyncPayload(report));
          if (ok) {
            await markSynced(report.id);
          } else {
            allOk = false;
          }
        } catch {
          allOk = false;
        }
      }
      setSyncStatus(allOk ? 'ok' : 'error');
    };

    const triggerSync = () => {
      void doSync();
    };

    triggerSync();
    intervalRef.current = setInterval(triggerSync, SYNC_INTERVAL_MS);
    window.addEventListener('online', triggerSync);
    window.addEventListener('focus', triggerSync);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online', triggerSync);
      window.removeEventListener('focus', triggerSync);
    };
  }, []);

  return { syncStatus, queuedCount };
}
