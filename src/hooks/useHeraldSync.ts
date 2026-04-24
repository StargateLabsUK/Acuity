import { useEffect, useRef, useState, useCallback } from 'react';
import { getUnsyncedReports, markSynced } from '@/lib/herald-storage';
import { syncReport } from '@/lib/herald-api';
import { toSyncPayload } from '@/lib/herald-sync';
import { processQueue } from '@/lib/offline-queue-processor';
import { count as offlineQueueCount, countDeadLetters as offlineDeadLetterCount } from '@/lib/offline-queue';

const SYNC_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 1500; // wait for network to stabilise after online event

export function useHeraldSync() {
  const [syncStatus, setSyncStatus] = useState<'ok' | 'error' | 'offline'>('ok');
  const [queuedCount, setQueuedCount] = useState(0);
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncingRef = useRef(false);

  const doSync = useCallback(async () => {
    if (syncingRef.current) return; // prevent concurrent syncs
    syncingRef.current = true;

    try {
      if (!navigator.onLine) {
        setSyncStatus('offline');
        setQueuedCount(await offlineQueueCount());
        setDeadLetterCount(await offlineDeadLetterCount());
        return;
      }

      // 1. Drain the offline queue (dispositions, transfers, transcriptions)
      try {
        await processQueue();
      } catch {
        // queue processing is best-effort
      }

      // 2. Sync unsynced local reports
      const unsynced = await getUnsyncedReports();
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

      const remaining = await offlineQueueCount();
      const deadLetters = await offlineDeadLetterCount();
      setQueuedCount(remaining);
      setDeadLetterCount(deadLetters);
      setSyncStatus(!allOk || deadLetters > 0 ? 'error' : 'ok');
    } finally {
      syncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const triggerSync = () => { void doSync(); };

    // On reconnect, wait briefly for the network to stabilise before syncing
    const onOnline = () => {
      setTimeout(triggerSync, RECONNECT_DELAY_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') triggerSync();
    };

    triggerSync();
    intervalRef.current = setInterval(triggerSync, SYNC_INTERVAL_MS);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', triggerSync);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', triggerSync);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [doSync]);

  return { syncStatus, queuedCount, deadLetterCount, triggerSync: doSync };
}
