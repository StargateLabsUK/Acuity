import { useState } from 'react';
import type { HeraldReport } from '@/lib/herald-types';
import { PRIORITY_COLORS, SERVICE_EMOJIS } from '@/lib/herald-types';

interface ReportsTabProps {
  reports: HeraldReport[];
}

export function ReportsTab({ reports }: ReportsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex-1 overflow-auto px-4 py-3">
      <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 12 }}>
        CONFIRMED TRANSMISSIONS
      </p>

      {reports.length === 0 && (
        <p className="text-center mt-12" style={{ fontSize: 12, color: '#1E3028' }}>
          No confirmed reports yet
        </p>
      )}

      {reports.map((r) => {
        const a = r.assessment as Record<string, unknown> | null;
        const pc = PRIORITY_COLORS[a?.priority as string] || PRIORITY_COLORS[r.priority as string] || '#3A5048';
        const emoji = SERVICE_EMOJIS[a?.service as string] || SERVICE_EMOJIS[r.service as string] || '📻';
        const expanded = expandedId === r.id;

        return (
          <div
            key={r.id}
            className="mb-2"
            style={{ border: '1px solid #0F1820', borderRadius: 4 }}
          >
            {/* Collapsed header row */}
            <button
              onClick={() => setExpandedId(expanded ? null : r.id)}
              className="w-full text-left p-3"
            >
              <div className="flex items-center gap-3">
                <span style={{ fontSize: 20 }}>{emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontSize: 12, color: '#8A9890' }}>
                    {(a?.headline as string) || r.headline || 'Report'}
                  </p>
                  <p style={{ fontSize: 10, color: '#1E3028' }}>
                    {new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19)}Z
                  </p>
                </div>
                <span
                  className="font-heading px-2 py-0.5"
                  style={{
                    fontSize: 13,
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

            {/* Expanded full report */}
            {expanded && a && (
              <div className="px-3 pb-3" style={{ borderTop: '1px solid #0F1820' }}>
                {/* Priority banner */}
                <div
                  className="flex items-center justify-between px-3 mt-3"
                  style={{
                    height: 64,
                    background: `${pc}1F`,
                    borderBottom: `2px solid ${pc}`,
                    borderRadius: 2,
                  }}
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <span style={{ fontSize: 28 }}>{emoji}</span>
                      <span className="font-heading" style={{ fontSize: 32, fontWeight: 800, color: pc }}>
                        {a.priority as string}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: pc, opacity: 0.8 }}>{a.priority_label as string}</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#1E3028', textTransform: 'uppercase' }}>
                    {a.service as string}
                  </span>
                </div>

                {/* Headline */}
                <div className="mt-3 p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
                  <p style={{ fontSize: 13, color: '#8A9890' }}>{a.headline as string}</p>
                </div>

                {/* Two column grid */}
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {/* Protocol fields */}
                  {a.structured && (
                    <div className="p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
                      <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>PROTOCOL FIELDS</p>
                      {Object.entries(a.structured as Record<string, string>).map(([k, v]) => (
                        <div key={k} className="mb-2">
                          <p style={{ fontSize: 11, color: '#1E3028', fontWeight: 700 }}>{k}</p>
                          <p style={{ fontSize: 11, color: '#4A6058' }}>{v}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  {(a.actions as string[])?.length > 0 && (
                    <div className="p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
                      <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>IMMEDIATE ACTIONS</p>
                      {(a.actions as string[]).map((action, i) => (
                        <div key={i} className="flex gap-2 mb-1.5">
                          <span style={{ fontSize: 12, color: pc, fontWeight: 700 }}>{i + 1}.</span>
                          <span style={{ fontSize: 12, color: '#6A8070' }}>{action}</span>
                        </div>
                      ))}
                      {a.transmit_to && (
                        <>
                          <div style={{ borderTop: '1px solid #0F1820', margin: '8px 0' }} />
                          <p style={{ fontSize: 10, color: '#1E3028' }}>TRANSMIT TO: {a.transmit_to as string}</p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Formatted report */}
                {a.formatted_report && (
                  <div className="mt-3 p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
                    <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>FORMATTED REPORT</p>
                    <pre style={{ fontSize: 11, color: '#3A5048', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: 'IBM Plex Mono, monospace' }}>
                      {a.formatted_report as string}
                    </pre>
                  </div>
                )}

                {/* Raw transcript */}
                {r.transcript && (
                  <div className="mt-3 p-3" style={{ border: '1px solid #0F1820', borderRadius: 2 }}>
                    <p style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.1em', marginBottom: 8 }}>RAW TRANSMISSION</p>
                    <p style={{ fontSize: 12, color: '#2A4038', fontStyle: 'italic' }}>"{r.transcript}"</p>
                    {(a.confidence as number) != null && (
                      <p style={{ fontSize: 10, color: '#1E3028', marginTop: 4 }}>
                        Confidence: {Math.round((a.confidence as number) * 100)}%
                      </p>
                    )}
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
