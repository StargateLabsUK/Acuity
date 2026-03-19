import type { HeraldReport } from './herald-types';

const STORAGE_KEY = 'herald_reports';

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
