import { useState } from 'react';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_LABELS, PRIORITY_COLORS } from '@/lib/herald-types';
import type { Mismatch } from '@/lib/herald-types';

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
  const getMismatches = (r: CommandReport): Mismatch[] => {
    const diff = r as any;
    if (diff.diff && Array.isArray(diff.diff.mismatches)) return diff.diff.mismatches;
    // Also check assessment-level diff from Supabase
    const d = (r as any).diff;
    if (d && typeof d === 'object' && Array.isArray(d.mismatches)) return d.mismatches;
    return [];
  };
  const getTime = (r: CommandReport) => {
    const d = new Date(r.created_at ?? r.timestamp);
    return d.getUTCHours().toString().padStart(2, '0') + ':' +
      d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="flex gap-1 mb-4">
          {FILTERS.map((f) => {
            const active = filter === f;
            const col = f === 'ALL' ? 'hsl(var(--foreground))' : getColor(f);
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="text-lg md:text-lg font-bold tracking-wide rounded-sm px-2 py-0.5 bg-transparent cursor-pointer transition-colors"
                style={{
                  color: active ? col : 'hsl(var(--foreground))',
                  border: `1px solid ${active ? col : 'hsl(var(--border))'}`,
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
        <div className="text-lg md:text-lg text-foreground tracking-[0.25em] font-bold mb-3">
          TRANSMISSIONS
        </div>
      </div>

      {/* Cards */}
      <div className="px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="animate-breathe text-[32px]">📻</span>
            <span className="text-lg md:text-lg text-foreground tracking-[0.2em]">AWAITING TRANSMISSIONS</span>
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
                className="w-full text-left block rounded-lg cursor-pointer mb-2 transition-all shadow-sm"
                style={{
                  border: `1px solid ${selected ? col : 'hsl(var(--border))'}`,
                  padding: '10px 14px',
                  background: r.isNew ? `${col}24` : selected ? `${col}0A` : 'hsl(var(--card))',
                  transform: r.isNew ? 'scale(1.02)' : 'scale(1)',
                }}
              >
                {/* Row 1: Priority | Time | Service | Status */}
                <div className="flex items-center gap-3" style={{ marginBottom: 4 }}>
                  <span
                    className="text-lg font-bold rounded-sm px-1.5 py-0.5 flex-shrink-0"
                    style={{ color: col, border: `1px solid ${col}66`, minWidth: 36, textAlign: 'center' }}
                  >
                    {p}
                  </span>
                  <span className="text-lg text-foreground flex-shrink-0" style={{ minWidth: 56 }}>
                    {getTime(r)}
                  </span>
                  <span className="text-lg uppercase font-bold flex-shrink-0" style={{ color: '#4A6058' }}>
                    {SERVICE_LABELS[getService(r)] ?? getService(r)}
                  </span>
                  {(r as any).status === 'closed' ? (
                    <span className="text-lg font-bold rounded-sm px-1.5 py-0.5 flex-shrink-0"
                      style={{ color: '#888', border: '1px solid rgba(136,136,136,0.3)', background: 'rgba(136,136,136,0.08)' }}>
                      CLOSED
                    </span>
                  ) : (r as any).status === 'active' && r.incident_number ? (
                    <span className="text-lg font-bold rounded-sm px-1.5 py-0.5 flex-shrink-0"
                      style={{ color: '#FF9500', border: '1px solid rgba(255,149,0,0.3)', background: 'rgba(255,149,0,0.08)' }}>
                      ACTIVE
                    </span>
                  ) : null}
                </div>

                {/* Row 2: Headline (always full width, truncated) */}
                <div className="truncate text-lg text-foreground font-semibold" style={{ marginBottom: 4 }}>
                  {getHeadline(r)}
                </div>

                {/* Row 3: Unit | Officer | Incident | Mismatch */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(r.session_callsign || getCallsign(r)) && (
                    <span
                      className="text-lg font-semibold rounded-sm px-1.5 py-0.5 flex-shrink-0"
                      style={{ color: '#3DFF8C', border: '1px solid rgba(61,255,140,0.2)' }}
                    >
                      {r.session_callsign || getCallsign(r)}
                    </span>
                  )}
                  {r.session_operator_id && (
                    <span className="text-lg flex-shrink-0" style={{ color: '#3A5048' }}>
                      {r.session_operator_id}
                    </span>
                  )}
                  {getIncident(r) && (
                    <span className="text-lg font-semibold text-foreground border border-border rounded-sm px-1.5 py-0.5 flex-shrink-0">
                      #{getIncident(r)}
                    </span>
                  )}
                  {(r.transmission_count ?? 1) > 1 && (
                    <span
                      className="text-lg font-bold rounded-sm px-1.5 py-0.5 flex-shrink-0"
                      style={{ color: '#1E90FF', border: '1px solid rgba(30,144,255,0.3)', background: 'rgba(30,144,255,0.08)' }}
                    >
                      {r.transmission_count} TX
                    </span>
                  )}
                  {getMismatches(r).length > 0 && (
                    <span
                      className="text-lg font-bold rounded-sm px-1.5 py-0.5 flex-shrink-0"
                      style={{ color: '#FF9500', border: '1px solid rgba(255,149,0,0.3)', background: 'rgba(255,149,0,0.08)' }}
                      title={getMismatches(r).map(m => `${m.field}: session=${m.session_value} tx=${m.transcript_value}`).join('; ')}
                    >
                      ⚠ MISMATCH
                    </span>
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
