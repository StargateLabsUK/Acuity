import { useState, useCallback, useEffect } from 'react';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_LABELS, PRIORITY_COLORS } from '@/lib/herald-types';
import type { IncidentTransmission, ActionItem } from '@/lib/herald-types';
import { renderStructuredValue } from '@/components/StructuredValue';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeAssessment, formatActionAge } from '@/lib/sanitize-assessment';

interface Props {
  report: CommandReport | null;
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
      className="text-lg md:text-lg text-foreground border border-border px-3 py-1.5 rounded-sm bg-transparent cursor-pointer tracking-wide hover:border-primary transition-colors"
    >
      {copied ? 'COPIED' : label}
    </button>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      className="text-lg md:text-lg font-bold tracking-[0.2em] mb-2 md:mb-3"
      style={{ color: color ?? 'hsl(var(--foreground))' }}
    >
      {children}
    </div>
  );
}

function DetailCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-border rounded bg-card p-3 md:p-4 min-w-0 ${className}`}>
      {children}
    </div>
  );
}

function ResolvedSection({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-lg font-bold tracking-[0.15em] mb-2 bg-transparent border-none cursor-pointer"
        style={{ color: '#888' }}
      >
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
        RESOLVED ({items.length})
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded p-2.5 flex gap-3 items-start"
              style={{ background: 'rgba(136,136,136,0.06)', border: '1px solid rgba(136,136,136,0.15)' }}
            >
              <span className="text-lg flex-shrink-0" style={{ color: '#34C759' }}>✓</span>
              <div className="flex-1 min-w-0">
                <span className="text-lg text-foreground opacity-60 line-through break-words">{item.text}</span>
                {item.resolved_at && (
                  <span className="text-lg ml-2 opacity-40" style={{ color: '#888' }}>
                    resolved {formatActionAge(item.resolved_at).replace('open ', '')} ago
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportDetail({ report }: Props) {
  const [transmissions, setTransmissions] = useState<IncidentTransmission[]>([]);

  useEffect(() => {
    if (!report?.id) { setTransmissions([]); return; }
    supabase
      .from('incident_transmissions')
      .select('*')
      .eq('report_id', report.id)
      .order('timestamp', { ascending: true })
      .then(({ data }) => {
        setTransmissions((data as unknown as IncidentTransmission[]) ?? []);
      });
  }, [report?.id]);

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <span className="font-heading text-5xl text-foreground tracking-[0.08em]">
          HERALD
        </span>
        <span className="text-sm tracking-[0.2em] mt-2" style={{ color: '#4A6058' }}>
          Select a transmission
        </span>
      </div>
    );
  }

  const rawA = report.assessment;
  const a = rawA ? sanitizeAssessment(rawA) : null;
  const priority = a?.priority ?? report.priority ?? 'P3';
  const col = PRIORITY_COLORS[priority] ?? '#34C759';
  const service = a?.service ?? report.service ?? 'unknown';
  const serviceLabel = SERVICE_LABELS[service] ?? service.toUpperCase();
  const ts = new Date(report.created_at ?? report.timestamp);
  const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' +
    ts.getUTCMinutes().toString().padStart(2, '0') + ':' +
    ts.getUTCSeconds().toString().padStart(2, '0') + 'Z';
  const dateStr = ts.toISOString().slice(0, 10);

  const structured = a?.structured ?? {};
  const actions = a?.actions ?? [];
  const formattedReport = a?.formatted_report ?? '';
  const headline = a?.headline ?? report.headline ?? '';
  const priorityLabel = a?.priority_label ?? '';

  // New ePRF fields
  const incidentType = a?.incident_type ?? a?.protocol ?? 'Unknown';
  const majorIncident = a?.major_incident ?? false;
  const sceneLocation = a?.scene_location ?? structured['E'] ?? structured['Location'] ?? structured['grid'] ?? 'Not specified';
  const receivingHospital: string[] = a?.receiving_hospital ?? [];
  const clinicalFindings = a?.clinical_findings ?? null;
  const atmist = a?.atmist ?? null;
  const treatmentGiven: string[] = a?.treatment_given ?? [];
  const actionItems: string[] = a?.action_items ?? [];
  const resolvedActionItems: ActionItem[] = (a as any)?.resolved_action_items ?? [];
  const clinicalHistory = a?.clinical_history ?? '';

  // Build ePRF text
  const abcdeText = clinicalFindings
    ? `A (Airway): ${clinicalFindings.A ?? 'Not assessed'}\nB (Breathing): ${clinicalFindings.B ?? 'Not assessed'}\nC (Circulation): ${clinicalFindings.C ?? 'Not assessed'}\nD (Disability): ${clinicalFindings.D ?? 'Not assessed'}\nE (Exposure): ${clinicalFindings.E ?? 'Not assessed'}`
    : Object.entries(structured).map(([k, v]) => `${k}: ${renderStructuredValue(v)}`).join('\n');

  const atmistText = atmist
    ? Object.entries(atmist).map(([key, val]: [string, any]) =>
        `${key}:\n  A: ${val?.A ?? '—'}\n  T: ${val?.T ?? '—'}\n  M: ${val?.M ?? '—'}\n  I: ${val?.I ?? '—'}\n  S: ${val?.S ?? '—'}\n  T (Treatment): ${val?.T_treatment ?? '—'}`
      ).join('\n')
    : '';

  const eprfText = `INCIDENT NUMBER: ${structured.incident_number ?? '—'}
INCIDENT DATE/TIME: ${dateStr} ${timeStr}
INCIDENT TYPE: ${incidentType}${majorIncident ? ' [MAJOR INCIDENT]' : ''}
SCENE LOCATION: ${sceneLocation}
RECEIVING HOSPITAL: ${receivingHospital.length > 0 ? receivingHospital.join(', ') : 'Not specified'}
PRIORITY: ${priority} ${priorityLabel}
CALLSIGN: ${structured.callsign ?? '—'}
OPERATOR ID: ${structured.operator_id ?? '—'}
CHIEF COMPLAINT: ${headline}
HISTORY: ${clinicalHistory || 'N/A'}
CLINICAL FINDINGS (ABCDE):
${abcdeText}
TREATMENT GIVEN: ${treatmentGiven.length > 0 ? treatmentGiven.join('; ') : 'None recorded'}
${atmistText ? `ATMIST:\n${atmistText}` : ''}
${actionItems.length > 0 ? `ACTION ITEMS:\n${actionItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}` : ''}
CREW NOTES: Generated by Herald Radio Intelligence`;

  return (
    <div className="overflow-y-auto p-3 md:p-5 flex flex-col gap-4 md:gap-6 min-w-0" style={{ scrollbarWidth: 'thin' }}>
      {/* Priority Banner */}
      <div
        className="rounded p-2.5 md:p-4"
        style={{
          background: `${col}1F`,
          borderBottom: `3px solid ${col}`,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-lg uppercase font-bold tracking-[0.15em]" style={{ color: '#FFFFFF' }}>{serviceLabel}</div>
              {majorIncident && (
                <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
                  style={{ color: '#FF3B30', border: '1px solid rgba(255,59,48,0.4)', background: 'rgba(255,59,48,0.12)' }}>
                  MAJOR INCIDENT
                </span>
              )}
              {(report as any).status === 'closed' ? (
                <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
                  style={{ color: '#888', border: '1px solid rgba(136,136,136,0.3)', background: 'rgba(136,136,136,0.08)' }}>
                  CLOSED
                </span>
              ) : (report as any).status === 'active' && report.incident_number ? (
                <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
                  style={{ color: '#FF9500', border: '1px solid rgba(255,149,0,0.3)', background: 'rgba(255,149,0,0.08)' }}>
                  ACTIVE
                </span>
              ) : null}
            </div>
            <div className="flex items-baseline gap-1.5 md:gap-3">
              <span className="font-heading text-2xl md:text-5xl leading-none" style={{ color: col }}>
                {priority}
              </span>
              <span className="font-heading text-lg md:text-[28px] tracking-wide" style={{ color: col }}>
                {priorityLabel}
              </span>
            </div>
            {incidentType && incidentType !== 'Unknown' && (
              <div className="text-lg font-bold mt-1 tracking-wide" style={{ color: col }}>{incidentType}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-lg md:text-lg text-foreground">{dateStr}</div>
            <div className="h-px my-1" style={{ background: 'hsl(var(--border))' }} />
            <div className="text-lg md:text-lg text-foreground">{timeStr}</div>
          </div>
        </div>
      </div>

      {/* Action Items — prominent warnings */}
      {actionItems.length > 0 && (
        <div>
          <SectionLabel color="#FF9500">⚠ ACTION ITEMS</SectionLabel>
          <div className="flex flex-col gap-2">
            {actionItems.map((item, i) => {
              const itemObj = typeof item === 'object' ? (item as any) : null;
              const text = itemObj?.text || item;
              const openedAt = itemObj?.opened_at || report.created_at || report.timestamp;
              return (
                <div
                  key={i}
                  className="rounded p-3 flex gap-3 items-start"
                  style={{
                    background: 'rgba(255,149,0,0.08)',
                    border: '1px solid rgba(255,149,0,0.3)',
                  }}
                >
                  <span className="text-lg font-bold flex-shrink-0" style={{ color: '#FF9500' }}>⚠</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-lg text-foreground font-medium leading-relaxed break-words">{text}</span>
                    <span className="text-lg ml-2 opacity-60" style={{ color: '#FF9500' }}>
                      — {formatActionAge(openedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resolved Action Items — collapsed */}
      {resolvedActionItems.length > 0 && (
        <ResolvedSection items={resolvedActionItems} />
      )}

      {/* Headline */}
      <DetailCard>
        <p className="text-lg md:text-xl text-foreground leading-relaxed font-medium break-words">{headline}</p>
      </DetailCard>

      {/* Location Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <SectionLabel color={col}>SCENE LOCATION</SectionLabel>
          <DetailCard>
            <p className="text-lg text-foreground break-words">{sceneLocation}</p>
          </DetailCard>
        </div>
        <div>
          <SectionLabel color={col}>RECEIVING HOSPITAL</SectionLabel>
          <DetailCard>
            {receivingHospital.length > 0 ? (
              receivingHospital.map((h, i) => (
                <p key={i} className="text-lg text-foreground break-words">{h}</p>
              ))
            ) : (
              <p className="text-lg text-foreground opacity-50">Not specified</p>
            )}
          </DetailCard>
        </div>
      </div>

      {/* Clinical History */}
      {clinicalHistory && (
        <div>
          <SectionLabel color={col}>CLINICAL HISTORY</SectionLabel>
          <DetailCard>
            <p className="text-lg md:text-lg text-foreground leading-7 md:leading-7 break-words">
              {clinicalHistory}
            </p>
          </DetailCard>
        </div>
      )}

      {/* Full Transcript */}
      <div>
        <SectionLabel>FULL TRANSCRIPT</SectionLabel>
        <DetailCard>
          <p className="text-lg md:text-lg text-foreground leading-7 md:leading-7 italic break-words">
            &ldquo;{report.transcript ?? 'N/A'}&rdquo;
          </p>
        </DetailCard>
      </div>

      {/* Clinical Findings (ABCDE) */}
      {clinicalFindings && (
        <div>
          <SectionLabel color={col}>CLINICAL FINDINGS — ABCDE</SectionLabel>
          <DetailCard>
            <div className="flex flex-col gap-2.5">
              {(['A', 'B', 'C', 'D', 'E'] as const).map((letter) => {
                const labels: Record<string, string> = { A: 'Airway', B: 'Breathing', C: 'Circulation', D: 'Disability', E: 'Exposure' };
                const val = clinicalFindings[letter] ?? 'Not assessed';
                return (
                  <div key={letter}>
                    <div className="text-lg font-bold tracking-wide mb-0.5" style={{ color: col }}>
                      {letter} — {labels[letter]}
                    </div>
                    <div className="text-lg text-foreground leading-relaxed break-words">{val}</div>
                  </div>
                );
              })}
            </div>
          </DetailCard>
        </div>
      )}

      {/* ATMIST per casualty */}
      {atmist && Object.keys(atmist).length > 0 && (
        <div>
          <SectionLabel color="#1E90FF">ATMIST</SectionLabel>
          <div className="flex flex-col gap-3">
            {Object.entries(atmist).map(([casualtyKey, val]: [string, any]) => {
              const cCol = PRIORITY_COLORS[casualtyKey] ?? '#1E90FF';
              return (
                <DetailCard key={casualtyKey}>
                  <div className="text-lg font-bold mb-2 tracking-wide" style={{ color: cCol }}>{casualtyKey}</div>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { k: 'A', label: 'Age' },
                      { k: 'T', label: 'Time of injury' },
                      { k: 'M', label: 'Mechanism' },
                      { k: 'I', label: 'Injuries' },
                      { k: 'S', label: 'Signs/vitals' },
                      { k: 'T_treatment', label: 'Treatment' },
                    ].map(({ k, label }) => (
                      <div key={k}>
                        <span className="text-lg font-bold" style={{ color: cCol }}>{label}: </span>
                        <span className="text-lg text-foreground break-words">{val?.[k] ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </DetailCard>
              );
            })}
          </div>
        </div>
      )}

      {/* Treatment Given */}
      {treatmentGiven.length > 0 && (
        <div>
          <SectionLabel color={col}>TREATMENT GIVEN</SectionLabel>
          <DetailCard>
            <div className="flex flex-col gap-1.5">
              {treatmentGiven.map((t, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-lg font-bold min-w-[20px]" style={{ color: col }}>{i + 1}.</span>
                  <span className="text-lg text-foreground leading-relaxed break-words">{t}</span>
                </div>
              ))}
            </div>
          </DetailCard>
        </div>
      )}

      {/* Protocol Fields */}
      <div>
        <SectionLabel color={col}>PROTOCOL FIELDS</SectionLabel>
        <DetailCard>
          <div className="flex flex-col gap-2.5 md:gap-4">
            {Object.entries(structured).map(([k, v]) => {
              const isEmpty = !v || v === 'null';
              const isIncNum = k === 'incident_number';
              const isOpId = k === 'operator_id';
              return (
                <div key={k}>
                  <div className="text-lg md:text-lg font-bold tracking-wide mb-0.5" style={{ color: col }}>{k}</div>
                  {isEmpty && (isIncNum || isOpId) ? (
                    <div className="text-lg md:text-lg py-1 px-2 rounded" style={{ color: '#FF9500', background: 'rgba(255,149,0,0.06)', border: '1px dashed rgba(255,149,0,0.3)' }}>
                      {isIncNum ? 'Awaiting incident number — say or tap to enter' : 'Awaiting operator ID — tap to enter'}
                    </div>
                  ) : (
                    <div className="text-lg md:text-lg text-foreground leading-relaxed break-words whitespace-pre-wrap">{renderStructuredValue(v)}</div>
                  )}
                </div>
              );
            })}
            {Object.keys(structured).length === 0 && (
              <span className="text-lg md:text-lg text-foreground opacity-50">No structured fields</span>
            )}
          </div>
        </DetailCard>
      </div>

      {/* Immediate Actions */}
      {actions.length > 0 && (
        <div>
          <SectionLabel color={col}>IMMEDIATE ACTIONS</SectionLabel>
          <DetailCard>
            <div className="flex flex-col gap-2">
              {actions.map((act, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-lg md:text-lg font-bold min-w-[20px]" style={{ color: col }}>{i + 1}.</span>
                  <span className="text-lg md:text-lg text-foreground leading-relaxed break-words">{act}</span>
                </div>
              ))}
            </div>
          </DetailCard>
        </div>
      )}

      {/* Session Info */}
      {(report.session_callsign || report.session_operator_id || report.session_service || report.session_station) && (
        <DetailCard>
          <SectionLabel color="hsl(var(--primary))">SESSION INFO</SectionLabel>
          <div className="flex flex-col gap-1" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#4A6058', fontSize: 18 }}>
            {report.session_callsign && (
              <div><span className="font-bold">UNIT:</span> {report.session_callsign}</div>
            )}
            {report.session_operator_id && (
              <div><span className="font-bold">OFFICER:</span> {report.session_operator_id}</div>
            )}
            {report.session_service && (
              <div><span className="font-bold">SERVICE:</span> {report.session_service}</div>
            )}
            {report.session_station && (
              <div><span className="font-bold">STATION:</span> {report.session_station}</div>
            )}
          </div>
        </DetailCard>
      )}

      {/* Formatted Report */}
      <div>
        <div className="flex items-center justify-between mb-2 md:mb-3">
          <SectionLabel>FORMATTED REPORT</SectionLabel>
          <CopyBtn text={formattedReport} label="COPY" />
        </div>
        <DetailCard>
          <div className="text-lg md:text-lg text-foreground leading-7 md:leading-8 whitespace-pre-wrap break-words">
            {formattedReport || 'No formatted report available'}
          </div>
        </DetailCard>
      </div>

      {/* ePRF Export */}
      <div>
        <div className="flex items-center justify-between mb-2 md:mb-3">
          <SectionLabel color="hsl(var(--primary))">ePRF READY</SectionLabel>
          <CopyBtn text={eprfText} label="COPY ePRF" />
        </div>
        <DetailCard>
          <div className="text-lg md:text-lg text-foreground leading-7 md:leading-7 whitespace-pre-wrap break-words">
            {eprfText}
          </div>
        </DetailCard>
      </div>

      {/* Transmission Log */}
      {transmissions.length > 1 && (
        <div>
          <SectionLabel color="#1E90FF">TRANSMISSION LOG ({transmissions.length})</SectionLabel>
          <div className="flex flex-col gap-2">
            {transmissions.map((tx, i) => {
              const txTime = new Date(tx.timestamp);
              const txTimeStr = txTime.getUTCHours().toString().padStart(2, '0') + ':' +
                txTime.getUTCMinutes().toString().padStart(2, '0') + ':' +
                txTime.getUTCSeconds().toString().padStart(2, '0') + 'Z';
              const txPriority = tx.priority ?? 'P3';
              const txCol = PRIORITY_COLORS[txPriority] ?? '#34C759';
              const txAssessment = tx.assessment as unknown as Record<string, any> | null;
              const txStructured = txAssessment?.structured as Record<string, string> | undefined;
              return (
                <DetailCard key={tx.id}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>#{i + 1}</span>
                    <span className="text-lg font-bold rounded-sm px-1.5 py-0.5" style={{ color: txCol, border: `1px solid ${txCol}66` }}>{txPriority}</span>
                    <span className="text-lg text-foreground">{txTimeStr}</span>
                    {tx.session_callsign && (
                      <span className="text-lg font-semibold" style={{ color: '#3DFF8C' }}>{tx.session_callsign}</span>
                    )}
                  </div>
                  {tx.headline && (
                    <p className="text-lg text-foreground font-medium mb-1 break-words">{tx.headline}</p>
                  )}
                  {tx.transcript && (
                    <p className="text-lg text-foreground italic opacity-80 break-words mb-2">&ldquo;{tx.transcript}&rdquo;</p>
                  )}
                  {txStructured && Object.keys(txStructured).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="flex flex-col gap-1.5">
                         {Object.entries(txStructured).map(([k, v]) => (
                          <div key={k}>
                            <span className="text-lg font-bold" style={{ color: txCol }}>{k}: </span>
                            <span className="text-lg text-foreground whitespace-pre-wrap">{renderStructuredValue(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </DetailCard>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
