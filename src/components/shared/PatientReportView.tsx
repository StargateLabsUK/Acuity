import { useState, type CSSProperties, type ReactNode } from 'react';
import { PRIORITY_COLORS } from '@/lib/herald-types';

export type AbcdeKey = 'A' | 'B' | 'C' | 'D' | 'E';
export type ClinicalFindings = Partial<Record<AbcdeKey, string>>;

export interface PatientTimelineEntry {
  id: string;
  timestamp: string;
  source: 'transmission' | 'transfer';
  headline: string;
  transcript?: string | null;
  note?: string | null;
  atmist: Record<string, unknown> | null;
  clinicalFindings: ClinicalFindings;
}

const ATMIST_FIELD_LABELS: Record<string, string> = {
  A: 'Age / Sex',
  T: 'Time of Injury',
  M: 'Mechanism',
  I: 'Injuries',
  status: 'Status',
  S: 'Signs / Vitals',
  downtime: 'Downtime',
  T_treatment: 'Treatment Given',
};

const ABCDE_LABELS: Record<AbcdeKey, string> = {
  A: 'Airway',
  B: 'Breathing',
  C: 'Circulation',
  D: 'Disability',
  E: 'Exposure',
};

function formatDateTime(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  const date = timestamp.toISOString().slice(0, 10);
  const hours = timestamp.getUTCHours().toString().padStart(2, '0');
  const minutes = timestamp.getUTCMinutes().toString().padStart(2, '0');
  return `${date} ${hours}:${minutes}Z`;
}

function badgeStyle(color: string): CSSProperties {
  return {
    color,
    border: `1px solid ${color}44`,
    background: `${color}12`,
    fontSize: 13,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  };
}

export function safeReportString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function hasClinicalFindings(findings: ClinicalFindings): boolean {
  return (['A', 'B', 'C', 'D', 'E'] as AbcdeKey[]).some((key) => {
    const text = safeReportString(findings[key]).trim();
    if (!text) return false;
    return !['not assessed', 'unknown', 'n/a', '—'].includes(text.toLowerCase());
  });
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

interface PatientReportViewProps {
  incidentTitle: string;
  incidentDateTime: string;
  casualtyLabel: string;
  casualtyPriority: string;
  atmist: Record<string, unknown> | null;
  latestAbcde: ClinicalFindings;
  timeline: PatientTimelineEntry[];
  outcomeLines: string[];
  eprfText: string;
  atmistFieldRenderer?: (field: string, value: string) => ReactNode;
}

export function PatientReportView({
  incidentTitle,
  incidentDateTime,
  casualtyLabel,
  casualtyPriority,
  atmist,
  latestAbcde,
  timeline,
  outcomeLines,
  eprfText,
  atmistFieldRenderer,
}: PatientReportViewProps) {
  return (
    <div className="mt-4">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 border-b border-border bg-background/95 backdrop-blur">
        <div className="rounded-lg p-3 border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-bold" style={badgeStyle(PRIORITY_COLORS[casualtyPriority] ?? '#888')}>
              {casualtyPriority}
            </span>
            <span className="text-lg font-bold text-foreground">{casualtyLabel}</span>
          </div>
          <div className="text-xs text-muted-foreground tracking-wide">
            {incidentTitle} • {incidentDateTime}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] mt-4">
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-3">
            <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground mb-2">ATMIST</h3>
            {atmist ? (
              <div className="space-y-1.5">
                {Object.entries(ATMIST_FIELD_LABELS).map(([field, label]) => {
                  const rawValue = safeReportString(atmist[field]) || '';
                  return (
                    <div key={field} className="grid grid-cols-[130px_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5">
                      <span className="font-semibold text-muted-foreground">{label}</span>
                      {atmistFieldRenderer
                        ? atmistFieldRenderer(field, rawValue)
                        : <span className="text-foreground break-words">{rawValue || '—'}</span>}
                    </div>
                  );
                })}
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
                      <span className="text-[11px] text-muted-foreground tracking-wide">{formatDateTime(entry.timestamp)}</span>
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
                        {[entry.atmist.A, entry.atmist.M, entry.atmist.I].map(safeReportString).filter(Boolean).join(' • ') || '—'}
                      </div>
                    )}

                    {entry.note && (
                      <p className="text-[12px] text-foreground mt-1.5 leading-4.5">
                        <span className="font-semibold text-muted-foreground">Note:</span> {entry.note}
                      </p>
                    )}
                    {entry.transcript && (
                      <p className="text-[12px] text-muted-foreground mt-1 italic leading-4.5">"{entry.transcript}"</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 mt-4">
        <h3 className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground mb-2">OUTCOME</h3>
        <div className="space-y-1.5 text-[13px]">
          {outcomeLines.map((line, index) => (
            <div key={`${line}-${index}`} className={index === 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 mt-4">
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
  );
}
