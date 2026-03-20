import type { HeraldReport } from './herald-types';
import { getShiftId } from './herald-session';

export function toSyncPayload(report: HeraldReport): Record<string, unknown> {
  return {
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
    shift_id: getShiftId() ?? null,
  };
}
