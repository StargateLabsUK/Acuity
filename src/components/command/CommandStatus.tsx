import type { CommandReport } from '@/hooks/useHeraldCommand';
import type { CommandShift } from '@/hooks/useHeraldCommand';
import { SERVICE_LABELS } from '@/lib/herald-types';

interface Props {
  todayReports: CommandReport[];
  priorityCounts: { P1: number; P2: number; P3: number };
  serviceCounts?: Record<string, number>;
  uniqueDevices: number;
  connected: boolean;
  activeShifts?: CommandShift[];
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-3 min-w-[80px]">
      <span className="text-sm text-muted-foreground tracking-[0.15em] font-bold mb-1">{label}</span>
      <span className="text-2xl font-heading font-bold" style={{ color: color ?? 'hsl(var(--foreground))' }}>
        {value}
      </span>
    </div>
  );
}

export function CommandStatus({ todayReports, priorityCounts, uniqueDevices, connected, activeShifts = [] }: Props) {
  const lastReport = todayReports[0];
  const lastTime = lastReport
    ? new Date(lastReport.created_at ?? lastReport.timestamp).getUTCHours().toString().padStart(2, '0') + ':' +
      new Date(lastReport.created_at ?? lastReport.timestamp).getUTCMinutes().toString().padStart(2, '0') + 'Z'
    : '—';

  return (
    <div className="flex flex-col bg-card">
      {/* Stats row — responsive wrap */}
      <div className="flex flex-wrap items-stretch border-b border-border">
        {/* Today count */}
        <div className="flex flex-col items-center justify-center px-5 py-3 border-r border-border">
          <span className="text-sm text-muted-foreground tracking-[0.15em] font-bold mb-1">TODAY</span>
          <span className="text-4xl md:text-5xl font-heading font-bold text-foreground leading-none">
            {todayReports.length}
          </span>
        </div>

        {/* Priority pills */}
        <div className="flex items-center gap-3 px-4 py-3 border-r border-border">
          {([
            { key: 'P1', color: '#FF3B30' },
            { key: 'P2', color: '#FF9500' },
            { key: 'P3', color: '#34C759' },
          ] as const).map(({ key, color }) => (
            <div key={key} className="flex flex-col items-center">
              <span className="text-sm font-bold tracking-wide" style={{ color }}>{key}</span>
              <span className="text-2xl font-heading font-bold" style={{ color }}>
                {priorityCounts[key]}
              </span>
            </div>
          ))}
        </div>

        {/* System stats */}
        <div className="flex items-stretch">
          <StatCard label="DEVICES" value={uniqueDevices} />
          <StatCard label="LAST" value={lastTime} />
          <StatCard
            label="DB"
            value={connected ? 'LIVE' : 'OFF'}
            color={connected ? 'hsl(var(--primary))' : '#FF3B30'}
          />
          <StatCard label="SHIFTS" value={activeShifts.length} />
        </div>
      </div>

      {/* Active shifts list */}
      {activeShifts.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground tracking-[0.15em] font-bold mb-2">
            ACTIVE SHIFTS
          </div>
          <div className="flex flex-wrap gap-2">
            {activeShifts.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: 'hsl(var(--primary))', animation: 'breathe 2s ease-in-out infinite' }}
                />
                <span className="text-lg text-foreground font-bold">{s.callsign ?? '—'}</span>
                <span className="text-sm text-muted-foreground">
                  {SERVICE_LABELS[s.service ?? ''] ?? s.service ?? ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeShifts.length === 0 && (
        <div className="px-4 py-3">
          <span className="text-sm text-muted-foreground tracking-[0.15em]">NO ACTIVE SHIFTS</span>
        </div>
      )}
    </div>
  );
}
