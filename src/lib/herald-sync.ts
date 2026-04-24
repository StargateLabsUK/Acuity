import type { HeraldReport } from './herald-types';
import { getShiftId, getSession, getTrustId } from './herald-session';

export async function toSyncPayload(report: HeraldReport, followUpOf?: string): Promise<Record<string, unknown>> {
  const session = await getSession();
  const reportShiftId = (report as HeraldReport & { shift_id?: string | null }).shift_id ?? null;
  const reportTrustId = (report as HeraldReport & { trust_id?: string | null }).trust_id ?? null;
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
    original_assessment: (report as any).original_assessment ?? null,
    final_assessment: (report as any).final_assessment ?? null,
    diff: (report as any).diff ?? null,
    edited: (report as any).edited ?? false,
    session_callsign: report.session_callsign ?? null,
    session_operator_id: report.session_operator_id ?? null,
    session_service: report.session_service ?? null,
    session_station: report.session_station ?? null,
    shift_id: reportShiftId ?? await getShiftId() ?? null,
    incident_number: report.incident_number ?? null,
    follow_up_of: followUpOf ?? null,
    vehicle_type: session?.vehicle_type ?? null,
    can_transport: session?.can_transport ?? true,
    critical_care: session?.critical_care ?? false,
    trust_id: reportTrustId ?? await getTrustId() ?? null,
  };
}
