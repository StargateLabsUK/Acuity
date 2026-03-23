import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Assessment } from '@/lib/herald-types';

export interface CommandReport {
  id: string;
  timestamp: string;
  transcript: string | null;
  assessment: Assessment | null;
  synced: boolean | null;
  confirmed_at: string | null;
  headline: string | null;
  operator_id: string | null;
  device_id: string | null;
  priority: string | null;
  service: string | null;
  created_at: string | null;
  lat: number | null;
  lng: number | null;
  location_accuracy: number | null;
  session_callsign: string | null;
  session_operator_id: string | null;
  session_service: string | null;
  session_station: string | null;
  incident_number: string | null;
  transmission_count: number | null;
  latest_transmission_at: string | null;
  isNew?: boolean;
}

export function useHeraldCommand() {
  const [reports, setReports] = useState<CommandReport[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const retryRef = useRef<ReturnType<typeof setInterval>>();

  const fetchReports = useCallback(async () => {
    try {
      // Only fetch today's reports for the transmissions feed
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('herald_reports')
        .select('*')
        .gte('created_at', todayStart.toISOString())
        .order('latest_transmission_at', { ascending: false, nullsFirst: false })
        .limit(200);

      if (error) throw error;

      const parsed: CommandReport[] = (data ?? []).map((r) => ({
        ...r,
        assessment: r.assessment ? (r.assessment as unknown as Assessment) : null,
        session_callsign: (r as any).session_callsign ?? null,
        session_operator_id: (r as any).session_operator_id ?? null,
        session_service: (r as any).session_service ?? null,
        session_station: (r as any).session_station ?? null,
      }));
      setReports(parsed);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const subscribe = useCallback(() => {
    const channel = supabase
      .channel('herald-command')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'herald_reports' },
        (payload) => {
          const r = payload.new as any;
          const report: CommandReport = {
            ...r,
            assessment: r.assessment ? (r.assessment as Assessment) : null,
            session_callsign: r.session_callsign ?? null,
            session_operator_id: r.session_operator_id ?? null,
            session_service: r.session_service ?? null,
            session_station: r.session_station ?? null,
            isNew: true,
          };
          setReports((prev) => [report, ...prev]);

          setTimeout(() => {
            setReports((prev) =>
              prev.map((p) => (p.id === report.id ? { ...p, isNew: false } : p))
            );
          }, 800);
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    return channel;
  }, []);

  useEffect(() => {
    fetchReports();
    const channel = subscribe();

    retryRef.current = setInterval(() => {
      if (!connected) {
        supabase.removeChannel(channel);
        subscribe();
      }
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      if (retryRef.current) clearInterval(retryRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const todayReports = reports.filter((r) => {
    const d = new Date(r.created_at ?? r.timestamp);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });

  const priorityCounts = { P1: 0, P2: 0, P3: 0 };
  todayReports.forEach((r) => {
    const p = r.assessment?.priority ?? r.priority;
    if (p === 'P1') priorityCounts.P1++;
    else if (p === 'P2') priorityCounts.P2++;
    else if (p === 'P3') priorityCounts.P3++;
  });

  const serviceCounts: Record<string, number> = {};
  todayReports.forEach((r) => {
    const s = r.assessment?.service ?? r.service ?? 'unknown';
    serviceCounts[s] = (serviceCounts[s] || 0) + 1;
  });

  const uniqueDevices = new Set(todayReports.map((r) => r.device_id).filter(Boolean)).size;

  return {
    reports,
    todayReports,
    priorityCounts,
    serviceCounts,
    uniqueDevices,
    connected,
    loading,
  };
}
