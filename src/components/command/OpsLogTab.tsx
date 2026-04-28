import { useMemo, useState, type CSSProperties } from 'react';
import { Search, ArrowLeft, ChevronRight } from 'lucide-react';
import { useOpsLog, type OpsReport, type OpsTransmission, type OpsDisposition, type OpsFilters } from '@/hooks/useOpsLog';
import { PRIORITY_COLORS, DISPOSITION_LABELS } from '@/lib/herald-types';
import type { Assessment, DispositionType } from '@/lib/herald-types';
import type { PatientTransfer } from '@/lib/transfer-types';

type AbcdeKey = 'A' | 'B' | 'C' | 'D' | 'E';
type ClinicalFindings = Partial<Record<AbcdeKey, string>>;

interface CasualtySummary {
  key: string;
  patientId?: string | null;
  label: string;
  priority: string;
  atmist: Record<string, unknown> | null;
  disposition: OpsDisposition | null;
  transfer: PatientTransfer | null;
}

interface ClinicalTimelineEntry {
  id: string;
  timestamp: string;
  source: 'transmission' | 'transfer';
  headline: string;
  transcript?: string | null;
  note?: string | null;
  atmist: Record<string, unknown> | null;
  clinicalFindings: ClinicalFindings;
}

function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no-op
    }
  };
  return (
    <button
      onClick={copy}
      className="px-2.5 py-1 text-[11px] font-semibold tracking-[0.1em] rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? 'COPIED' : 'COPY ePRF'}
    </button>
  );
}

const inputStyle: CSSProperties = {
  background: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
};

const badgeStyle = (color: string) => ({
  color,
  border: `1px solid ${color}44`,
  background: `${color}12`,
  fontSize: 13,
  fontWeight: 700 as const,
  padding: '2px 8px',
  borderRadius: 4,
  whiteSpace: 'nowrap' as const,
});

const ATMIST_FIELD_LABELS: Record<string, string> = {
  A: 'Age / Sex',
  T: 'Time of Injury',
  M: 'Mechanism',
  I: 'Injuries',
  S: 'Signs / Vitals',
  T_treatment: 'Treatment Given',
};

const ABCDE_LABELS: Record<AbcdeKey, string> = {
  A: 'Airway',
  B: 'Breathing',
  C: 'Circulation',
  D: 'Disability',
  E: 'Exposure',
};

const INCIDENT_TYPE_OPTIONS = [
  'cardiac arrest',
  'rtc',
  'trauma',
  'medical',
  'fall',
  'chest pain',
  'breathing',
  'stroke',
  'overdose',
  'maternity',
];

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}Z`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}

function safeString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function hasMeaningfulText(value: unknown): boolean {
  const text = safeString(value).trim();
  if (!text) return false;
  return !['not assessed', 'unknown', 'n/a', '—'].includes(text.toLowerCase());
}

function matchesSearch(text: string | null | undefined, query: string): boolean {
  if (!query) return true;
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

function getIncidentType(report: OpsReport): string {
  if (typeof report.assessment?.headline === 'string' && report.assessment.headline.trim()) return report.assessment.headline;
  if (typeof report.headline === 'string' && report.headline.trim()) return report.headline;
  return 'Unknown';
}

function getLocation(report: OpsReport): string {
  const structured = report.assessment?.structured as Record<string, unknown> | undefined;
  const candidates = [
    report.assessment?.scene_location,
    structured?.location,
    structured?.scene_location,
    structured?.address,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return 'Location not specified';
}

function incidentTitle(report: OpsReport): string {
  if (report.incident_number && report.incident_number.trim()) return report.incident_number.trim();
  return `INCIDENT-${report.id.slice(0, 8).toUpperCase()}`;
}

function getCasualtyCount(report: OpsReport): number {
  const atmist = report.assessment?.atmist;
  if (!atmist || typeof atmist !== 'object') return 0;
  return Object.keys(atmist).length;
}

function normalizeClinicalFindings(value: unknown): ClinicalFindings {
  if (!value || typeof value !== 'object') return {};
  const findings = value as Record<string, unknown>;
  const normalized: ClinicalFindings = {};
  (['A', 'B', 'C', 'D', 'E'] as AbcdeKey[]).forEach((key) => {
    const raw = findings[key];
    if (hasMeaningfulText(raw)) normalized[key] = safeString(raw).trim();
  });
  return normalized;
}

function hasClinicalFindings(findings: ClinicalFindings): boolean {
  return (['A', 'B', 'C', 'D', 'E'] as AbcdeKey[]).some((key) => hasMeaningfulText(findings[key]));
}

function priorityFromCasualtyKey(casualtyKey: string): string {
  const priority = casualtyKey.match(/^P\d+/)?.[0];
  return priority ?? casualtyKey;
}

function extractAtmistForCasualty(assessment: Assessment | null | undefined, casualtyKey: string): Record<string, unknown> | null {
  const atmist = assessment?.atmist;
  if (!atmist || typeof atmist !== 'object') return null;

  const asMap = atmist as Record<string, unknown>;
  if (typeof asMap[casualtyKey] === 'object' && asMap[casualtyKey] !== null) {
    return asMap[casualtyKey] as Record<string, unknown>;
  }

  const base = casualtyKey.replace(/-\d+$/, '');
  if (typeof asMap[base] === 'object' && asMap[base] !== null) {
    return asMap[base] as Record<string, unknown>;
  }

  const related = Object.entries(asMap).filter(([key, value]) => {
    if (typeof value !== 'object' || value === null) return false;
    return key === base || key.startsWith(`${base}-`);
  });

  if (related.length === 1) return related[0][1] as Record<string, unknown>;
  return null;
}

function extractPatientIdForCasualty(
  assessment: Assessment | null | undefined,
  casualtyKey: string,
): string | null {
  const atmist = extractAtmistForCasualty(assessment, casualtyKey);
  if (atmist && typeof atmist.patient_id === 'string' && atmist.patient_id.trim()) {
    return atmist.patient_id.trim();
  }
  return null;
}

function buildCasualties(report: OpsReport, dispositions: OpsDisposition[], transfers: PatientTransfer[]): CasualtySummary[] {
  const atmistMap = (report.assessment?.atmist ?? {}) as Record<string, Record<string, unknown> | null>;
  const atmistKeys = Object.keys(atmistMap);
  const dispositionKeys = dispositions
    .filter((d) => d.report_id === report.id)
    .map((d) => d.casualty_key);
  const allKeys = Array.from(new Set([...atmistKeys, ...dispositionKeys]));

  return allKeys.map((key) => {
    const disposition = dispositions.find((d) => d.report_id === report.id && d.casualty_key === key) ?? null;
    const transfer = transfers.find((t) => t.report_id === report.id && t.casualty_key === key) ?? null;
    const atmist = atmistMap[key] ?? null;
    const patientId = extractPatientIdForCasualty(report.assessment, key);
    const priority = disposition?.priority ?? priorityFromCasualtyKey(key);
    const label = disposition?.casualty_label ?? (hasMeaningfulText(atmist?.A) ? `${key} — ${String(atmist?.A)}` : key);
    return { key, patientId, label, priority, atmist, disposition, transfer };
  });
}

function buildClinicalTimeline(
  report: OpsReport,
  transmissions: OpsTransmission[],
  transfers: PatientTransfer[],
  casualty: CasualtySummary,
  totalCasualties: number,
): ClinicalTimelineEntry[] {
  const timeline: ClinicalTimelineEntry[] = [];
  const seenTransmissionFingerprint = new Set<string>();

  transmissions
    .filter((tx) => tx.report_id === report.id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .forEach((tx) => {
      // Defensive de-duplication: collapse replay duplicates to one clinical entry.
      const fingerprint = [
        tx.report_id,
        tx.timestamp,
        tx.session_callsign ?? '',
        tx.headline ?? '',
        tx.transcript ?? '',
      ].join('|');
      if (seenTransmissionFingerprint.has(fingerprint)) return;
      seenTransmissionFingerprint.add(fingerprint);

      const assessment = tx.assessment as Assessment | null;
      const atmist = extractAtmistForCasualty(assessment, casualty.key);
      const clinicalFindings = normalizeClinicalFindings(assessment?.clinical_findings);
      const includeClinical = hasClinicalFindings(clinicalFindings);
      const includeAtmist = !!atmist;

      if (!includeClinical && !includeAtmist) return;

      // If multi-casualty and no casualty-specific ATMIST data, avoid mixing shared updates
      if (!includeAtmist && totalCasualties > 1) return;

      timeline.push({
        id: `tx-${tx.id}`,
        timestamp: tx.timestamp,
        source: 'transmission',
        headline: tx.headline ?? 'Clinical update',
        transcript: tx.transcript,
        atmist,
        clinicalFindings,
      });
    });

  transfers
    .filter((t) => {
      if (t.report_id !== report.id) return false;
      if (casualty.patientId && t.patient_id) return t.patient_id === casualty.patientId;
      return t.casualty_key === casualty.key;
    })
    .forEach((transfer) => {
      const snapshot = transfer.clinical_snapshot;
      if (!snapshot || typeof snapshot !== 'object') return;

      const snapshotRecord = snapshot as Record<string, unknown>;
      const snapshotAtmistRaw = snapshotRecord.atmist;
      const snapshotAtmistMap = (snapshotAtmistRaw && typeof snapshotAtmistRaw === 'object')
        ? (snapshotAtmistRaw as Record<string, unknown>)
        : null;

      let atmist: Record<string, unknown> | null = null;
      if (snapshotAtmistMap) {
        const exact = snapshotAtmistMap[casualty.key];
        if (exact && typeof exact === 'object') atmist = exact as Record<string, unknown>;
        else if (['A', 'T', 'M', 'I', 'S', 'T_treatment'].some((field) => field in snapshotAtmistMap)) {
          atmist = snapshotAtmistMap;
        }
      }

      const assessmentSnapshot = (snapshotRecord.assessment_snapshot && typeof snapshotRecord.assessment_snapshot === 'object')
        ? snapshotRecord.assessment_snapshot as Record<string, unknown>
        : null;
      const clinicalFindings = normalizeClinicalFindings(assessmentSnapshot?.clinical_findings);
      const note = safeString(snapshotRecord.note) || transfer.handover_notes || null;

      if (!atmist && !hasClinicalFindings(clinicalFindings) && !note) return;

      timeline.push({
        id: `transfer-${transfer.id}`,
        timestamp: transfer.accepted_at ?? transfer.initiated_at,
        source: 'transfer',
        headline: `Transfer ${transfer.status}: ${transfer.from_callsign} -> ${transfer.to_callsign}`,
        note,
        atmist,
        clinicalFindings,
      });
    });

  return timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function latestClinicalFindings(
  timeline: ClinicalTimelineEntry[],
  reportAssessment: Assessment | null | undefined,
  totalCasualties: number,
): ClinicalFindings {
  const mergedLatest: ClinicalFindings = {};

  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const findings = timeline[i].clinicalFindings;
    (['A', 'B', 'C', 'D', 'E'] as AbcdeKey[]).forEach((key) => {
      if (!mergedLatest[key] && hasMeaningfulText(findings[key])) {
        mergedLatest[key] = findings[key];
      }
    });
    if ((['A', 'B', 'C', 'D', 'E'] as AbcdeKey[]).every((key) => hasMeaningfulText(mergedLatest[key]))) {
      return mergedLatest;
    }
  }

  if (hasClinicalFindings(mergedLatest)) {
    return mergedLatest;
  }

  if (totalCasualties === 1) return normalizeClinicalFindings(reportAssessment?.clinical_findings);
  return {};
}

function buildOutcomeLines(casualty: CasualtySummary): string[] {
  const lines: string[] = [];
  const disposition = casualty.disposition;
  if (disposition) {
    const dispLabel = DISPOSITION_LABELS[disposition.disposition as DispositionType] ?? disposition.disposition;
    lines.push(`Disposition: ${dispLabel}`);
    lines.push(`Closed: ${fmtDateTime(disposition.closed_at)}`);
    const fields = (disposition.fields ?? {}) as Record<string, unknown>;
    if (fields.receiving_hospital) lines.push(`Receiving hospital: ${safeString(fields.receiving_hospital)}`);
    if (fields.time_of_handover) lines.push(`Time of handover: ${safeString(fields.time_of_handover)}`);
    if (fields.handover_given_to) lines.push(`Handover given to: ${safeString(fields.handover_given_to)}`);
    if (fields.referral_destination) lines.push(`Referral destination: ${safeString(fields.referral_destination)}`);
    if (fields.time_of_discharge) lines.push(`Time of discharge: ${safeString(fields.time_of_discharge)}`);
    if (fields.time_of_refusal) lines.push(`Time of refusal: ${safeString(fields.time_of_refusal)}`);
    if (fields.time_of_recognition) lines.push(`Time of recognition: ${safeString(fields.time_of_recognition)}`);
    return lines;
  }

  if (casualty.transfer) {
    const transfer = casualty.transfer;
    lines.push(`Disposition: Transfer ${transfer.status}`);
    lines.push(`From: ${transfer.from_callsign}`);
    lines.push(`To: ${transfer.to_callsign}`);
    if (transfer.accepted_at) lines.push(`Accepted: ${fmtDateTime(transfer.accepted_at)}`);
    else lines.push(`Initiated: ${fmtDateTime(transfer.initiated_at)}`);
    return lines;
  }

  lines.push('Disposition: Open — patient still active');
  return lines;
}

function buildOpsEprf(
  report: OpsReport,
  casualty: CasualtySummary,
  latestAbcde: ClinicalFindings,
  timeline: ClinicalTimelineEntry[],
): string {
  const atmist = casualty.atmist ?? {};
  const timelineLines = timeline.length > 0
    ? timeline.map((entry, index) => {
      const prefix = entry.source === 'transfer' ? 'TRANSFER' : `UPDATE ${index + 1}`;
      const note = entry.note ? ` — ${entry.note}` : '';
      return `  ${fmtDateTime(entry.timestamp)} ${prefix}: ${entry.headline}${note}`;
    }).join('\n')
    : '  No clinical timeline entries recorded.';

  const outcomeLines = buildOutcomeLines(casualty).map((line) => `  ${line}`).join('\n');

  const incidentType = getIncidentType(report);
  const location = getLocation(report);
  const createdAt = report.latest_transmission_at ?? report.created_at ?? report.timestamp;

  return `ePRF — OPERATIONAL SUMMARY
═══════════════════════════
INCIDENT: ${incidentTitle(report)}
DATE/TIME: ${fmtDateTime(createdAt)}
CALLSIGN: ${report.session_callsign ?? '—'}
INCIDENT TYPE: ${incidentType}
SCENE: ${location}

PATIENT: ${casualty.label}
PRIORITY: ${casualty.priority}

ATMIST:
  Age/Sex: ${safeString(atmist.A) || '—'}
  Time of Injury: ${safeString(atmist.T) || '—'}
  Mechanism: ${safeString(atmist.M) || '—'}
  Injuries: ${safeString(atmist.I) || '—'}${safeString((atmist as Record<string, unknown>).status) ? `\n  Status: ${safeString((atmist as Record<string, unknown>).status)}` : ''}
  Signs/Vitals: ${safeString(atmist.S) || '—'}${safeString((atmist as Record<string, unknown>).downtime) ? `\n  Downtime: ${safeString((atmist as Record<string, unknown>).downtime)}` : ''}
  Treatment: ${safeString(atmist.T_treatment) || '—'}

ABCDE (LATEST):
  A: ${latestAbcde.A ?? '—'}
  B: ${latestAbcde.B ?? '—'}
  C: ${latestAbcde.C ?? '—'}
  D: ${latestAbcde.D ?? '—'}
  E: ${latestAbcde.E ?? '—'}

CLINICAL TIMELINE:
${timelineLines}

OUTCOME:
${outcomeLines}
═══════════════════════════
Generated by Acuity Radio Intelligence`;
}

function applyFilters(reports: OpsReport[], dispositions: OpsDisposition[], filters: OpsFilters): OpsReport[] {
  let filtered = [...reports];
  const query = filters.search.trim().toLowerCase();

  if (query) {
    filtered = filtered.filter((report) =>
      matchesSearch(report.session_callsign, query)
      || matchesSearch(report.headline, query)
      || matchesSearch(report.assessment?.headline, query)
      || matchesSearch(report.incident_number, query)
      || matchesSearch(report.session_operator_id, query)
      || matchesSearch(report.transcript, query)
      || matchesSearch(getLocation(report), query)
      || matchesSearch(getIncidentType(report), query)
      || (query === 'safeguarding' && (report.assessment as any)?.safeguarding?.concern_identified === true)
      || matchesSearch((report.assessment as any)?.safeguarding?.details, query)
    );
  }

  if (filters.callsign) filtered = filtered.filter((r) => r.session_callsign === filters.callsign);
  if (filters.operatorId) filtered = filtered.filter((r) => r.session_operator_id === filters.operatorId);

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    filtered = filtered.filter((r) => new Date(r.created_at ?? r.timestamp).getTime() >= from);
  }

  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime() + 86400000;
    filtered = filtered.filter((r) => new Date(r.created_at ?? r.timestamp).getTime() < to);
  }

  if (filters.outcome) {
    const reportIds = new Set(dispositions.filter((d) => d.disposition === filters.outcome).map((d) => d.report_id));
    filtered = filtered.filter((r) => reportIds.has(r.id));
  }

  if (filters.incidentType) {
    const incidentType = filters.incidentType.toLowerCase();
    filtered = filtered.filter((r) => getIncidentType(r).toLowerCase().includes(incidentType));
  }

  if (filters.safeguarding === 'yes') {
    filtered = filtered.filter((r) => (r.assessment as any)?.safeguarding?.concern_identified === true);
  } else if (filters.safeguarding === 'no') {
    filtered = filtered.filter((r) => !(r.assessment as any)?.safeguarding?.concern_identified);
  }

  return filtered;
}

function IncidentCard({
  report,
  dispositions,
  transfers,
  onClick,
}: {
  report: OpsReport;
  dispositions: OpsDisposition[];
  transfers: PatientTransfer[];
  onClick: () => void;
}) {
  const isClosed = report.status === 'closed';
  const hasTransfer = transfers.some((t) => t.report_id === report.id);
  const casualtyCount = Math.max(
    getCasualtyCount(report),
    dispositions.filter((d) => d.report_id === report.id).length,
  );

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card shadow-sm p-3 cursor-pointer hover:bg-muted/30 transition-colors mb-2 block"
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-sm font-bold" style={badgeStyle(isClosed ? '#888' : '#FF9500')}>
          {isClosed ? 'CLOSED' : 'ACTIVE'}
        </span>
        {hasTransfer && <span className="text-sm font-bold" style={badgeStyle('#8B5CF6')}>XFER</span>}
      </div>
      <p className="text-base text-foreground font-bold truncate mb-0.5">{incidentTitle(report)}</p>
      <p className="text-sm text-muted-foreground truncate mb-1">{getIncidentType(report)}</p>
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>📍 {getLocation(report)}</span>
        <span>{fmtDateTime(report.latest_transmission_at ?? report.created_at ?? report.timestamp)}</span>
        {casualtyCount > 0 && <span>{casualtyCount} patient{casualtyCount === 1 ? '' : 's'}</span>}
      </div>
    </button>
  );
}

function PatientListCard({ casualty, onOpen }: { casualty: CasualtySummary; onOpen: () => void }) {
  const priorityColor = PRIORITY_COLORS[casualty.priority] ?? '#888';
  const outcomeLabel = casualty.disposition
    ? (DISPOSITION_LABELS[casualty.disposition.disposition as DispositionType] ?? casualty.disposition.disposition)
    : 'Open';
  const outcomeColor = !casualty.disposition
    ? '#6B7280'
    : casualty.disposition.disposition === 'conveyed'
      ? '#34C759'
      : casualty.disposition.disposition === 'refused_transport'
        ? '#FF9500'
        : casualty.disposition.disposition === 'role'
          ? '#EF4444'
          : casualty.disposition.disposition === 'transferred'
            ? '#8B5CF6'
            : '#1E90FF';
  const injurySummary = casualty.atmist ? safeString(casualty.atmist.I) : '';

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl border border-border bg-card px-4 py-3.5 hover:bg-muted/30 transition-colors cursor-pointer shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-sm font-bold" style={badgeStyle(priorityColor)}>{casualty.priority}</span>
            <span className="text-base text-foreground font-semibold break-words">{casualty.label}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold" style={badgeStyle(outcomeColor)}>
              {outcomeLabel}
            </span>
          </div>
          {injurySummary && (
            <p className="text-xs text-muted-foreground mt-2 leading-5 line-clamp-2">
              {injurySummary}
            </p>
          )}
        </div>
        <ChevronRight size={18} className="text-muted-foreground mt-1 flex-shrink-0" />
      </div>
    </button>
  );
}

function PatientDetailView({
  report,
  casualty,
  timeline,
  totalCasualties,
  onBack,
}: {
  report: OpsReport;
  casualty: CasualtySummary;
  timeline: ClinicalTimelineEntry[];
  totalCasualties: number;
  onBack: () => void;
}) {
  const latestAbcde = latestClinicalFindings(timeline, report.assessment, totalCasualties);
  const atmist = casualty.atmist;
  const outcome = casualty.disposition;
  const transfer = casualty.transfer;
  const eprfText = buildOpsEprf(report, casualty, latestAbcde, timeline);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-primary bg-transparent cursor-pointer">
          <ArrowLeft size={16} /> Back to patient list
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="sticky top-0 z-10 -mx-4 px-4 py-3 border-b border-border bg-background/95 backdrop-blur">
          <div className="rounded-lg p-3 border border-border bg-card shadow-sm">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-bold" style={badgeStyle(PRIORITY_COLORS[casualty.priority] ?? '#888')}>{casualty.priority}</span>
              <span className="text-lg font-bold text-foreground">{casualty.label}</span>
            </div>
            <div className="text-xs text-muted-foreground tracking-wide">
              {incidentTitle(report)} • {fmtDateTime(report.latest_transmission_at ?? report.created_at ?? report.timestamp)}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mt-4">
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3">
              <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground mb-2">ATMIST</h3>
              {atmist ? (
                <div className="space-y-1.5">
                  {Object.entries(ATMIST_FIELD_LABELS).map(([field, label]) => (
                    <div key={field} className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5">
                      <span className="font-semibold text-muted-foreground">{label}</span>
                      <span className="text-foreground break-words">{safeString(atmist[field]) || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">No ATMIST data recorded for this patient.</p>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground mb-2">ABCDE (LATEST)</h3>
              {hasClinicalFindings(latestAbcde) ? (
                <div className="space-y-1.5">
                  {(Object.keys(ABCDE_LABELS) as AbcdeKey[]).map((key) => (
                    <div key={key} className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5">
                      <span className="font-semibold" style={{ color: '#1E90FF' }}>{key} — {ABCDE_LABELS[key]}</span>
                      <span className="text-foreground break-words">{latestAbcde[key] ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted-foreground">No clinical findings recorded yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground mb-2">CLINICAL TIMELINE</h3>
            {timeline.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No timestamped clinical updates recorded for this patient yet.</p>
            ) : (
              <div className="relative pl-6">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
                <div className="space-y-3">
                {timeline.map((entry, index) => (
                  <div key={entry.id} className="relative rounded-lg border border-border p-3 bg-card">
                    <span
                      className="absolute -left-[22px] top-4 h-3 w-3 rounded-full border-2 bg-background"
                      style={{ borderColor: entry.source === 'transfer' ? '#8B5CF6' : '#1E90FF' }}
                    />
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-[11px] font-bold" style={badgeStyle(entry.source === 'transfer' ? '#8B5CF6' : '#1E90FF')}>
                        {entry.source === 'transfer' ? 'TRANSFER' : `UPDATE #${index + 1}`}
                      </span>
                      <span className="text-[11px] text-muted-foreground tracking-wide">{fmtDateTime(entry.timestamp)}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-foreground mb-1.5 leading-5">{entry.headline}</p>

                    {hasClinicalFindings(entry.clinicalFindings) && (
                      <div className="space-y-1 mb-1.5">
                        {(Object.keys(ABCDE_LABELS) as AbcdeKey[]).map((key) => (
                          <div key={key} className="grid grid-cols-[18px_minmax(0,1fr)] gap-1.5 text-[12px] leading-4.5">
                            <span className="font-bold" style={{ color: '#1E90FF' }}>{key}</span>
                            <span className="text-foreground break-words">{entry.clinicalFindings[key] ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {entry.atmist && (
                      <div className="text-[12px] text-foreground leading-4.5">
                        <span className="font-semibold text-muted-foreground">ATMIST snapshot:</span>{' '}
                        {[entry.atmist.A, entry.atmist.M, entry.atmist.I].map(safeString).filter(Boolean).join(' • ') || '—'}
                      </div>
                    )}

                    {entry.note && <p className="text-[12px] text-foreground mt-1.5 leading-4.5"><span className="font-semibold text-muted-foreground">Note:</span> {entry.note}</p>}
                    {entry.transcript && <p className="text-[12px] text-muted-foreground mt-1 italic leading-4.5">"{entry.transcript}"</p>}
                  </div>
                ))}
              </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground mb-2">OUTCOME</h3>
          {outcome ? (
            <div className="space-y-1.5 text-[13px]">
              <div className="text-foreground font-semibold">
                {DISPOSITION_LABELS[outcome.disposition as DispositionType] ?? outcome.disposition}
              </div>
              <div className="text-muted-foreground">Closed: {fmtDateTime(outcome.closed_at)}</div>
              {(outcome.fields as Record<string, unknown> | null)?.notes && (
                <div className="text-foreground">Notes: {safeString((outcome.fields as Record<string, unknown>).notes)}</div>
              )}
            </div>
          ) : transfer ? (
            <div className="space-y-1.5 text-[13px]">
              <div className="text-foreground font-semibold">
                Transfer {transfer.status}: {transfer.from_callsign} {'->'} {transfer.to_callsign}
              </div>
              <div className="text-muted-foreground">
                {transfer.accepted_at
                  ? `Accepted: ${fmtDateTime(transfer.accepted_at)}`
                  : `Initiated: ${fmtDateTime(transfer.initiated_at)}`}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Patient still open — no final outcome recorded.</p>
          )}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground">ePRF</h3>
            <CopyTextButton text={eprfText} />
          </div>
          <div className="rounded border border-border bg-card p-3">
            <pre className="text-[12px] text-foreground leading-5 whitespace-pre-wrap break-words font-mono">
              {eprfText}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OpsLogTab({ onSelectReport }: { onSelectReport?: (id: string) => void } = {}) {
  void onSelectReport;
  const { reports, transmissions, dispositions, transfers, loading, uniqueCallsigns, uniqueOperatorIds } = useOpsLog();
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [selectedPatientKey, setSelectedPatientKey] = useState<string | null>(null);
  const [filters, setFilters] = useState<OpsFilters>({
    search: '',
    service: '',
    station: '',
    dateFrom: '',
    dateTo: '',
    outcome: '',
    incidentType: '',
    callsign: '',
    operatorId: '',
    safeguarding: '',
  });

  const filtered = useMemo(
    () => applyFilters(reports, dispositions, filters),
    [reports, dispositions, filters],
  );

  const selectedReport = selectedIncident ? reports.find((r) => r.id === selectedIncident) ?? null : null;
  const casualties = useMemo(
    () => selectedReport ? buildCasualties(selectedReport, dispositions, transfers) : [],
    [selectedReport, dispositions, transfers],
  );
  const selectedCasualty = selectedPatientKey
    ? casualties.find((c) => c.key === selectedPatientKey) ?? null
    : null;

  const updateFilter = (key: keyof OpsFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const hasFilters = Boolean(
    filters.search
    || filters.dateFrom
    || filters.dateTo
    || filters.outcome
    || filters.incidentType
    || filters.callsign
    || filters.operatorId
    || filters.safeguarding,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-lg tracking-widest">
        LOADING INCIDENT LOG...
      </div>
    );
  }

  if (selectedReport && selectedCasualty) {
    const timeline = buildClinicalTimeline(
      selectedReport,
      transmissions,
      transfers,
      selectedCasualty,
      casualties.length,
    );

    return (
      <PatientDetailView
        report={selectedReport}
        casualty={selectedCasualty}
        timeline={timeline}
        totalCasualties={casualties.length}
        onBack={() => setSelectedPatientKey(null)}
      />
    );
  }

  if (selectedReport) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <button
            onClick={() => {
              setSelectedPatientKey(null);
              setSelectedIncident(null);
            }}
            className="flex items-center gap-1 text-sm text-primary bg-transparent cursor-pointer"
          >
            <ArrowLeft size={16} /> Back to incidents
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-lg font-bold text-foreground">{incidentTitle(selectedReport)}</p>
            <p className="text-sm text-muted-foreground">{getIncidentType(selectedReport)}</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
              <span>📍 {getLocation(selectedReport)}</span>
              <span>{fmtDateTime(selectedReport.latest_transmission_at ?? selectedReport.created_at ?? selectedReport.timestamp)}</span>
              {selectedReport.session_callsign && <span>🚑 {selectedReport.session_callsign}</span>}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold tracking-widest text-muted-foreground mb-2">
              PATIENTS ({casualties.length})
            </h3>
            {casualties.length === 0 ? (
              <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                No patients captured on this incident yet.
              </div>
            ) : (
              <div className="space-y-2">
                {casualties.map((casualty) => (
                  <PatientListCard
                    key={casualty.key}
                    casualty={casualty}
                    onOpen={() => setSelectedPatientKey(casualty.key)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 p-3 border-b border-border space-y-2">
        <div className="text-sm font-bold tracking-widest text-muted-foreground mb-1">
          INCIDENT LOG
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder="Search callsign, collar number, incident number, location..."
            style={{ ...inputStyle, paddingLeft: 36 }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filters.callsign}
            onChange={(event) => updateFilter('callsign', event.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All callsigns</option>
            {uniqueCallsigns.map((callsign) => (
              <option key={callsign} value={callsign}>{callsign}</option>
            ))}
          </select>

          <select
            value={filters.operatorId}
            onChange={(event) => updateFilter('operatorId', event.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All collar numbers</option>
            {uniqueOperatorIds.map((operatorId) => (
              <option key={operatorId} value={operatorId}>{operatorId}</option>
            ))}
          </select>

          <select
            value={filters.outcome}
            onChange={(event) => updateFilter('outcome', event.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All outcomes</option>
            <option value="conveyed">Conveyed</option>
            <option value="see_and_treat">Discharged</option>
            <option value="see_and_refer">Referred</option>
            <option value="refused_transport">Refused</option>
            <option value="role">ROLE</option>
            <option value="transferred">Transferred</option>
          </select>

          <select
            value={filters.incidentType}
            onChange={(event) => updateFilter('incidentType', event.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All types</option>
            {INCIDENT_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
            ))}
          </select>

          <select
            value={filters.safeguarding}
            onChange={(event) => updateFilter('safeguarding', event.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">Safeguarding</option>
            <option value="yes">Concern flagged</option>
            <option value="no">No concern</option>
          </select>

          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
            style={{ ...inputStyle, width: 'auto' }}
            title="From date"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
            style={{ ...inputStyle, width: 'auto' }}
            title="To date"
          />

          {hasFilters && (
            <button
              onClick={() => setFilters({ search: '', service: '', station: '', dateFrom: '', dateTo: '', outcome: '', incidentType: '', callsign: '', operatorId: '', safeguarding: '' })}
              className="px-3 py-1.5 text-sm rounded border cursor-pointer"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs text-muted-foreground tracking-widest mb-2">
          {filtered.length} INCIDENT{filtered.length !== 1 ? 'S' : ''}
        </div>

        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm tracking-widest">
            NO MATCHING INCIDENTS
          </div>
        ) : (
          filtered.map((report) => (
            <IncidentCard
              key={report.id}
              report={report}
              dispositions={dispositions}
              transfers={transfers}
              onClick={() => {
                setSelectedIncident(report.id);
                setSelectedPatientKey(null);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
