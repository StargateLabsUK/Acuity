import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_EMOJIS } from '@/lib/herald-types';

interface Props {
  todayReports: CommandReport[];
  priorityCounts: { P1: number; P2: number; P3: number };
  serviceCounts: Record<string, number>;
  uniqueDevices: number;
  connected: boolean;
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-3">{children}</div>;
}

function Divider() {
  return <div style={{ borderTop: '1px solid #0F1820' }} />;
}

function Row({ left, right, color }: { left: React.ReactNode; right: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span style={{ fontSize: 11, color: color ?? '#4A6058' }}>{left}</span>
      <span style={{ fontSize: 11, color: color ?? '#4A6058', fontWeight: 700 }}>{right}</span>
    </div>
  );
}

export function CommandStatus({ todayReports, priorityCounts, serviceCounts, uniqueDevices, connected }: Props) {
  const lastReport = todayReports[0];
  const lastTime = lastReport
    ? new Date(lastReport.created_at ?? lastReport.timestamp).getUTCHours().toString().padStart(2, '0') + ':' +
      new Date(lastReport.created_at ?? lastReport.timestamp).getUTCMinutes().toString().padStart(2, '0') + 'Z'
    : 'NONE';

  const recent = todayReports.slice(0, 8);

  const getColor = (p: string) =>
    p === 'P1' ? '#FF3B30' : p === 'P2' ? '#FF9500' : '#34C759';

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
      {/* Today's Activity */}
      <Section>
        <div className="font-heading" style={{ fontSize: 48, color: '#C8D0CC', fontWeight: 700 }}>
          {todayReports.length}
        </div>
        <div style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.25em', marginBottom: 10 }}>
          TRANSMISSIONS TODAY
        </div>
        <Row left="P1" right={priorityCounts.P1} color="#FF3B30" />
        <Row left="P2" right={priorityCounts.P2} color="#FF9500" />
        <Row left="P3" right={priorityCounts.P3} color="#34C759" />
      </Section>

      <Divider />

      {/* By Service */}
      <Section>
        <div style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.25em', marginBottom: 8 }}>
          BY SERVICE
        </div>
        {Object.entries(serviceCounts).map(([s, c]) => (
          <Row
            key={s}
            left={<span>{SERVICE_EMOJIS[s] ?? '📻'} {s.toUpperCase()}</span>}
            right={c}
          />
        ))}
        {Object.keys(serviceCounts).length === 0 && (
          <span style={{ fontSize: 10, color: '#1E3028' }}>No reports today</span>
        )}
      </Section>

      <Divider />

      {/* Recent Timeline */}
      <Section>
        <div style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.25em', marginBottom: 8 }}>
          RECENT TIMELINE
        </div>
        {recent.length === 0 ? (
          <span style={{ fontSize: 10, color: '#1E3028' }}>No recent activity</span>
        ) : (
          recent.map((r) => {
            const p = r.assessment?.priority ?? r.priority ?? 'P3';
            const d = new Date(r.created_at ?? r.timestamp);
            const t = d.getUTCHours().toString().padStart(2, '0') + ':' +
              d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
            const h = (r.assessment?.headline ?? r.headline ?? '').slice(0, 30);
            return (
              <div key={r.id} className="flex items-center gap-2 py-1">
                <span style={{ fontSize: 10, color: '#1E3028', width: 42, flexShrink: 0 }}>{t}</span>
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getColor(p) }}
                />
                <span className="truncate" style={{ fontSize: 11, color: '#4A6058' }}>{h}</span>
              </div>
            );
          })
        )}
      </Section>

      <Divider />

      {/* System Status */}
      <Section>
        <div style={{ fontSize: 9, color: '#1E3028', letterSpacing: '0.25em', marginBottom: 8 }}>
          SYSTEM STATUS
        </div>
        <Row left="FIELD DEVICES" right={<span>{uniqueDevices} ACTIVE</span>} />
        <Row left="LAST REPORT" right={lastTime} />
        <Row
          left="SUPABASE"
          right={connected ? 'CONNECTED' : 'OFFLINE'}
          color={connected ? '#3DFF8C' : '#FF3B30'}
        />
        <Row left="HERALD VERSION" right="v1.0" />
      </Section>
    </div>
  );
}
