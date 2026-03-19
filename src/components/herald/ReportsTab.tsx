import { useState, useCallback } from 'react';
import type { HeraldReport } from '@/lib/herald-types';
import { PRIORITY_COLORS, SERVICE_EMOJIS } from '@/lib/herald-types';

interface ReportsTabProps {
  reports: HeraldReport[];
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
      style={{
        fontSize: 18,
        color: '#FFFFFF',
        border: '1px solid #0F1820',
        padding: '6px 14px',
        borderRadius: 2,
        background: 'transparent',
        cursor: 'pointer',
        letterSpacing: '0.05em',
      }}
    >
      {copied ? 'COPIED' : label}
    </button>
  );
}

export function ReportsTab({ reports }: ReportsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex-1 overflow-auto px-4 py-3">
      <p style={{ fontSize: 18, color: '#FFFFFF', letterSpacing: '0.1em', marginBottom: 12 }}>
        CONFIRMED TRANSMISSIONS
      </p>

      {reports.length === 0 && (
        <p className="text-center mt-12" style={{ fontSize: 18, color: '#FFFFFF' }}>
          No confirmed reports yet
        </p>
      )}

      {reports.map((r) => {
        const a = r.assessment as unknown as Record<string, unknown> | null;
        const pc = PRIORITY_COLORS[a?.priority as string] || PRIORITY_COLORS[r.priority as string] || '#FFFFFF';
        const emoji = SERVICE_EMOJIS[a?.service as string] || SERVICE_EMOJIS[r.service as string] || '📻';
        const expanded = expandedId === r.id;
        const structured = (a?.structured as Record<string, string>) ?? {};
        const actions = (a?.actions as string[]) ?? [];
        const formattedReport = (a?.formatted_report as string) ?? '';
        const priorityLabel = (a?.priority_label as string) ?? '';
        const transmitTo = (a?.transmit_to as string) ?? '';
        const confidence = (a?.confidence as number) ?? 0;

        return (
          <div
            key={r.id}
            className="mb-2"
            style={{ border: '1px solid #0F1820', borderRadius: 4 }}
          >
            <button
              onClick={() => setExpandedId(expanded ? null : r.id)}
              className="w-full text-left p-3"
            >
              <div className="flex items-center gap-3">
                <span style={{ fontSize: 20 }}>{emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontSize: 18, color: '#FFFFFF' }}>
                    {(a?.headline as string) || r.headline || 'Report'}
                  </p>
                  <p style={{ fontSize: 18, color: '#FFFFFF' }}>
                    {new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19)}Z
                  </p>
                </div>
                <span
                  className="font-heading px-2 py-0.5"
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: pc,
                    border: `1px solid ${pc}`,
                    borderRadius: 2,
                  }}
                >
                  {(a?.priority as string) || r.priority}
                </span>
              </div>
            </button>

            {expanded && a && (
              <div className="px-3 pb-4" style={{ borderTop: '1px solid #0F1820' }}>
                {/* Priority Banner — P1 IMMEDIATE inline */}
                <div
                  className="flex items-center justify-between px-4 mt-3"
                  style={{
                    padding: '18px 20px',
                    background: `${pc}1F`,
                    borderBottom: `3px solid ${pc}`,
                    borderRadius: 2,
                  }}
                >
                  <div className="flex items-center gap-4">
                    <span style={{ fontSize: 40 }}>{emoji}</span>
                    <div className="flex items-baseline gap-3">
                      <span className="font-heading" style={{ fontSize: 48, color: pc, lineHeight: 1 }}>
                        {a.priority as string}
                      </span>
                      <span className="font-heading" style={{ fontSize: 28, color: pc, letterSpacing: '0.05em' }}>
                        {priorityLabel}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span style={{ fontSize: 20, color: '#FFFFFF', textTransform: 'uppercase', fontWeight: 700 }}>
                      {a.service as string}
                    </span>
                  </div>
                </div>

                {/* Headline */}
                <div className="mt-4 p-4" style={{ border: '1px solid #0F1820', borderRadius: 4, background: '#0D1117' }}>
                  <p style={{ fontSize: 20, color: '#FFFFFF', lineHeight: 1.6, fontWeight: 500 }}>{a.headline as string}</p>
                </div>

                {/* Full Transcript */}
                <div className="mt-5">
                  <p style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.2em', marginBottom: 10 }}>
                    FULL TRANSCRIPT
                  </p>
                  <div className="p-4" style={{ border: '1px solid #0F1820', borderRadius: 4, background: '#0D1117' }}>
                    <p style={{ fontSize: 18, color: '#FFFFFF', lineHeight: 1.7, fontStyle: 'italic' }}>
                      &ldquo;{r.transcript ?? 'N/A'}&rdquo;
                    </p>
                    <div style={{ fontSize: 18, color: '#FFFFFF', marginTop: 10, opacity: 0.7 }}>
                      CONFIDENCE: {Math.round(confidence * 100)}%
                    </div>
                  </div>
                </div>

                {/* Protocol Fields & Actions — titles outside boxes, in priority colour */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
                  {Object.keys(structured).length > 0 && (
                    <div>
                      <p style={{ fontSize: 18, fontWeight: 700, color: pc, letterSpacing: '0.2em', marginBottom: 10 }}>
                        PROTOCOL FIELDS
                      </p>
                      <div className="p-4" style={{ border: '1px solid #0F1820', borderRadius: 4, background: '#0D1117' }}>
                        <div className="flex flex-col gap-3">
                          {Object.entries(structured).map(([k, v]) => (
                            <div key={k}>
                              <div style={{ fontSize: 18, fontWeight: 700, color: pc, letterSpacing: '0.05em', marginBottom: 2 }}>{k}</div>
                              <div style={{ fontSize: 18, color: '#FFFFFF', lineHeight: 1.5 }}>{v ?? '—'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {actions.length > 0 && (
                    <div>
                      <p style={{ fontSize: 18, fontWeight: 700, color: pc, letterSpacing: '0.2em', marginBottom: 10 }}>
                        IMMEDIATE ACTIONS
                      </p>
                      <div className="p-4" style={{ border: '1px solid #0F1820', borderRadius: 4, background: '#0D1117' }}>
                        <div className="flex flex-col gap-2">
                          {actions.map((action, i) => (
                            <div key={i} className="flex gap-3">
                              <span style={{ fontSize: 18, fontWeight: 700, color: pc, minWidth: 24 }}>{i + 1}.</span>
                              <span style={{ fontSize: 18, color: '#FFFFFF', lineHeight: 1.5 }}>{action}</span>
                            </div>
                          ))}
                        </div>
                        {transmitTo && (
                          <>
                            <div style={{ borderTop: '1px solid #0F1820', margin: '14px 0' }} />
                            <div style={{ fontSize: 18, color: '#FFFFFF' }}>
                              <span style={{ fontWeight: 700, color: pc }}>TRANSMIT TO:</span> {transmitTo}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Formatted Report */}
                {formattedReport && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2">
                      <p style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.2em' }}>
                        FORMATTED REPORT
                      </p>
                      <CopyBtn text={formattedReport} label="COPY" />
                    </div>
                    <div className="p-4" style={{ border: '1px solid #0F1820', borderRadius: 4, background: '#0D1117' }}>
                      <pre style={{ fontSize: 18, color: '#FFFFFF', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                        {formattedReport}
                      </pre>
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
