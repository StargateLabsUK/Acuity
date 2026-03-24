import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useHeraldCommand } from '@/hooks/useHeraldCommand';
import { CommandTopBar } from '@/components/command/CommandTopBar';
import { IncomingFeed } from '@/components/command/IncomingFeed';
import { ReportDetail } from '@/components/command/ReportDetail';
import { CommandStatus } from '@/components/command/CommandStatus';
import { MapTab } from '@/components/command/MapTab';
import { TrainingTab } from '@/components/command/TrainingTab';
import { OpsLogTab } from '@/components/command/OpsLogTab';
import { UptimeTab } from '@/components/command/UptimeTab';
import type { MapTabHandle } from '@/components/command/MapTab';

type MobileTab = 'feed' | 'detail' | 'status' | 'map' | 'training' | 'ops' | 'sla';
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
  const {
    reports,
    todayReports,
    priorityCounts,
    serviceCounts,
    uniqueDevices,
    connected,
    activeShifts,
  } = useHeraldCommand();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('feed');
  const [filters] = useState({ service: '', callsign: '', timeRange: 'today' as const });
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);
  const [desktopUpperTab, setDesktopUpperTab] = useState<'status' | 'ops' | 'sla' | 'map'>('status');
  const [opsReportId, setOpsReportId] = useState<string | null>(null);
  const viewMode = useViewMode();
  const mapRef = useRef<MapTabHandle>(null);

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

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    if (viewMode === 'mobile') setMobileTab('detail');
    const report = filteredReports.find((r) => r.id === id);
    if (report && mapRef.current) {
      mapRef.current.flyToReport(report);
    }
  }, [viewMode, filteredReports]);

  const handleMapSelect = useCallback((id: string) => {
    setSelectedId(id);
    if (viewMode === 'mobile') setMobileTab('detail');
  }, [viewMode]);

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

  const topBar = <CommandTopBar priorityCounts={priorityCounts} connected={connected} />;

  // OPS LOG REPORT DETAIL — full page with report + map
  if (opsReport) {
    const singleReports = [opsReport];
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
          <div className="flex h-full gap-3">
            <div className="flex-1 rounded-lg border border-border bg-card shadow-sm overflow-y-auto">
              <ReportDetail report={opsReport} />
            </div>
            <div className="w-2/5 rounded-lg border border-border bg-card shadow-sm overflow-hidden">
              <MapTab reports={singleReports} onSelectReport={() => {}} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // EXPANDED FULL-PAGE OVERLAY (desktop & tablet)
  if (expandedPanel && viewMode !== 'mobile') {
    return (
      <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
        {topBar}
        <div className="flex-1 overflow-hidden p-3 relative">
          <ExpandButton expanded onClick={() => setExpandedPanel(null)} />
          <div className="h-full rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            {expandedPanel === 'feed' && (
              <IncomingFeed reports={filteredReports} selectedId={selectedId} onSelect={handleSelect} />
            )}
            {expandedPanel === 'detail' && selectedReport && (
              <>
                <button
                  onClick={() => setExpandedPanel(null)}
                  className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded bg-card/90 border border-border hover:bg-card cursor-pointer transition-colors text-sm font-bold tracking-widest text-foreground flex items-center gap-2"
                >
                  <Minimize2 size={16} /> BACK
                </button>
                <div className="flex h-full gap-3">
                  <div className="flex-1 rounded-lg border border-border bg-card shadow-sm overflow-y-auto">
                    <ReportDetail report={selectedReport} />
                  </div>
                  <div className="w-2/5 rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                    <MapTab reports={[selectedReport]} onSelectReport={() => {}} />
                  </div>
                </div>
              </>
            )}
            {expandedPanel === 'detail' && !selectedReport && (
              <div className="h-full overflow-y-auto">
                <ReportDetail report={null} />
              </div>
            )}
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
      <div className="flex flex-col" style={{ background: 'var(--herald-command-bg)' }}>
        {topBar}

        <div className="flex flex-col p-3 gap-3">
          <div className={`rounded-lg border border-border bg-card shadow-sm overflow-hidden ${desktopUpperTab !== 'status' ? 'min-h-[80vh] flex flex-col' : 'flex-shrink-0'}`}>
            <div className="flex border-b border-border flex-shrink-0">
              {(['status', 'map', 'ops', 'sla'] as const).map((tab) => (
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
            {desktopUpperTab === 'status' ? (
              <CommandStatus
                todayReports={filteredReports}
                priorityCounts={filteredPriorityCounts}
                serviceCounts={filteredServiceCounts}
                uniqueDevices={uniqueDevices}
                connected={connected}
                activeShifts={activeShifts}
              />
            ) : desktopUpperTab === 'map' ? (
              <div className="flex-1 overflow-hidden h-full min-h-0">
                <MapTab ref={mapRef} reports={filteredReports} onSelectReport={handleMapSelect} />
              </div>
            ) : desktopUpperTab === 'ops' ? (
              <div className="flex-1 overflow-y-auto">
                <OpsLogTab onSelectReport={handleOpsReportSelect} />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <UptimeTab />
              </div>
            )}
          </div>
          {desktopUpperTab === 'status' && (
          <div className="flex min-w-0 gap-3">
            <div className="relative flex flex-col min-w-0 w-1/2 rounded-lg border border-border bg-card shadow-sm">
              <ExpandButton expanded={false} onClick={() => toggleExpand('feed')} />
              <IncomingFeed reports={filteredReports} selectedId={selectedId} onSelect={handleSelect} />
            </div>
            <div className="relative flex flex-col min-w-0 w-1/2">
              <ExpandButton expanded={false} onClick={() => toggleExpand('detail')} />
              <ReportDetail report={selectedReport} />
            </div>
          </div>
          )}
        </div>
      </div>
    );
  }

  // TABLET — same tab bar as desktop
  if (viewMode === 'tablet') {
    const tabletTab = desktopUpperTab;
    return (
      <div className="flex flex-col" style={{ background: 'var(--herald-command-bg)' }}>
        {topBar}

        <div className="flex flex-col p-2 gap-2">
          <div className={`rounded-lg border border-border bg-card shadow-sm overflow-hidden ${tabletTab !== 'status' ? 'min-h-[80vh] flex flex-col' : 'flex-shrink-0'}`}>
            <div className="flex border-b border-border flex-shrink-0">
              {(['status', 'map', 'ops', 'sla'] as const).map((tab) => (
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
            {tabletTab === 'status' ? (
              <CommandStatus
                todayReports={filteredReports}
                priorityCounts={filteredPriorityCounts}
                serviceCounts={filteredServiceCounts}
                uniqueDevices={uniqueDevices}
                connected={connected}
                activeShifts={activeShifts}
              />
            ) : tabletTab === 'map' ? (
              <div className="flex-1 overflow-hidden h-full min-h-0">
                <MapTab ref={mapRef} reports={filteredReports} onSelectReport={handleMapSelect} />
              </div>
            ) : tabletTab === 'ops' ? (
              <div className="flex-1 overflow-y-auto">
                <OpsLogTab onSelectReport={handleOpsReportSelect} />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <UptimeTab />
              </div>
            )}
          </div>
          {tabletTab === 'status' && (
          <div className="flex min-w-0 gap-2">
            <div className="relative flex flex-col min-w-0 w-2/5 rounded-lg border border-border bg-card shadow-sm">
              <ExpandButton expanded={false} onClick={() => toggleExpand('feed')} />
              <IncomingFeed reports={filteredReports} selectedId={selectedId} onSelect={handleSelect} />
            </div>
            <div className="relative flex flex-col min-w-0 w-3/5">
              <ExpandButton expanded={false} onClick={() => toggleExpand('detail')} />
              <ReportDetail report={selectedReport} />
            </div>
          </div>
          )}
        </div>
      </div>
    );
  }

  // MOBILE (already full-page tabs, no expand needed)
  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--herald-command-bg)' }}>
      {topBar}

      <div className="flex-1 overflow-hidden">
        {mobileTab === 'feed' && (
          <div className="h-full p-2">
            <div className="h-full rounded-lg border border-border bg-card shadow-sm overflow-hidden">
              <IncomingFeed reports={filteredReports} selectedId={selectedId} onSelect={handleSelect} />
            </div>
          </div>
        )}
        {mobileTab === 'detail' && <ReportDetail report={selectedReport} />}
        {mobileTab === 'status' && (
          <div className="h-full overflow-y-auto p-2">
            <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
              <CommandStatus
                todayReports={filteredReports}
                priorityCounts={filteredPriorityCounts}
                serviceCounts={filteredServiceCounts}
                uniqueDevices={uniqueDevices}
                connected={connected}
                activeShifts={activeShifts}
              />
            </div>
          </div>
        )}
        {mobileTab === 'map' && (
          <div className="h-full">
            <MapTab ref={mapRef} reports={filteredReports} onSelectReport={handleMapSelect} />
          </div>
        )}
        {mobileTab === 'training' && (
          <div className="h-full">
            <TrainingTab reports={filteredReports} />
          </div>
        )}
        {mobileTab === 'ops' && (
          <div className="h-full">
            <OpsLogTab onSelectReport={handleOpsReportSelect} />
          </div>
        )}
        {mobileTab === 'sla' && (
          <div className="h-full">
            <UptimeTab />
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 border-t border-border bg-card">
        {mobileTabBtn('feed', 'FEED')}
        {mobileTabBtn('detail', 'DETAIL')}
        {mobileTabBtn('map', 'MAP')}
      </div>
    </div>
  );
}
