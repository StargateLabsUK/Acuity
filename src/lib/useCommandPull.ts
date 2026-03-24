import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getReports, updateReport } from './herald-storage';
import { getSession } from './herald-session';

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls Supabase for command-side updates (incident_number, receiving_hospital)
 * to reports belonging to the current shift, and patches localStorage.
 * Returns nothing — side-effect only.
 */
export function useCommandPull(onUpdate?: () => void) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const pull = async () => {
      const session = getSession();
      if (!session?.shift_id) return;

      const localReports = getReports().filter(r => {
        return r.session_callsign === session.callsign &&
          new Date(r.timestamp).toISOString().slice(0, 10) === session.session_date;
      });

      if (localReports.length === 0) return;

      const ids = localReports.map(r => r.id);

      try {
        const { data } = await supabase
          .from('herald_reports')
          .select('id, incident_number, receiving_hospital, status')
          .in('id', ids);

        if (!data) return;

        let changed = false;
        for (const row of data) {
          const local = localReports.find(r => r.id === row.id);
          if (!local) continue;

          const updates: Record<string, any> = {};

          // Incident number — command takes priority
          if (row.incident_number && row.incident_number !== local.incident_number) {
            updates.incident_number = row.incident_number;
          }

          // Receiving hospital — stored at report level
          const remoteHospital = (row as any).receiving_hospital;
          if (remoteHospital && remoteHospital !== (local as any).receiving_hospital) {
            (updates as any).receiving_hospital = remoteHospital;
          }

          // Status — sync closures from command
          const remoteStatus = (row as any).status;
          if (remoteStatus && remoteStatus !== local.status) {
            updates.status = remoteStatus;
          }

          if (Object.keys(updates).length > 0) {
            updateReport(row.id, updates as any);
            changed = true;
          }
        }

        if (changed) onUpdate?.();
      } catch {
        // silent — offline or transient failure
      }
    };

    pull();
    intervalRef.current = setInterval(pull, POLL_INTERVAL_MS);
    window.addEventListener('focus', pull);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('focus', pull);
    };
  }, [onUpdate]);
}
