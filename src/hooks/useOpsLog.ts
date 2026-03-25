import { useState, useEffect, useCallback } from 'react';
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
}

export function useOpsLog() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [transmissions, setTransmissions] = useState<OpsTransmission[]>([]);
  const [dispositions, setDispositions] = useState<OpsDisposition[]>([]);
  const [transfers, setTransfers] = useState<PatientTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [shiftsRes, reportsRes, txRes, dispRes] = await Promise.all([
        supabase
          .from('shifts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('herald_reports')
          .select('id, timestamp, transcript, assessment, headline, priority, service, shift_id, session_callsign, session_operator_id, session_service, session_station, created_at, incident_number, transmission_count, latest_transmission_at, status, confirmed_at, receiving_hospital, vehicle_type')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('incident_transmissions')
          .select('*')
          .order('timestamp', { ascending: true })
          .limit(2000),
        supabase
          .from('casualty_dispositions')
          .select('*')
          .order('closed_at', { ascending: false })
          .limit(1000),
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
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const uniqueServices = Array.from(new Set(shifts.map((s) => s.service).filter(Boolean))).sort();
  const uniqueStations = Array.from(new Set(shifts.map((s) => s.station).filter(Boolean) as string[])).sort();

  return { shifts, reports, transmissions, dispositions, loading, refresh: fetchData, uniqueServices, uniqueStations };
}
