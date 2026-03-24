import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Assessment } from '@/lib/herald-types';

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
}

export interface OpsFilters {
  search: string;
  service: string;
  station: string;
  dateFrom: string;
  dateTo: string;
}

export function useOpsLog() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [shiftsRes, reportsRes] = await Promise.all([
        supabase
          .from('shifts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('herald_reports')
          .select('id, timestamp, transcript, assessment, headline, priority, service, shift_id, session_callsign, session_operator_id, session_service, session_station, created_at, incident_number, transmission_count, latest_transmission_at, status')
          .order('created_at', { ascending: false })
          .limit(500),
      ]);

      if (shiftsRes.data) {
        // Count reports per shift
        const reportsByShift: Record<string, number> = {};
        (reportsRes.data ?? []).forEach((r: any) => {
          if (r.shift_id) reportsByShift[r.shift_id] = (reportsByShift[r.shift_id] || 0) + 1;
        });

        const enriched = shiftsRes.data.map((s: any) => ({
          ...s,
          report_count: reportsByShift[s.id] || 0,
        }));
        setShifts(enriched);
      }

      if (reportsRes.data) {
        setReports(
          reportsRes.data.map((r: any) => ({
            ...r,
            assessment: r.assessment ? (r.assessment as unknown as Assessment) : null,
          }))
        );
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

  return { shifts, reports, loading, refresh: fetchData, uniqueServices, uniqueStations };
}
