import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_EMOJIS } from '@/lib/herald-types';

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
    <div className="grid grid-cols-4 gap-0 bg-card border-b border-border">
      {/* Today's count */}
      <div className="px-5 py-4 border-r border-border">
        <div className="font-heading text-5xl text-foreground font-bold leading-none">
          {todayReports.length}
        </div>
        <div className="text-sm text-foreground opacity-70 tracking-[0.25em] mt-1 mb-3">
          TRANSMISSIONS TODAY
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="text-base" style={{ color: '#FF3B30' }}>P1</span>
            <span className="text-base font-bold" style={{ color: '#FF3B30' }}>{priorityCounts.P1}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: '#FF9500' }}>P2</span>
            <span className="text-base font-bold" style={{ color: '#FF9500' }}>{priorityCounts.P2}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: '#34C759' }}>P3</span>
            <span className="text-base font-bold" style={{ color: '#34C759' }}>{priorityCounts.P3}</span>
          </div>
        </div>
      </div>

      {/* By Service */}
      <div className="px-5 py-4 border-r border-border">
        <div className="text-sm text-foreground opacity-70 tracking-[0.25em] mb-3 font-bold">
          BY SERVICE
        </div>
        <div className="flex flex-col gap-1">
          {Object.entries(serviceCounts).map(([s, c]) => (
            <div key={s} className="flex items-center justify-between">
              <span className="text-base text-foreground">{SERVICE_EMOJIS[s] ?? '📻'} {s.toUpperCase()}</span>
              <span className="text-base text-foreground font-bold">{c}</span>
            </div>
          ))}
          {Object.keys(serviceCounts).length === 0 && (
            <span className="text-sm text-foreground opacity-50">No reports today</span>
          )}
        </div>
      </div>

      {/* Recent Timeline */}
      <div className="px-5 py-4 border-r border-border">
        <div className="text-sm text-foreground opacity-70 tracking-[0.25em] mb-3 font-bold">
          RECENT TIMELINE
        </div>
        {recent.length === 0 ? (
          <span className="text-sm text-foreground opacity-50">No recent activity</span>
        ) : (
          <div className="flex flex-col gap-1">
            {recent.map((r) => {
              const p = r.assessment?.priority ?? r.priority ?? 'P3';
              const d = new Date(r.created_at ?? r.timestamp);
              const t = d.getUTCHours().toString().padStart(2, '0') + ':' +
                d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
              const h = (r.assessment?.headline ?? r.headline ?? '').slice(0, 28);
              return (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="text-sm text-foreground opacity-70 w-[52px] flex-shrink-0">{t}</span>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: getColor(p) }} />
                  <span className="text-sm text-foreground truncate">{h}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* System Status */}
      <div className="px-5 py-4">
        <div className="text-sm text-foreground opacity-70 tracking-[0.25em] mb-3 font-bold">
          SYSTEM STATUS
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="text-base text-foreground">FIELD DEVICES</span>
            <span className="text-base text-foreground font-bold">{uniqueDevices} ACTIVE</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base text-foreground">LAST REPORT</span>
            <span className="text-base text-foreground font-bold">{lastTime}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base text-foreground">SUPABASE</span>
            <span className="text-base font-bold" style={{ color: connected ? 'hsl(var(--primary))' : '#FF3B30' }}>
              {connected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-base text-foreground">VERSION</span>
            <span className="text-base text-foreground font-bold">v1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
