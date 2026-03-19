import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_EMOJIS } from '@/lib/herald-types';

interface Props {
  todayReports: CommandReport[];
  priorityCounts: { P1: number; P2: number; P3: number };
  serviceCounts: Record<string, number>;
  uniqueDevices: number;
  connected: boolean;
}

function StatBlock({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-foreground opacity-70 tracking-[0.15em]">{label}</span>
      <span className="text-lg font-bold" style={{ color: color ?? 'hsl(var(--foreground))' }}>{value}</span>
    </div>
  );
}

export function CommandStatus({ todayReports, priorityCounts, serviceCounts, uniqueDevices, connected }: Props) {
  const lastReport = todayReports[0];
  const lastTime = lastReport
    ? new Date(lastReport.created_at ?? lastReport.timestamp).getUTCHours().toString().padStart(2, '0') + ':' +
      new Date(lastReport.created_at ?? lastReport.timestamp).getUTCMinutes().toString().padStart(2, '0') + 'Z'
    : '—';

  const topServices = Object.entries(serviceCounts).slice(0, 4);

  return (
    <div className="flex items-center gap-6 px-5 py-3 overflow-x-auto bg-card" style={{ scrollbarWidth: 'thin' }}>
      {/* Today count */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="font-heading text-3xl text-foreground font-bold leading-none">
          {todayReports.length}
        </span>
        <span className="text-sm text-foreground opacity-70 tracking-[0.15em]">TODAY</span>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-border flex-shrink-0" />

      {/* Priority counts */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <StatBlock label="P1" value={priorityCounts.P1} color="#FF3B30" />
        <StatBlock label="P2" value={priorityCounts.P2} color="#FF9500" />
        <StatBlock label="P3" value={priorityCounts.P3} color="#34C759" />
      </div>

      <div className="w-px h-8 bg-border flex-shrink-0" />

      {/* Services */}
      <div className="flex items-center gap-4 flex-shrink-0">
        {topServices.map(([s, c]) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="text-base">{SERVICE_EMOJIS[s] ?? '📻'}</span>
            <span className="text-sm text-foreground opacity-70 uppercase">{s}</span>
            <span className="text-lg text-foreground font-bold">{c}</span>
          </div>
        ))}
        {topServices.length === 0 && (
          <span className="text-sm text-foreground opacity-50">No services</span>
        )}
      </div>

      <div className="w-px h-8 bg-border flex-shrink-0" />

      {/* System info */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <StatBlock label="DEVICES" value={uniqueDevices} />
        <StatBlock label="LAST" value={lastTime} />
        <StatBlock
          label="DB"
          value={connected ? 'LIVE' : 'OFFLINE'}
          color={connected ? 'hsl(var(--primary))' : '#FF3B30'}
        />
      </div>
    </div>
  );
}
