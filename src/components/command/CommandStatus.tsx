import type { CommandReport } from '@/hooks/useHeraldCommand';
import type { CommandShift } from '@/hooks/useHeraldCommand';
import { SERVICE_LABELS } from '@/lib/herald-types';
import { getVehicleLabel } from '@/lib/vehicle-types';

interface Props {
  todayReports: CommandReport[];
  priorityCounts: { P1: number; P2: number; P3: number };
  serviceCounts?: Record<string, number>;
  uniqueDevices: number;
  connected: boolean;
  activeShifts?: CommandShift[];
}

export function CommandStatus({ todayReports, priorityCounts, uniqueDevices, connected, activeShifts = [] }: Props) {
  const lastReport = todayReports[0];
  const lastTime = lastReport
    ? new Date(lastReport.created_at ?? lastReport.timestamp).getUTCHours().toString().padStart(2, '0') + ':' +
      new Date(lastReport.created_at ?? lastReport.timestamp).getUTCMinutes().toString().padStart(2, '0') + 'Z'
    : '—';

  return (
    <div className="flex flex-col bg-card">
      <div className="grid gap-0" style={{ gridTemplateColumns: 'auto auto 1fr 1fr' }}>
        {/* Total Transmissions */}
        <div className="px-3 py-2.5 md:px-4 md:py-3 border-r border-b md:border-b-0 border-border flex flex-col">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-1.5 font-bold">
            TODAY
          </div>
          <div className="font-heading text-4xl md:text-6xl text-foreground font-bold leading-none text-center mt-1">
            {todayReports.length}
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="px-3 py-2.5 md:px-3 md:py-3 border-r border-b md:border-b-0 border-border" style={{ minWidth: '90px' }}>
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
              <span className="font-heading text-lg font-bold" style={{ color: '#34C759' }}>{priorityCounts.P3}</span>
            </div>
          </div>
        </div>

        {/* System Status */}
        <div className="hidden md:block px-4 py-3 border-r border-border">
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
              <span className="text-lg text-foreground">SHIFTS</span>
              <span className="text-lg text-foreground font-bold">{activeShifts.length}</span>
            </div>
          </div>
        </div>

        {/* Active Shifts - desktop */}
        <div className="hidden md:block px-4 py-3">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-2 font-bold">
            ACTIVE SHIFTS ({activeShifts.length})
          </div>
          {activeShifts.length === 0 ? (
            <span className="text-lg text-foreground opacity-50">No active shifts</span>
          ) : (
            <div className="flex flex-col gap-1">
              {activeShifts.map((s) => {
                const vtBadge = getVehicleLabel(s.vehicle_type);
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: 'hsl(var(--primary))', animation: 'breathe 2s ease-in-out infinite' }} />
                    <span className="text-lg text-foreground font-bold">{s.callsign ?? '—'}</span>
                    {vtBadge && (
                      <span className="text-lg font-bold rounded-sm px-1 py-0.5"
                        style={{ color: s.can_transport ? '#3DFF8C' : '#FF9500', border: `1px solid ${s.can_transport ? 'rgba(61,255,140,0.2)' : 'rgba(255,149,0,0.3)'}` }}>
                        {vtBadge}
                      </span>
                    )}
                    <span className="text-lg text-muted-foreground">
                      {SERVICE_LABELS[s.service ?? ''] ?? s.service ?? ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile: System Status + Active Shifts */}
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
              <span className="text-lg text-foreground opacity-70">SHIFTS</span>
              <span className="text-lg text-foreground font-bold">{activeShifts.length}</span>
            </div>
          </div>
        </div>

        <div className="px-3 py-2.5">
          <div className="text-lg text-foreground opacity-70 tracking-[0.2em] mb-1.5 font-bold">
            ACTIVE SHIFTS ({activeShifts.length})
          </div>
          {activeShifts.length === 0 ? (
            <span className="text-lg text-foreground opacity-50">No active shifts</span>
          ) : (
            <div className="flex flex-col gap-1">
              {activeShifts.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: 'hsl(var(--primary))', animation: 'breathe 2s ease-in-out infinite' }} />
                  <span className="text-lg text-foreground font-bold">{s.callsign ?? '—'}</span>
                  <span className="text-lg text-muted-foreground">
                    {SERVICE_LABELS[s.service ?? ''] ?? s.service ?? ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
