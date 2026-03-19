import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_LABELS } from '@/lib/herald-types';

interface Props {
  todayReports: CommandReport[];
  priorityCounts: { P1: number; P2: number; P3: number };
  serviceCounts: Record<string, number>;
  uniqueDevices: number;
  connected: boolean;
}

function getColor(p: string) {
  return p === 'P1' ? '#FF3B30' : p === 'P2' ? '#FF9500' : '#34C759';
}

export function CommandStatus({ todayReports, priorityCounts, serviceCounts, uniqueDevices, connected }: Props) {
  const lastReport = todayReports[0];
  const lastTime = lastReport
    ? new Date(lastReport.created_at ?? lastReport.timestamp).getUTCHours().toString().padStart(2, '0') + ':' +
      new Date(lastReport.created_at ?? lastReport.timestamp).getUTCMinutes().toString().padStart(2, '0') + 'Z'
    : '—';

  const recent = todayReports.slice(0, 5);

  return (
    <div className="flex flex-col bg-card">
      {/* Top row: Transmissions + By Service */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-0">
        {/* Total Transmissions */}
        <div className="px-3 py-2.5 md:px-4 md:py-3 border-r border-b md:border-b-0 border-border flex flex-col items-center justify-center">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-1.5 font-bold">
            TODAY
          </div>
          <div className="font-heading text-4xl md:text-6xl text-foreground font-bold leading-none">
            {todayReports.length}
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="px-3 py-2.5 md:px-4 md:py-3 border-r border-b md:border-b-0 border-border">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-1.5 font-bold">
            PRIORITY
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-lg" style={{ color: '#FF3B30' }}>P1</span>
              <span className="font-heading text-lg font-bold" style={{ color: '#FF3B30' }}>{priorityCounts.P1}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-lg" style={{ color: '#FF9500' }}>P2</span>
              <span className="font-heading text-lg font-bold" style={{ color: '#FF9500' }}>{priorityCounts.P2}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-lg" style={{ color: '#34C759' }}>P3</span>
              <span className="font-heading text-2xl md:text-3xl font-bold" style={{ color: '#34C759' }}>{priorityCounts.P3}</span>
            </div>
          </div>
        </div>

        {/* By Service */}
        <div className="px-3 py-2.5 md:px-4 md:py-3 md:border-r border-b md:border-b-0 border-border">
          <div className="text-lg md:text-lg text-foreground opacity-70 tracking-[0.2em] mb-1.5 font-bold">
            BY SERVICE
          </div>
          <div className="flex flex-col gap-0.5">
            {Object.entries(serviceCounts).map(([s, c]) => (
              <div key={s} className="flex items-center justify-between">
                <span className="text-lg md:text-lg text-foreground">{SERVICE_LABELS[s] ?? s.toUpperCase()}</span>
                <span className="font-heading text-2xl md:text-3xl text-foreground font-bold">{c}</span>
              </div>
            ))}
            {Object.keys(serviceCounts).length === 0 && (
              <span className="text-lg text-foreground opacity-50">No reports today</span>
            )}
          </div>
        </div>

        {/* System Status - desktop: col 3 */}
        <div className="hidden md:block px-4 py-3 border-r border-border">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-2 font-bold">
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between">
              <span className="text-lg text-foreground">DEVICES</span>
              <span className="text-lg text-foreground font-bold">{uniqueDevices}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-lg text-foreground">LAST</span>
              <span className="text-lg text-foreground font-bold">{lastTime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-lg text-foreground">DB</span>
              <span className="text-lg font-bold" style={{ color: connected ? 'hsl(var(--primary))' : '#FF3B30' }}>
                {connected ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-lg text-foreground">VER</span>
              <span className="text-lg text-foreground font-bold">v1.0</span>
            </div>
          </div>
        </div>

        {/* Recent Timeline - desktop: col 4 */}
        <div className="hidden md:block px-4 py-3">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-2 font-bold">
            RECENT TIMELINE
          </div>
          {recent.length === 0 ? (
            <span className="text-lg text-foreground opacity-50">No recent activity</span>
          ) : (
            <div className="flex flex-col gap-0.5">
              {recent.map((r) => {
                const p = r.assessment?.priority ?? r.priority ?? 'P3';
                const d = new Date(r.created_at ?? r.timestamp);
                const t = d.getUTCHours().toString().padStart(2, '0') + ':' +
                  d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
                const h = (r.assessment?.headline ?? r.headline ?? '').slice(0, 22);
                return (
                  <div key={r.id} className="flex items-center gap-1.5">
                    <span className="text-lg text-foreground opacity-70 w-[52px] flex-shrink-0">{t}</span>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(p) }} />
                    <span className="text-lg text-foreground truncate">{h}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile: System Status + Timeline stacked full-width */}
      <div className="md:hidden">
        <div className="px-3 py-2.5 border-b border-border">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-1.5 font-bold">
            SYSTEM STATUS
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="flex flex-col items-center">
              <span className="text-lg text-foreground opacity-70">DEVICES</span>
              <span className="text-lg text-foreground font-bold">{uniqueDevices}</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg text-foreground opacity-70">LAST</span>
              <span className="text-lg text-foreground font-bold">{lastTime}</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg text-foreground opacity-70">DB</span>
              <span className="text-lg font-bold" style={{ color: connected ? 'hsl(var(--primary))' : '#FF3B30' }}>
                {connected ? 'LIVE' : 'OFF'}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg text-foreground opacity-70">VER</span>
              <span className="text-lg text-foreground font-bold">v1.0</span>
            </div>
          </div>
        </div>

        <div className="px-3 py-2.5">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-1.5 font-bold">
            RECENT TIMELINE
          </div>
          {recent.length === 0 ? (
            <span className="text-lg text-foreground opacity-50">No recent activity</span>
          ) : (
            <div className="flex flex-col gap-0.5">
              {recent.map((r) => {
                const p = r.assessment?.priority ?? r.priority ?? 'P3';
                const d = new Date(r.created_at ?? r.timestamp);
                const t = d.getUTCHours().toString().padStart(2, '0') + ':' +
                  d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
                const h = (r.assessment?.headline ?? r.headline ?? '').slice(0, 30);
                return (
                  <div key={r.id} className="flex items-center gap-1.5">
                    <span className="text-lg text-foreground opacity-70 w-[52px] flex-shrink-0">{t}</span>
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(p) }} />
                    <span className="text-lg text-foreground truncate">{h}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}