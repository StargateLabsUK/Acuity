import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { HeraldReport } from '@/lib/herald-types';
import { PRIORITY_COLORS, SERVICE_LABELS } from '@/lib/herald-types';
import { renderStructuredValue } from '@/components/StructuredValue';
import type { HeraldSession } from '@/lib/herald-session';
import { sanitizeAssessment } from '@/lib/sanitize-assessment';

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
        const serviceLabel = SERVICE_LABELS[a?.service as string] || SERVICE_LABELS[r.service as string] || 'UNKNOWN';
        const expanded = expandedId === r.id;
        const structured = (a?.structured as Record<string, string>) ?? {};
        const actions = (a?.actions as string[]) ?? [];
        const priorityLabel = (a?.priority_label as string) ?? '';
        const actionItems = (a?.action_items as string[]) ?? [];
        const atmist = (a?.atmist as Record<string, any>) ?? null;

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
                <span className="text-lg uppercase font-bold" style={{ color: '#4A6058' }}>{serviceLabel}</span>
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
                    <span className="text-lg uppercase font-bold" style={{ color: '#4A6058' }}>{serviceLabel}</span>
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

                {/* Full Transcript */}
                <div className="mt-4">
                  <p className="text-lg md:text-lg font-bold text-foreground tracking-[0.2em] mb-2">
                    FULL TRANSCRIPT
                  </p>
                  <div className="p-3 md:p-4 border border-border rounded bg-card">
                    <p className="text-lg md:text-lg text-foreground leading-7 italic">
                      &ldquo;{r.transcript ?? 'N/A'}&rdquo;
                    </p>
                    <div className="text-lg md:text-lg text-foreground mt-2 opacity-70">
                      CONFIDENCE: {Math.round(confidence * 100)}%
                    </div>
                  </div>
                </div>

                {/* Protocol Fields & Actions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {Object.keys(structured).length > 0 && (
                    <div>
                      <p className="text-lg md:text-lg font-bold tracking-[0.2em] mb-2" style={{ color: pc }}>
                        PROTOCOL FIELDS
                      </p>
                      <div className="p-3 md:p-4 border border-border rounded bg-card">
                        <div className="flex flex-col gap-2 md:gap-3">
                          {Object.entries(structured).map(([k, v]) => (
                            <div key={k}>
                              <div className="text-lg md:text-lg font-bold mb-0.5" style={{ color: pc }}>{k}</div>
                              <div className="text-lg md:text-lg text-foreground leading-relaxed whitespace-pre-wrap">{renderStructuredValue(v)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {actions.length > 0 && (
                    <div>
                      <p className="text-lg md:text-lg font-bold tracking-[0.2em] mb-2" style={{ color: pc }}>
                        IMMEDIATE ACTIONS
                      </p>
                      <div className="p-3 md:p-4 border border-border rounded bg-card">
                        <div className="flex flex-col gap-1.5 md:gap-2">
                          {actions.map((action, i) => (
                            <div key={i} className="flex gap-2 md:gap-3">
                              <span className="text-lg md:text-lg font-bold min-w-[20px]" style={{ color: pc }}>{i + 1}.</span>
                              <span className="text-lg md:text-lg text-foreground leading-relaxed">{action}</span>
                            </div>
                          ))}
                        </div>
                        {transmitTo && (
                          <>
                            <div className="border-t border-border my-3" />
                            <div className="text-lg md:text-lg text-foreground">
                              <span className="font-bold" style={{ color: pc }}>TRANSMIT TO:</span> {transmitTo}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Formatted Report */}
                {formattedReport && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-lg md:text-lg font-bold text-foreground tracking-[0.2em]">
                        FORMATTED REPORT
                      </p>
                      <CopyBtn text={formattedReport} label="COPY" />
                    </div>
                    <div className="p-3 md:p-4 border border-border rounded bg-card">
                      <div className="text-lg md:text-lg text-foreground leading-7 whitespace-pre-wrap">
                        {formattedReport}
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
