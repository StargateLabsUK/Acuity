import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { HeraldReport } from '@/lib/herald-types';
import { PRIORITY_COLORS, SERVICE_LABELS } from '@/lib/herald-types';
import { renderStructuredValue } from '@/components/StructuredValue';
import type { HeraldSession } from '@/lib/herald-session';
import { sanitizeAssessment } from '@/lib/sanitize-assessment';
import { getVehicleLabel } from '@/lib/vehicle-types';

interface ReportsTabProps {
  reports: HeraldReport[];
  session?: HeraldSession;
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={copy}
      className="text-lg md:text-lg text-foreground border border-border px-3 py-1 rounded-sm bg-transparent cursor-pointer tracking-wide hover:border-primary transition-colors"
    >
      {copied ? 'COPIED' : label}
    </button>
  );
}

export function ReportsTab({ reports, session }: ReportsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (reports.length === 0 && session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <span className="text-lg uppercase font-bold mb-4" style={{ color: '#4A6058' }}>{SERVICE_LABELS[session.service] ?? session.service}</span>
        <p style={{ color: '#1E3028', fontSize: 18, letterSpacing: '0.2em', marginBottom: 8 }}>
          NO REPORTS THIS SHIFT
        </p>
        <p style={{ color: '#1E3028', fontSize: 18 }}>
          {session.callsign} · {session.session_date}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-3 md:px-4 py-3">
      <p className="text-lg md:text-lg text-foreground tracking-[0.1em] mb-3 font-bold">
        CONFIRMED TRANSMISSIONS
      </p>

      {reports.length === 0 && (
        <p className="text-center mt-12 text-lg md:text-lg text-foreground opacity-50">
          No confirmed reports yet
        </p>
      )}

      {reports.map((r) => {
        const rawA = r.assessment as unknown as Record<string, unknown> | null;
        const a = rawA ? sanitizeAssessment(rawA as any) as unknown as Record<string, unknown> : null;
        const pc = PRIORITY_COLORS[a?.priority as string] || PRIORITY_COLORS[r.priority as string] || 'hsl(var(--foreground))';
        const vtCode = (r as any).vehicle_type || session?.vehicle_type;
        const vtLabel = getVehicleLabel(vtCode);
        const headerLabel = vtLabel && r.session_callsign
          ? `${vtLabel} — ${r.session_callsign}`
          : vtLabel || SERVICE_LABELS[a?.service as string] || SERVICE_LABELS[r.service as string] || 'UNKNOWN';
        const serviceLabel = SERVICE_LABELS[a?.service as string] || SERVICE_LABELS[r.service as string] || 'UNKNOWN';
        const expanded = expandedId === r.id;
        const structured = (a?.structured as Record<string, string>) ?? {};
        const actions = (a?.actions as string[]) ?? [];
        const priorityLabel = (a?.priority_label as string) ?? '';
        const actionItems = (a?.action_items as string[]) ?? [];
        const atmist = (a?.atmist as Record<string, any>) ?? null;
        const clinicalFindings = (a?.clinical_findings as Record<string, string>) ?? null;

        return (
          <div
            key={r.id}
            className="mb-3 rounded-lg border border-border bg-card shadow-sm overflow-hidden"
          >
            <button
              onClick={() => setExpandedId(expanded ? null : r.id)}
              className="w-full text-left p-3"
            >
              <div className="flex items-center gap-2 md:gap-3">
                {expanded ? (
                  <ChevronDown size={18} className="text-foreground opacity-50 flex-shrink-0" />
                ) : (
                  <ChevronRight size={18} className="text-foreground opacity-50 flex-shrink-0" />
                )}
                <span className="text-lg uppercase font-bold" style={{ color: '#4A6058' }}>{headerLabel}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-lg md:text-lg text-foreground">
                    {(a?.headline as string) || r.headline || 'Report'}
                  </p>
                  <p className="text-lg md:text-lg text-foreground opacity-70">
                    {new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19)}Z
                  </p>
                </div>
                <span
                  className="font-heading px-1.5 md:px-2 py-0.5 text-lg md:text-lg font-bold rounded-sm"
                  style={{
                    color: pc,
                    border: `1px solid ${pc}`,
                  }}
                >
                  {(a?.priority as string) || r.priority}
                </span>
              </div>
            </button>

            {expanded && a && (
              <div className="px-3 pb-4 border-t border-border">
                {/* Priority Banner */}
                <div
                  className="flex items-center justify-between mt-3 px-3 md:px-4 py-3 md:py-4 rounded"
                  style={{
                    background: `${pc}1F`,
                    borderBottom: `3px solid ${pc}`,
                  }}
                >
                  <div className="flex items-baseline gap-2 md:gap-3">
                    <span className="text-lg uppercase font-bold" style={{ color: '#4A6058' }}>{headerLabel}</span>
                    <span className="font-heading text-3xl md:text-5xl leading-none" style={{ color: pc }}>
                      {a.priority as string}
                    </span>
                    <span className="font-heading text-lg md:text-[28px]" style={{ color: pc }}>
                      {priorityLabel}
                    </span>
                  </div>
                  <span className="text-lg md:text-xl text-foreground uppercase font-bold">
                    {a.service as string}
                  </span>
                </div>

                {/* Headline */}
                <div className="mt-4 p-3 md:p-4 border border-border rounded bg-card">
                  <p className="text-lg md:text-xl text-foreground leading-relaxed font-medium">{a.headline as string}</p>
                </div>

                {/* Action Items */}
                {actionItems.length > 0 && (
                  <div className="mt-4">
                    <p className="text-lg md:text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#FF9500' }}>
                      ⚠ ACTION ITEMS
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {actionItems.map((item, i) => (
                        <div key={i} className="rounded p-2.5 flex gap-2 items-start"
                          style={{ background: 'rgba(255,149,0,0.06)', border: '1px solid rgba(255,149,0,0.2)' }}>
                          <span className="text-lg font-bold flex-shrink-0" style={{ color: '#FF9500' }}>⚠</span>
                          <span className="text-lg text-foreground font-medium">{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ATMIST cards */}
                {atmist && Object.keys(atmist).length > 0 && (
                  <div className="mt-4">
                    <p className="text-lg md:text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>
                      ATMIST
                    </p>
                    <div className="flex flex-col gap-2">
                      {Object.entries(atmist).map(([casualtyKey, val]: [string, any]) => {
                        const cCol = PRIORITY_COLORS[casualtyKey] ?? '#1E90FF';
                        return (
                          <div key={casualtyKey} className="p-3 border border-border rounded bg-card">
                            <div className="text-lg font-bold mb-1 tracking-wide" style={{ color: cCol }}>{casualtyKey}</div>
                            <div className="flex flex-col gap-1">
                              {[
                                { k: 'A', label: 'Age' }, { k: 'T', label: 'Time' }, { k: 'M', label: 'Mechanism' },
                                { k: 'I', label: 'Injuries' }, { k: 'S', label: 'Signs' }, { k: 'T_treatment', label: 'Treatment' },
                              ].map(({ k, label }) => (
                                <div key={k}>
                                  <span className="text-lg font-bold" style={{ color: cCol }}>{label}: </span>
                                  <span className="text-lg text-foreground break-words">{val?.[k] ?? '—'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Clinical Findings (ABCDE) */}
                {clinicalFindings && Object.keys(clinicalFindings).length > 0 && (
                  <div className="mt-4">
                    <p className="text-lg md:text-lg font-bold tracking-[0.2em] mb-2" style={{ color: pc }}>
                      CLINICAL FINDINGS — ABCDE
                    </p>
                    <div className="p-3 border border-border rounded bg-card">
                      <div className="flex flex-col gap-2">
                        {(['A', 'B', 'C', 'D', 'E'] as const).map((letter) => {
                          const labels: Record<string, string> = { A: 'Airway', B: 'Breathing', C: 'Circulation', D: 'Disability', E: 'Exposure' };
                          const val = clinicalFindings[letter] ?? 'Not assessed';
                          return (
                            <div key={letter}>
                              <span className="text-lg font-bold" style={{ color: pc }}>{letter} — {labels[letter]}: </span>
                              <span className="text-lg text-foreground break-words">{val}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Protocol Fields with empty prompts */}
                {Object.keys(structured).length > 0 && (
                  <div className="mt-4">
                    <p className="text-lg md:text-lg font-bold tracking-[0.2em] mb-2" style={{ color: pc }}>
                      PROTOCOL FIELDS
                    </p>
                    <div className="p-3 md:p-4 border border-border rounded bg-card">
                      <div className="flex flex-col gap-2 md:gap-3">
                        {Object.entries(structured).map(([k, v]) => {
                          const isEmpty = !v || v === 'null';
                          const isIncNum = k === 'incident_number';
                          const isOpId = k === 'operator_id';
                          return (
                            <div key={k}>
                              <div className="text-lg md:text-lg font-bold mb-0.5" style={{ color: pc }}>{k}</div>
                              {isEmpty && (isIncNum || isOpId) ? (
                                <div className="text-lg" style={{ color: '#FF9500', opacity: 0.7 }}>
                                  {isIncNum ? 'Awaiting incident number — say or tap to enter' : 'Awaiting operator ID — tap to enter'}
                                </div>
                              ) : (
                                <div className="text-lg md:text-lg text-foreground leading-relaxed whitespace-pre-wrap">{renderStructuredValue(v)}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
