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
        <div className="text-sm md:text-lg text-foreground tracking-[0.25em] mb-2 font-bold">
          INCOMING TRANSMISSIONS
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => {
            const active = filter === f;
            const col = f === 'ALL' ? 'hsl(var(--foreground))' : getColor(f);
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="text-sm md:text-lg font-bold tracking-wide rounded-sm px-2 py-0.5 bg-transparent cursor-pointer transition-colors"
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
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <span className="animate-breathe text-[32px]">📻</span>
            <span className="text-sm md:text-lg text-foreground tracking-[0.2em]">AWAITING TRANSMISSIONS</span>
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
                className="w-full text-left block rounded bg-transparent cursor-pointer mb-2 transition-all"
                style={{
                  border: `1px solid ${selected ? col : 'hsl(var(--border))'}`,
                  borderLeft: `3px solid ${col}`,
                  padding: '10px 12px',
                  background: r.isNew ? `${col}24` : selected ? `${col}0A` : 'transparent',
                  transform: r.isNew ? 'scale(1.02)' : 'scale(1)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base md:text-lg">{SERVICE_EMOJIS[getService(r)] ?? '📻'}</span>
                  <span className="flex-1 truncate text-sm md:text-lg text-foreground">
                    {getHeadline(r)}
                  </span>
                  <span
                    className="text-sm md:text-lg font-bold rounded-sm px-1.5 md:px-2 py-0.5"
                    style={{
                      color: col,
                      border: `1px solid ${col}66`,
                    }}
                  >
                    {p}
                  </span>
                </div>
                <div className="flex items-center gap-2 md:gap-3 mt-1 flex-wrap">
                  <span className="text-xs md:text-lg text-foreground">{getTime(r)}</span>
                  {getCallsign(r) && (
                    <span
                      className="text-xs md:text-sm font-semibold rounded-sm px-1.5 py-0.5"
                      style={{ color: col, border: `1px solid ${col}66` }}
                    >
                      {getCallsign(r)}
                    </span>
                  )}
                  {getIncident(r) && (
                    <span className="text-xs md:text-sm font-semibold text-foreground border border-border rounded-sm px-1.5 py-0.5">
                      #{getIncident(r)}
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
