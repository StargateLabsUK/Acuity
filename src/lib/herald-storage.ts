import type { HeraldReport, CasualtyDisposition } from './herald-types';

const STORAGE_KEY = 'herald_reports';
const DISPOSITIONS_KEY = 'herald_casualty_dispositions';

export function getReports(): HeraldReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveReport(report: HeraldReport): void {
  const reports = getReports();
  reports.unshift(report);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export function updateReport(id: string, updates: Partial<HeraldReport>): void {
  const reports = getReports();
  const idx = reports.findIndex((r) => r.id === id);
  if (idx !== -1) {
    reports[idx] = { ...reports[idx], ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  }
}

export function markSynced(id: string): void {
  updateReport(id, { synced: true });
}

export function getUnsyncedReports(): HeraldReport[] {
  return getReports().filter((r) => !r.synced);
}

export function getShiftReports(callsign: string, sessionDate: string): HeraldReport[] {
  return getReports().filter(
    (r) =>
      r.session_callsign === callsign &&
      new Date(r.timestamp).toISOString().slice(0, 10) === sessionDate
  );
}

// ── Casualty Dispositions ──

export function getCasualtyDispositions(): CasualtyDisposition[] {
  try {
    const raw = localStorage.getItem(DISPOSITIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCasualtyDisposition(d: CasualtyDisposition): void {
  const all = getCasualtyDispositions();
  // Replace if same incident + casualty key
  const idx = all.findIndex(x => x.incident_id === d.incident_id && x.casualty_key === d.casualty_key);
  if (idx !== -1) all[idx] = d;
  else all.unshift(d);
  localStorage.setItem(DISPOSITIONS_KEY, JSON.stringify(all));
}

export function getDispositionsForShift(callsign: string, sessionDate: string): CasualtyDisposition[] {
  return getCasualtyDispositions().filter(d => {
    const report = getReports().find(r => r.id === d.incident_id);
    return report &&
      report.session_callsign === callsign &&
      new Date(report.timestamp).toISOString().slice(0, 10) === sessionDate;
  });
}

export function isCasualtyClosed(incidentId: string, casualtyKey: string): boolean {
  return getCasualtyDispositions().some(
    d => d.incident_id === incidentId && d.casualty_key === casualtyKey
  );
}
