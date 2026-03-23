import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Activity, Database, Brain, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface HealthEntry {
  id: string;
  checked_at: string;
  status: string;
  database_status: string;
  database_latency_ms: number | null;
  ai_provider_status: string;
  ai_provider_latency_ms: number | null;
  error_message: string | null;
}

interface LiveHealth {
  status: string;
  timestamp: string;
  components: {
    database: { status: string; latency_ms?: number };
    ai_provider: { status: string; latency_ms?: number };
  };
}

const STATUS_COLORS: Record<string, string> = {
  healthy: 'hsl(var(--primary))',
  degraded: '#FF9500',
  down: '#FF3B30',
  up: 'hsl(var(--primary))',
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'healthy' || status === 'up')
    return <CheckCircle size={18} style={{ color: STATUS_COLORS.healthy }} />;
  if (status === 'degraded')
    return <AlertTriangle size={18} style={{ color: STATUS_COLORS.degraded }} />;
  return <XCircle size={18} style={{ color: STATUS_COLORS.down }} />;
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex-shrink-0 p-2 rounded-md bg-muted">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground tracking-wide">{label}</p>
        <p className="text-xl font-bold text-foreground">{value}</p>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function AvailabilityBar({ entries }: { entries: HealthEntry[] }) {
  // Group by day for 30 days
  const days = useMemo(() => {
    const now = new Date();
    const result: { date: string; status: string; checks: number; healthy: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayEntries = entries.filter((e) => e.checked_at.slice(0, 10) === dateStr);
      const healthyCount = dayEntries.filter((e) => e.status === 'healthy').length;
      const total = dayEntries.length;
      let status = 'no-data';
      if (total > 0) {
        const ratio = healthyCount / total;
        status = ratio >= 0.99 ? 'healthy' : ratio >= 0.9 ? 'degraded' : 'down';
      }
      result.push({ date: dateStr, status, checks: total, healthy: healthyCount });
    }
    return result;
  }, [entries]);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold tracking-widest text-foreground">30-DAY AVAILABILITY</span>
        <span className="text-sm text-muted-foreground">
          {days.filter((d) => d.status === 'no-data').length < 30
            ? `${(
                (days.filter((d) => d.status === 'healthy').length /
                  days.filter((d) => d.status !== 'no-data').length) *
                100
              ).toFixed(2)}%`
            : 'No data'}
        </span>
      </div>
      <div className="flex gap-0.5">
        {days.map((day) => (
          <div
            key={day.date}
            className="flex-1 h-8 rounded-sm transition-colors"
            style={{
              backgroundColor:
                day.status === 'healthy'
                  ? 'hsl(var(--primary))'
                  : day.status === 'degraded'
                  ? '#FF9500'
                  : day.status === 'down'
                  ? '#FF3B30'
                  : 'hsl(var(--muted))',
              opacity: day.status === 'no-data' ? 0.3 : 1,
            }}
            title={`${day.date}: ${day.checks} checks, ${day.healthy} healthy`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-muted-foreground">{days[0]?.date}</span>
        <span className="text-xs text-muted-foreground">Today</span>
      </div>
    </div>
  );
}

function OutageHistory({ entries }: { entries: HealthEntry[] }) {
  const outages = useMemo(() => {
    return entries
      .filter((e) => e.status !== 'healthy')
      .sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())
      .slice(0, 20);
  }, [entries]);

  if (outages.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <span className="text-sm font-bold tracking-widest text-foreground">INCIDENT HISTORY</span>
        <p className="text-sm text-muted-foreground mt-3">No incidents recorded in the last 30 days.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <span className="text-sm font-bold tracking-widest text-foreground">INCIDENT HISTORY</span>
      <div className="mt-3 space-y-2">
        {outages.map((o) => (
          <div key={o.id} className="flex items-center gap-3 p-2 rounded border border-border bg-muted/30">
            <StatusIcon status={o.status} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground capitalize">{o.status}</p>
              <p className="text-xs text-muted-foreground truncate">{o.error_message || 'No details'}</p>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {new Date(o.checked_at).toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LatencyChart({ entries }: { entries: HealthEntry[] }) {
  // Last 50 entries with latency data
  const data = useMemo(() => {
    return entries
      .filter((e) => e.database_latency_ms != null)
      .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime())
      .slice(-50);
  }, [entries]);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <span className="text-sm font-bold tracking-widest text-foreground">RESPONSE TIMES</span>
        <p className="text-sm text-muted-foreground mt-3">No latency data available yet.</p>
      </div>
    );
  }

  const maxDb = Math.max(...data.map((d) => d.database_latency_ms ?? 0), 1);
  const maxAi = Math.max(...data.map((d) => d.ai_provider_latency_ms ?? 0), 1);
  const maxVal = Math.max(maxDb, maxAi);
  const avgDb = Math.round(data.reduce((s, d) => s + (d.database_latency_ms ?? 0), 0) / data.length);
  const avgAi = Math.round(
    data.filter((d) => d.ai_provider_latency_ms).reduce((s, d) => s + (d.ai_provider_latency_ms ?? 0), 0) /
      (data.filter((d) => d.ai_provider_latency_ms).length || 1)
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold tracking-widest text-foreground">RESPONSE TIMES</span>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: 'hsl(var(--primary))' }} />
            DB avg {avgDb}ms
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: '#FF9500' }} />
            AI avg {avgAi}ms
          </span>
        </div>
      </div>
      <div className="flex items-end gap-px h-24">
        {data.map((d, i) => {
          const dbH = ((d.database_latency_ms ?? 0) / maxVal) * 100;
          const aiH = ((d.ai_provider_latency_ms ?? 0) / maxVal) * 100;
          return (
            <div
              key={d.id}
              className="flex-1 flex flex-col justify-end gap-px"
              title={`${new Date(d.checked_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — DB: ${d.database_latency_ms}ms, AI: ${d.ai_provider_latency_ms ?? 'N/A'}ms`}
            >
              <div
                className="rounded-t-sm"
                style={{ height: `${aiH}%`, backgroundColor: '#FF9500', minHeight: aiH > 0 ? 1 : 0 }}
              />
              <div
                className="rounded-t-sm"
                style={{ height: `${dbH}%`, backgroundColor: 'hsl(var(--primary))', minHeight: dbH > 0 ? 1 : 0 }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function UptimeTab() {
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [liveHealth, setLiveHealth] = useState<LiveHealth | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch 30-day history
  useEffect(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    supabase
      .from('incident_log')
      .select('*')
      .gte('checked_at', cutoff.toISOString())
      .order('checked_at', { ascending: false })
      .then(({ data }) => {
        if (data) setEntries(data as HealthEntry[]);
        setLoading(false);
      });
  }, []);

  // Poll live health every 60s
  useEffect(() => {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const fetchHealth = async () => {
      try {
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/health?log=true`,
          {
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
          }
        );
        const data = await res.json();
        setLiveHealth(data);

        // Refresh entries after logging
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const { data: fresh } = await supabase
          .from('incident_log')
          .select('*')
          .gte('checked_at', cutoff.toISOString())
          .order('checked_at', { ascending: false });
        if (fresh) setEntries(fresh as HealthEntry[]);
      } catch (e) {
        console.error('Health poll failed', e);
      }
    };

    fetchHealth();
    const id = setInterval(fetchHealth, 60_000);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(() => {
    if (entries.length === 0) return null;
    const total = entries.length;
    const healthy = entries.filter((e) => e.status === 'healthy').length;
    const availability = ((healthy / total) * 100).toFixed(2);
    const avgDbLatency = Math.round(
      entries.reduce((s, e) => s + (e.database_latency_ms ?? 0), 0) / total
    );
    const avgAiLatency = Math.round(
      entries
        .filter((e) => e.ai_provider_latency_ms)
        .reduce((s, e) => s + (e.ai_provider_latency_ms ?? 0), 0) /
        (entries.filter((e) => e.ai_provider_latency_ms).length || 1)
    );
    const incidents = entries.filter((e) => e.status !== 'healthy').length;
    return { availability, avgDbLatency, avgAiLatency, incidents, total };
  }, [entries]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-lg text-muted-foreground tracking-widest animate-pulse">LOADING SLA DATA…</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Live status banner */}
      <div
        className="flex items-center gap-3 rounded-lg border p-4"
        style={{
          borderColor: liveHealth ? STATUS_COLORS[liveHealth.status] ?? STATUS_COLORS.down : 'hsl(var(--border))',
          backgroundColor: liveHealth
            ? `${STATUS_COLORS[liveHealth.status] ?? STATUS_COLORS.down}10`
            : 'transparent',
        }}
      >
        {liveHealth ? <StatusIcon status={liveHealth.status} /> : <Activity size={18} className="text-muted-foreground" />}
        <div>
          <p className="text-lg font-bold tracking-widest text-foreground uppercase">
            {liveHealth ? `SYSTEM ${liveHealth.status.toUpperCase()}` : 'CHECKING…'}
          </p>
          <p className="text-sm text-muted-foreground">
            {liveHealth
              ? `Last check: ${new Date(liveHealth.timestamp).toLocaleTimeString('en-GB')}`
              : 'Polling health endpoint…'}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="AVAILABILITY"
          value={stats ? `${stats.availability}%` : '—'}
          sub="30-day rolling"
          icon={<Activity size={20} className="text-primary" />}
        />
        <StatCard
          label="DB LATENCY"
          value={stats ? `${stats.avgDbLatency}ms` : '—'}
          sub="Average"
          icon={<Database size={20} className="text-primary" />}
        />
        <StatCard
          label="AI LATENCY"
          value={stats ? `${stats.avgAiLatency}ms` : '—'}
          sub="Average"
          icon={<Brain size={20} className="text-primary" />}
        />
        <StatCard
          label="INCIDENTS"
          value={stats ? `${stats.incidents}` : '—'}
          sub={`of ${stats?.total ?? 0} checks`}
          icon={<AlertTriangle size={20} style={{ color: stats && stats.incidents > 0 ? '#FF9500' : 'hsl(var(--primary))' }} />}
        />
      </div>

      <AvailabilityBar entries={entries} />
      <LatencyChart entries={entries} />
      <OutageHistory entries={entries} />
    </div>
  );
}
