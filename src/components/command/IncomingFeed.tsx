import { useState } from 'react';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_EMOJIS, PRIORITY_COLORS } from '@/lib/herald-types';

interface Props {
  reports: CommandReport[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const FILTERS = ['ALL', 'P1', 'P2', 'P3'] as const;

export function IncomingFeed({ reports, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<string>('ALL');

  const filtered = filter === 'ALL'
    ? reports
    : reports.filter((r) => (r.assessment?.priority ?? r.priority) === filter);

  const getPriority = (r: CommandReport) => r.assessment?.priority ?? r.priority ?? 'P3';
  const getColor = (p: string) => PRIORITY_COLORS[p] ?? '#34C759';
  const getService = (r: CommandReport) => r.assessment?.service ?? r.service ?? 'unknown';
  const getCallsign = (r: CommandReport) => r.assessment?.structured?.callsign ?? null;
  const getIncident = (r: CommandReport) => r.assessment?.structured?.incident_number ?? null;
  const getHeadline = (r: CommandReport) => r.assessment?.headline ?? r.headline ?? 'No headline';
  const getTime = (r: CommandReport) => {
    const d = new Date(r.created_at ?? r.timestamp);
    return d.getUTCHours().toString().padStart(2, '0') + ':' +
      d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div style={{ fontSize: 18, color: '#FFFFFF', letterSpacing: '0.25em', marginBottom: 8 }}>
          INCOMING TRANSMISSIONS
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => {
            const active = filter === f;
            const col = f === 'ALL' ? '#FFFFFF' : getColor(f);
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: active ? col : '#FFFFFF',
                  border: `1px solid ${active ? col : '#0F1820'}`,
                  background: 'transparent',
                  padding: '3px 10px',
                  borderRadius: 2,
                  cursor: 'pointer',
                  letterSpacing: '0.05em',
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="animate-breathe" style={{ fontSize: 32 }}>📻</span>
            <span style={{ fontSize: 18, color: '#FFFFFF', letterSpacing: '0.2em' }}>AWAITING TRANSMISSIONS</span>
          </div>
        ) : (
          filtered.map((r) => {
            const p = getPriority(r);
            const col = getColor(p);
            const selected = selectedId === r.id;
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                className="w-full text-left"
                style={{
                  display: 'block',
                  border: `1px solid ${selected ? col : '#0F1820'}`,
                  borderLeft: `3px solid ${col}`,
                  borderRadius: 4,
                  padding: '12px 14px',
                  marginBottom: 8,
                  background: r.isNew ? `${col}24` : 'transparent',
                  transition: 'background 0.8s ease, transform 0.3s ease',
                  transform: r.isNew ? 'scale(1.02)' : 'scale(1)',
                  cursor: 'pointer',
                }}
              >
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 18 }}>{SERVICE_EMOJIS[getService(r)] ?? '📻'}</span>
                  <span
                    className="flex-1 truncate"
                    style={{ fontSize: 18, color: '#FFFFFF' }}
                  >
                    {getHeadline(r)}
                  </span>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: col,
                      border: `1px solid ${col}66`,
                      padding: '2px 8px',
                      borderRadius: 2,
                    }}
                  >
                    {p}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span style={{ fontSize: 18, color: '#FFFFFF' }}>{getTime(r)}</span>
                  {getCallsign(r) && (
                    <span style={{ fontSize: 14, color: col, border: `1px solid ${col}66`, padding: '1px 8px', borderRadius: 2, fontWeight: 600 }}>
                      {getCallsign(r)}
                    </span>
                  )}
                  {getIncident(r) && (
                    <span style={{ fontSize: 14, color: '#FFFFFF', border: '1px solid #0F1820', padding: '1px 8px', borderRadius: 2, fontWeight: 600 }}>
                      #{getIncident(r)}
                    </span>
                  )}
                  {r.operator_id && (
                    <span style={{ fontSize: 18, color: '#FFFFFF' }}>{r.operator_id}</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
