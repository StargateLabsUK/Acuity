import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Assessment } from '@/lib/herald-types';
import type { PatientTransfer } from '@/lib/transfer-types';

export interface Shift {
  id: string;
  operator_id: string | null;
  callsign: string;
  service: string;
  station: string | null;
  started_at: string;
  ended_at: string | null;
  device_id: string | null;
  created_at: string;
  report_count?: number;
}

export interface OpsReport {
  id: string;
  timestamp: string;
  transcript: string | null;
  assessment: Assessment | null;
  headline: string | null;
  priority: string | null;
  service: string | null;
  shift_id: string | null;
  session_callsign: string | null;
  session_operator_id: string | null;
  session_service: string | null;
  session_station: string | null;
  created_at: string | null;
  incident_number: string | null;
  transmission_count: number | null;
  latest_transmission_at: string | null;
  status: string | null;
  confirmed_at: string | null;
  receiving_hospital: string | null;
  vehicle_type: string | null;
}

export interface OpsTransmission {
  id: string;
  report_id: string | null;
  timestamp: string;
  transcript: string | null;
  assessment: Assessment | null;
  headline: string | null;
  priority: string | null;
  session_callsign: string | null;
  operator_id: string | null;
  created_at: string | null;
}

export interface OpsDisposition {
  id: string;
  report_id: string;
  casualty_key: string;
  casualty_label: string;
  priority: string;
  disposition: string;
  fields: Record<string, unknown> | null;
  closed_at: string;
  session_callsign: string | null;
  incident_number: string | null;
}

export interface OpsFilters {
  search: string;
  service: string;
  station: string;
  dateFrom: string;
  dateTo: string;
  outcome: string;
  incidentType: string;
  callsign: string;
  operatorId: string;
  safeguarding: string;
}

export function useOpsLog() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [transmissions, setTransmissions] = useState<OpsTransmission[]>([]);
  const [dispositions, setDispositions] = useState<OpsDisposition[]>([]);
  const [transfers, setTransfers] = useState<PatientTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const trustIdRef = useRef<string | null>(null);
  const isOwnerRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setReady(true);
        return;
      }
      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id);
      const owner = roles?.some((r: any) => r.role === 'owner') ?? false;
      const { data: profile } = await supabase.from('profiles').select('trust_id').eq('id', session.user.id).maybeSingle();
      trustIdRef.current = profile?.trust_id ?? null;
      isOwnerRef.current = owner;
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const tid = trustIdRef.current;
      if (!isOwnerRef.current && !tid) {
        setShifts([]);
        setReports([]);
        setTransmissions([]);
        setDispositions([]);
        setTransfers([]);
        return;
      }
      let shiftsQ = supabase
        .from('shifts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      let reportsQ = supabase
        .from('herald_reports')
        .select('id, timestamp, transcript, assessment, headline, priority, service, shift_id, session_callsign, session_operator_id, session_service, session_station, created_at, incident_number, transmission_count, latest_transmission_at, status, confirmed_at, receiving_hospital, vehicle_type')
        .order('created_at', { ascending: false })
        .limit(500);
      let txQ = supabase
        .from('incident_transmissions')
        .select('*')
        .order('timestamp', { ascending: true })
        .limit(2000);
      let dispQ = supabase
        .from('casualty_dispositions')
        .select('*')
        .order('closed_at', { ascending: false })
        .limit(1000);
      let transfersQ = supabase
        .from('patient_transfers')
        .select('*')
        .order('initiated_at', { ascending: false })
        .limit(500);

      if (!isOwnerRef.current && tid) {
        shiftsQ = shiftsQ.eq('trust_id', tid);
        reportsQ = reportsQ.eq('trust_id', tid);
        txQ = txQ.eq('trust_id', tid);
        dispQ = dispQ.eq('trust_id', tid);
        transfersQ = transfersQ.eq('trust_id', tid);
      }

      const [shiftsRes, reportsRes, txRes, dispRes, transfersRes] = await Promise.all([
        shiftsQ, reportsQ, txQ, dispQ, transfersQ,
      ]);

      if (shiftsRes.data) {
        const reportsByShift: Record<string, number> = {};
        (reportsRes.data ?? []).forEach((r: any) => {
          if (r.shift_id) reportsByShift[r.shift_id] = (reportsByShift[r.shift_id] || 0) + 1;
        });
        setShifts(
          shiftsRes.data.map((s: any) => ({ ...s, report_count: reportsByShift[s.id] || 0 }))
        );
      }

      if (reportsRes.data) {
        setReports(
          reportsRes.data.map((r: any) => ({
            ...r,
            assessment: r.assessment ? (r.assessment as unknown as Assessment) : null,
          }))
        );
      }

      if (txRes.data) {
        setTransmissions(
          txRes.data.map((t: any) => ({
            ...t,
            assessment: t.assessment ? (t.assessment as unknown as Assessment) : null,
          }))
        );
      }

      if (dispRes.data) {
        setDispositions(dispRes.data as unknown as OpsDisposition[]);
      }
      if (transfersRes.data) {
        setTransfers(transfersRes.data as unknown as PatientTransfer[]);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    fetchData();
  }, [fetchData, ready]);

  const uniqueServices = Array.from(new Set(shifts.map((s) => s.service).filter(Boolean))).sort();
  const uniqueStations = Array.from(new Set(reports.map((r) => r.session_station).filter(Boolean) as string[])).sort();
  const uniqueCallsigns = Array.from(new Set(reports.map(r => r.session_callsign).filter(Boolean) as string[])).sort();
  const uniqueOperatorIds = Array.from(new Set(reports.map(r => r.session_operator_id).filter(Boolean) as string[])).sort();

  return { shifts, reports, transmissions, dispositions, transfers, loading, refresh: fetchData, uniqueServices, uniqueStations, uniqueCallsigns, uniqueOperatorIds };
}
