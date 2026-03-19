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
        const pc = PRIORITY_COLORS[r.assessment?.priority] || '#3A5048';
        const emoji = SERVICE_EMOJIS[r.assessment?.service] || '📻';
        const expanded = expandedId === r.id;

        return (
          <button
            key={r.id}
            onClick={() => setExpandedId(expanded ? null : r.id)}
            className="w-full text-left mb-2 p-3"
            style={{ border: '1px solid #0F1820', borderRadius: 4 }}
          >
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 20 }}>{emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: 12, color: '#8A9890' }}>
                  {r.assessment?.headline || r.headline || 'Report'}
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
                {r.assessment?.priority || r.priority}
              </span>
            </div>

            {expanded && r.assessment?.formatted_report && (
              <pre
                className="mt-3 pt-3"
                style={{
                  borderTop: '1px solid #0F1820',
                  fontSize: 11,
                  color: '#3A5048',
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}
              >
                {r.assessment.formatted_report}
              </pre>
            )}
          </button>
        );
      })}
    </div>
  );
}
