import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Assessment, DispositionType, DispositionFields } from '@/lib/herald-types';
import type { PatientTransfer } from '@/lib/transfer-types';

export interface CommandDisposition {
  id: string;
  report_id: string;
  casualty_key: string;
  casualty_label: string;
  priority: string;
  disposition: DispositionType;
  fields: DispositionFields;
  incident_number: string | null;
  closed_at: string;
  session_callsign: string | null;
  created_at: string | null;
}

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
  status: string | null;
  shift_id: string | null;
  vehicle_type: string | null;
  can_transport: boolean | null;
  critical_care: boolean | null;
  receiving_hospital: string | null;
  isNew?: boolean;
}

export interface CommandShift {
  id: string;
  callsign: string | null;
  operator_id: string | null;
  service: string | null;
  station: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string | null;
  vehicle_type: string | null;
  can_transport: boolean | null;
  critical_care: boolean | null;
}

export function useHeraldCommand() {
  const [reports, setReports] = useState<CommandReport[]>([]);
  const [shifts, setShifts] = useState<CommandShift[]>([]);
  const [dispositions, setDispositions] = useState<CommandDisposition[]>([]);
  const [transfers, setTransfers] = useState<PatientTransfer[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const retryRef = useRef<ReturnType<typeof setInterval>>();
  const trustIdRef = useRef<string | null>(null);
  const isOwnerRef = useRef(false);
  const connectedRef = useRef(false);

  // Resolve user's trust_id on mount — must complete before any data fetch
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id);
      isOwnerRef.current = roles?.some(r => r.role === 'owner') ?? false;
      const { data: profile } = await supabase.from('profiles').select('trust_id').eq('id', session.user.id).maybeSingle();
      trustIdRef.current = profile?.trust_id ?? null;
      setReady(true);
    })();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // Use UTC midnight for today's start
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

      // Build queries — filter by trust_id unless user is owner
      const tid = trustIdRef.current;
      let reportsQ = supabase.from('herald_reports').select('*').gte('created_at', todayStart.toISOString()).order('latest_transmission_at', { ascending: false, nullsFirst: false }).limit(200);
      let shiftsQ = supabase.from('shifts').select('*').is('ended_at', null).order('created_at', { ascending: false }).limit(50);
      let disposQ = supabase.from('casualty_dispositions').select('*').gte('created_at', todayStart.toISOString()).order('closed_at', { ascending: false }).limit(500);
      let transQ = supabase.from('patient_transfers').select('*').gte('created_at', todayStart.toISOString()).order('initiated_at', { ascending: false }).limit(200);

      if (!isOwnerRef.current && tid) {
        reportsQ = reportsQ.eq('trust_id', tid);
        shiftsQ = shiftsQ.eq('trust_id', tid);
        disposQ = disposQ.eq('trust_id', tid);
        transQ = transQ.eq('trust_id', tid);
      }

      const [reportsRes, shiftsRes, dispositionsRes, transfersRes] = await Promise.all([
        reportsQ, shiftsQ, disposQ, transQ,
      ]);

      if (reportsRes.error) throw reportsRes.error;

      const parsed: CommandReport[] = (reportsRes.data ?? []).map((r) => ({
        ...r,
        assessment: r.assessment ? (r.assessment as unknown as Assessment) : null,
        session_callsign: (r as any).session_callsign ?? null,
        session_operator_id: (r as any).session_operator_id ?? null,
        session_service: (r as any).session_service ?? null,
        session_station: (r as any).session_station ?? null,
      }));
      setReports(parsed);

      if (shiftsRes.data) {
        setShifts(shiftsRes.data as CommandShift[]);
      }
      if (dispositionsRes.data) {
        setDispositions(dispositionsRes.data as unknown as CommandDisposition[]);
      }
      if (transfersRes.data) {
        setTransfers(transfersRes.data as unknown as PatientTransfer[]);
      }
      // Data loaded successfully — we're connected
      if (!connectedRef.current) {
        connectedRef.current = true;
        setConnected(true);
      }
    } catch {
      connectedRef.current = false;
      setConnected(false);
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
            incident_number: r.incident_number ?? null,
            transmission_count: r.transmission_count ?? 1,
            latest_transmission_at: r.latest_transmission_at ?? null,
            status: r.status ?? 'active',
            shift_id: r.shift_id ?? null,
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
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'herald_reports' },
        (payload) => {
          const r = payload.new as any;
          setReports((prev) =>
            prev.map((p) => {
              if (p.id !== r.id) return p;
              return {
                ...p,
                ...r,
                assessment: r.assessment ? (r.assessment as Assessment) : p.assessment,
                incident_number: r.incident_number ?? p.incident_number,
                transmission_count: r.transmission_count ?? p.transmission_count,
                latest_transmission_at: r.latest_transmission_at ?? p.latest_transmission_at,
                status: r.status ?? p.status,
                priority: r.priority ?? p.priority,
                headline: r.headline ?? p.headline,
                isNew: true,
              };
            })
          );
          setTimeout(() => {
            setReports((prev) =>
              prev.map((p) => (p.id === r.id ? { ...p, isNew: false } : p))
            );
          }, 800);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'casualty_dispositions' },
        (payload) => {
          const d = payload.new as unknown as CommandDisposition;
          setDispositions((prev) => [d, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'patient_transfers' },
        (payload) => {
          const t = payload.new as unknown as PatientTransfer;
          setTransfers((prev) => [t, ...prev]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'patient_transfers' },
        (payload) => {
          const t = payload.new as unknown as PatientTransfer;
          setTransfers((prev) => prev.map((p) => (p.id === t.id ? t : p)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'shifts' },
        (payload) => {
          const s = payload.new as any;
          if (s.ended_at) {
            // Shift ended — remove from active list
            setShifts((prev) => prev.filter((p) => p.id !== s.id));
          } else {
            // Shift updated (e.g. callsign change) — update in place
            setShifts((prev) => prev.map((p) => (p.id === s.id ? { ...p, ...s } : p)));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shifts' },
        (payload) => {
          const s = payload.new as unknown as CommandShift;
          if (!s.ended_at) {
            setShifts((prev) => [s, ...prev]);
          }
        }
      )
      .subscribe((status) => {
        const isConnected = status === 'SUBSCRIBED';
        connectedRef.current = isConnected;
        setConnected(isConnected);
      });

    return channel;
  }, []);

  useEffect(() => {
    if (!ready) return; // Wait for trust_id to be resolved

    fetchData();
    const channel = subscribe();

    // Poll every 10 seconds as fallback (realtime may not connect with complex RLS)
    const pollInterval = setInterval(() => {
      fetchData();
    }, 10000);

    // Listen for action resolved events for immediate refresh
    const handleResolved = () => fetchData();
    window.addEventListener('herald-action-resolved', handleResolved);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
      window.removeEventListener('herald-action-resolved', handleResolved);
      if (retryRef.current) clearInterval(retryRef.current);
    };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const activeShifts = shifts.filter((s) => !s.ended_at);

  return {
    reports,
    todayReports,
    priorityCounts,
    serviceCounts,
    uniqueDevices,
    connected,
    loading,
    activeShifts,
    dispositions,
    transfers,
  };
}
