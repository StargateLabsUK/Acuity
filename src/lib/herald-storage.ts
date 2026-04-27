import type { HeraldReport, CasualtyDisposition } from './herald-types';
import { readEncrypted, writeEncrypted, removeEncrypted } from './crypto';

const STORAGE_KEY = 'herald_reports';
const DISPOSITIONS_KEY = 'herald_casualty_dispositions';

export async function getReports(): Promise<HeraldReport[]> {
  return (await readEncrypted<HeraldReport[]>(STORAGE_KEY)) ?? [];
}

export async function saveReport(report: HeraldReport): Promise<void> {
  const reports = await getReports();
  reports.unshift(report);
  await writeEncrypted(STORAGE_KEY, reports);
}

export async function updateReport(id: string, updates: Partial<HeraldReport>): Promise<void> {
  const reports = await getReports();
  const idx = reports.findIndex((r) => r.id === id);
  if (idx !== -1) {
    reports[idx] = { ...reports[idx], ...updates };
    await writeEncrypted(STORAGE_KEY, reports);
  }
}

export async function markSynced(id: string): Promise<void> {
  await updateReport(id, { synced: true });
}

export async function getUnsyncedReports(): Promise<HeraldReport[]> {
  return (await getReports()).filter((r) => !r.synced);
}

export async function getShiftReports(callsign: string, sessionDate: string): Promise<HeraldReport[]> {
  return (await getReports()).filter(
    (r) =>
      r.session_callsign === callsign &&
      new Date(r.timestamp).toISOString().slice(0, 10) === sessionDate
  );
}

// ── Casualty Dispositions ──

export async function getCasualtyDispositions(): Promise<CasualtyDisposition[]> {
  return (await readEncrypted<CasualtyDisposition[]>(DISPOSITIONS_KEY)) ?? [];
}

export async function saveCasualtyDisposition(d: CasualtyDisposition): Promise<void> {
  const all = await getCasualtyDispositions();
  const idx = all.findIndex((x) => {
    if (x.incident_id !== d.incident_id) return false;
    if (d.patient_id && x.patient_id) return x.patient_id === d.patient_id;
    return x.casualty_key === d.casualty_key;
  });
  if (idx !== -1) all[idx] = d;
  else all.unshift(d);
  await writeEncrypted(DISPOSITIONS_KEY, all);
}

export async function getDispositionsForShift(callsign: string, sessionDate: string): Promise<CasualtyDisposition[]> {
  const dispositions = await getCasualtyDispositions();
  const reports = await getReports();
  return dispositions.filter(d => {
    if (d.session_callsign) {
      return d.session_callsign === callsign &&
        new Date(d.closed_at).toISOString().slice(0, 10) === sessionDate;
    }
    const report = reports.find(r => r.id === d.incident_id);
    return !!report &&
      report.session_callsign === callsign &&
      new Date(report.timestamp).toISOString().slice(0, 10) === sessionDate;
  });
}

export async function isCasualtyClosed(
  incidentId: string,
  casualtyKey: string,
  patientId?: string | null,
): Promise<boolean> {
  const dispositions = await getCasualtyDispositions();
  if (patientId) {
    return dispositions.some(
      d => d.incident_id === incidentId && d.patient_id === patientId,
    );
  }
  return dispositions.some(
    d => d.incident_id === incidentId && d.casualty_key === casualtyKey
  );
}
