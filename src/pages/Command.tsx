import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useHeraldCommand } from '@/hooks/useHeraldCommand';
import { CommandTopBar } from '@/components/command/CommandTopBar';
import { ReportDetail } from '@/components/command/ReportDetail';
import { CommandStatus } from '@/components/command/CommandStatus';
import { OpsLogTab } from '@/components/command/OpsLogTab';
import { UptimeTab } from '@/components/command/UptimeTab';

type MobileTab = 'ops' | 'sla';
type ViewMode = 'mobile' | 'tablet' | 'desktop';
type ExpandedPanel = 'feed' | 'detail' | 'ops' | null;

function useViewMode(): ViewMode {
  const [mode, setMode] = useState<ViewMode>('desktop');
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      if (w < 640) setMode('mobile');
      else if (w < 1024) setMode('tablet');
      else setMode('desktop');
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mode;
}

function applyFilters(
  reports: ReturnType<typeof useHeraldCommand>['reports'],
  filters: { service: string; callsign: string; timeRange: string }
) {
  let filtered = [...reports];
  if (filters.service) {
    filtered = filtered.filter(
      (r) => (r.assessment?.service ?? r.service ?? r.session_service) === filters.service
    );
  }
  if (filters.callsign) {
    filtered = filtered.filter((r) => r.session_callsign === filters.callsign);
  }
  if (filters.timeRange === 'today') {
    const today = new Date().toDateString();
    filtered = filtered.filter(
      (r) => new Date(r.created_at ?? r.timestamp).toDateString() === today
    );
  } else if (filters.timeRange === '24h') {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    filtered = filtered.filter(
      (r) => new Date(r.created_at ?? r.timestamp).getTime() > cutoff
    );
  }
  return filtered;
}

/** Expand/collapse button for panel top-right */
function ExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-2 right-2 z-10 p-1.5 rounded bg-card/80 border border-border hover:bg-card cursor-pointer transition-colors"
      title={expanded ? 'Collapse' : 'Expand'}
    >
      {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
    </button>
  );
}

export default function Command() {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('ops');
  const [filters] = useState({ service: '', callsign: '', timeRange: 'today' as const });
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);
  const [desktopUpperTab, setDesktopUpperTab] = useState<'ops' | 'sla'>('ops');
  const [opsReportId, setOpsReportId] = useState<string | null>(null);
  const viewMode = useViewMode();

  const {
    reports,
    todayReports,
    priorityCounts,
    serviceCounts,
    uniqueDevices,
    connected,
    activeShifts,
    dispositions,
    transfers,
  } = useHeraldCommand();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user?.email) {
        navigate('/login', { replace: true });
        return;
      }
      // Verify user has command or admin role
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .then(({ data }) => {
          if (data?.some(r => r.role === 'command' || r.role === 'admin')) {
            setAuthChecked(true);
          } else {
            navigate('/login', { replace: true });
          }
        });
    });
  }, [navigate]);

  const filteredReports = useMemo(() => applyFilters(reports, filters), [reports, filters]);
  const selectedReport = filteredReports.find((r) => r.id === selectedId) ?? null;
  const opsReport = useMemo(() => opsReportId ? reports.find((r) => r.id === opsReportId) ?? null : null, [opsReportId, reports]);

  const handleOpsReportSelect = useCallback((id: string) => {
    setOpsReportId(id);
  }, []);

  const uniqueCallsigns = useMemo(() => {
    const set = new Set<string>();
    todayReports.forEach((r) => {
      if (r.session_callsign) set.add(r.session_callsign);
    });
    return Array.from(set).sort();
  }, [todayReports]);

  const uniqueServices = useMemo(() => {
    const set = new Set<string>();
    todayReports.forEach((r) => {
      const s = r.assessment?.service ?? r.service ?? r.session_service;
      if (s) set.add(s);
    });
    return Array.from(set).sort();
  }, [todayReports]);

  const filteredPriorityCounts = useMemo(() => {
    const counts = { P1: 0, P2: 0, P3: 0 };
    filteredReports.forEach((r) => {
      const p = r.assessment?.priority ?? r.priority;
      if (p === 'P1') counts.P1++;
      else if (p === 'P2') counts.P2++;
      else if (p === 'P3') counts.P3++;
    });
    return counts;
  }, [filteredReports]);

  const filteredServiceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredReports.forEach((r) => {
      const s = r.assessment?.service ?? r.service ?? 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [filteredReports]);

  const toggleExpand = useCallback((panel: ExpandedPanel) => {
    setExpandedPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const mobileTabBtn = (id: MobileTab, label: string) => {
    const active = mobileTab === id;
    return (
      <button
        onClick={() => setMobileTab(id)}
        className="flex-1 h-12 font-heading text-lg font-bold tracking-[0.08em]"
        style={{
          color: active ? 'hsl(var(--primary))' : 'hsl(var(--foreground))',
          borderTop: active ? '2px solid hsl(var(--primary))' : '2px solid transparent',
          background: 'transparent',
        }}
      >
        {label}
      </button>
    );
  };


  if (!authChecked) {
    return <div className="min-h-screen" style={{ background: 'var(--herald-command-bg)' }} />;
  }

  const topBar = <CommandTopBar priorityCounts={priorityCounts} connected={connected} />;

  if (opsReport) {
    return (
      <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
        {topBar}
        <div className="flex-1 overflow-hidden p-3 relative">
          <button
            onClick={() => setOpsReportId(null)}
            className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded bg-card/90 border border-border hover:bg-card cursor-pointer transition-colors text-sm font-bold tracking-widest text-foreground flex items-center gap-2"
          >
            <Minimize2 size={16} /> BACK TO OPS LOG
          </button>
          <div className="h-full rounded-lg border border-border bg-card shadow-sm overflow-y-auto">
            <ReportDetail report={opsReport} dispositions={dispositions} transfers={transfers} />
          </div>
        </div>
      </div>
    );
  }

  // EXPANDED FULL-PAGE OVERLAY (desktop & tablet)
  if (expandedPanel && viewMode !== 'mobile') {
    // Detail expand → report + map side-by-side (same as ops report view)
    if (expandedPanel === 'detail' && selectedReport) {
      return (
        <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
          {topBar}
          <div className="flex-1 overflow-hidden p-3 relative">
            <button
              onClick={() => setExpandedPanel(null)}
              className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded bg-card/90 border border-border hover:bg-card cursor-pointer transition-colors text-sm font-bold tracking-widest text-foreground flex items-center gap-2"
            >
              <Minimize2 size={16} /> BACK
            </button>
            <div className="h-full rounded-lg border border-border bg-card shadow-sm overflow-y-auto">
              <ReportDetail report={selectedReport} dispositions={dispositions} transfers={transfers} />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
        {topBar}
        <div className="flex-1 overflow-hidden p-3 relative">
          <ExpandButton expanded onClick={() => setExpandedPanel(null)} />
          <div className="h-full rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            {expandedPanel === 'ops' && (
              <OpsLogTab onSelectReport={handleOpsReportSelect} />
            )}
          </div>
        </div>
      </div>
    );
  }

  // DESKTOP
  if (viewMode === 'desktop') {
    return (
      <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
        {topBar}

        <div className={`flex flex-col p-3 gap-3 ${desktopUpperTab !== 'status' ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
          <div className={`rounded-lg border border-border bg-card shadow-sm overflow-hidden ${desktopUpperTab !== 'status' ? 'flex-1 flex flex-col min-h-0' : 'flex-shrink-0'}`}>
            <div className="flex border-b border-border flex-shrink-0">
              {(['ops', 'sla'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDesktopUpperTab(tab)}
                  className="px-4 py-2 text-sm font-bold tracking-widest cursor-pointer"
                  style={{
                    color: desktopUpperTab === tab ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                    borderBottom: desktopUpperTab === tab ? '2px solid hsl(var(--primary))' : '2px solid transparent',
                    background: 'transparent',
                  }}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
            {desktopUpperTab === 'ops' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <CommandStatus
                  todayReports={filteredReports}
                  priorityCounts={filteredPriorityCounts}
                  serviceCounts={filteredServiceCounts}
                  uniqueDevices={uniqueDevices}
                  connected={connected}
                  activeShifts={activeShifts} transfers={transfers}
                />
                <div className="flex-1 overflow-y-auto">
                  <OpsLogTab onSelectReport={handleOpsReportSelect} />
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <UptimeTab />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // TABLET — same tab bar as desktop
  if (viewMode === 'tablet') {
    const tabletTab = desktopUpperTab;
    return (
      <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
        {topBar}

        <div className={`flex flex-col p-2 gap-2 ${tabletTab !== 'status' ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
          <div className={`rounded-lg border border-border bg-card shadow-sm overflow-hidden ${tabletTab !== 'status' ? 'flex-1 flex flex-col min-h-0' : 'flex-shrink-0'}`}>
            <div className="flex border-b border-border flex-shrink-0">
              {(['ops', 'sla'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDesktopUpperTab(tab)}
                  className="px-3 py-2 text-sm font-bold tracking-widest cursor-pointer"
                  style={{
                    color: tabletTab === tab ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                    borderBottom: tabletTab === tab ? '2px solid hsl(var(--primary))' : '2px solid transparent',
                    background: 'transparent',
                  }}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
            {tabletTab === 'ops' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <CommandStatus
                  todayReports={filteredReports}
                  priorityCounts={filteredPriorityCounts}
                  serviceCounts={filteredServiceCounts}
                  uniqueDevices={uniqueDevices}
                  connected={connected}
                  activeShifts={activeShifts} transfers={transfers}
                />
                <div className="flex-1 overflow-y-auto">
                  <OpsLogTab onSelectReport={handleOpsReportSelect} />
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <UptimeTab />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // MOBILE (already full-page tabs, no expand needed)
  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
      {topBar}

      <div className="flex-1 overflow-hidden">
        {mobileTab === 'ops' && (
          <div className="h-full flex flex-col">
            <CommandStatus
              todayReports={filteredReports}
              priorityCounts={filteredPriorityCounts}
              serviceCounts={filteredServiceCounts}
              uniqueDevices={uniqueDevices}
              connected={connected}
              activeShifts={activeShifts} transfers={transfers}
            />
            <div className="flex-1 overflow-y-auto">
              <OpsLogTab onSelectReport={handleOpsReportSelect} />
            </div>
          </div>
        )}
        {mobileTab === 'sla' && (
          <div className="h-full">
            <UptimeTab />
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 border-t border-border bg-card">
        {mobileTabBtn('ops', 'OPS')}
        {mobileTabBtn('sla', 'SLA')}
      </div>
    </div>
  );
}
