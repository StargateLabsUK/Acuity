import { useState, useRef, useCallback, useEffect } from 'react';
import * as React from 'react';
import { useHeraldCommand } from '@/hooks/useHeraldCommand';
import { CommandTopBar } from '@/components/command/CommandTopBar';
import { IncomingFeed } from '@/components/command/IncomingFeed';
import { ReportDetail } from '@/components/command/ReportDetail';
import { CommandStatus } from '@/components/command/CommandStatus';
import { MapTab } from '@/components/command/MapTab';
import type { MapTabHandle } from '@/components/command/MapTab';

type MobileTab = 'feed' | 'detail' | 'status' | 'map';
type ViewMode = 'mobile' | 'tablet' | 'desktop';

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

export default function Command() {
  const {
    reports,
    todayReports,
    priorityCounts,
    serviceCounts,
    uniqueDevices,
    connected,
  } = useHeraldCommand();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('feed');
  const viewMode = useViewMode();
  const mapRef = useRef<MapTabHandle>(null);

  const selectedReport = reports.find((r) => r.id === selectedId) ?? null;

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    if (viewMode === 'mobile') setMobileTab('detail');
    // Fly to marker on map
    const report = reports.find((r) => r.id === id);
    if (report && mapRef.current) {
      mapRef.current.flyToReport(report);
    }
  }, [viewMode, reports]);

  const handleMapSelect = useCallback((id: string) => {
    setSelectedId(id);
    if (viewMode === 'mobile') setMobileTab('detail');
  }, [viewMode]);

  const mobileTabBtn = (id: MobileTab, label: string) => {
    const active = mobileTab === id;
    return (
      <button
        onClick={() => setMobileTab(id)}
        className="flex-1 h-12 font-heading text-base font-bold tracking-[0.08em]"
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

  // DESKTOP: status top, then feed | detail | map
  if (viewMode === 'desktop') {
    return (
      <div className="flex flex-col h-screen bg-background">
        <CommandTopBar priorityCounts={priorityCounts} connected={connected} />
        <div className="flex flex-col flex-1 overflow-hidden p-3 gap-3">
          <div className="flex-shrink-0 rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            <CommandStatus
              todayReports={todayReports}
              priorityCounts={priorityCounts}
              serviceCounts={serviceCounts}
              uniqueDevices={uniqueDevices}
              connected={connected}
            />
          </div>
          <div className="flex flex-1 overflow-hidden min-w-0 gap-3">
            <div className="flex flex-col overflow-hidden min-w-0 w-1/3 rounded-lg border border-border bg-card shadow-sm">
              <IncomingFeed reports={reports} selectedId={selectedId} onSelect={handleSelect} />
            </div>
            <div className="flex flex-col overflow-hidden min-w-0 w-1/3">
              <ReportDetail report={selectedReport} />
            </div>
            <div className="flex flex-col overflow-hidden min-w-0 w-1/3 rounded-lg border border-border bg-card shadow-sm">
              <MapTab ref={mapRef} reports={reports} onSelectReport={handleMapSelect} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // TABLET: map top, feed left + detail right below
  if (viewMode === 'tablet') {
    return (
      <div className="flex flex-col h-screen bg-background">
        <CommandTopBar priorityCounts={priorityCounts} connected={connected} />
        <div className="flex flex-col flex-1 overflow-hidden p-2 gap-2">
          {/* Map across the top */}
          <div className="flex-shrink-0 h-[40%] rounded-lg border border-border bg-card shadow-sm overflow-hidden">
            <MapTab ref={mapRef} reports={reports} onSelectReport={handleMapSelect} />
          </div>
          {/* Feed left + Detail right */}
          <div className="flex flex-1 overflow-hidden min-w-0 gap-2">
            <div className="flex flex-col overflow-hidden min-w-0 w-2/5 rounded-lg border border-border bg-card shadow-sm">
              <IncomingFeed reports={reports} selectedId={selectedId} onSelect={handleSelect} />
            </div>
            <div className="flex flex-col overflow-hidden min-w-0 w-3/5">
              <ReportDetail report={selectedReport} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // MOBILE: tabbed layout
  return (
    <div className="flex flex-col h-screen bg-background">
      <CommandTopBar priorityCounts={priorityCounts} connected={connected} />
      <div className="flex-1 overflow-hidden">
        {mobileTab === 'feed' && (
          <div className="h-full p-2">
            <div className="h-full rounded-lg border border-border bg-card shadow-sm overflow-hidden">
              <IncomingFeed reports={reports} selectedId={selectedId} onSelect={handleSelect} />
            </div>
          </div>
        )}
        {mobileTab === 'detail' && <ReportDetail report={selectedReport} />}
        {mobileTab === 'status' && (
          <div className="h-full overflow-y-auto p-2">
            <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
              <CommandStatus
                todayReports={todayReports}
                priorityCounts={priorityCounts}
                serviceCounts={serviceCounts}
                uniqueDevices={uniqueDevices}
                connected={connected}
              />
            </div>
          </div>
        )}
        {mobileTab === 'map' && (
          <div className="h-full">
            <MapTab ref={mapRef} reports={reports} onSelectReport={handleMapSelect} />
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 border-t border-border bg-card">
        {mobileTabBtn('feed', 'FEED')}
        {mobileTabBtn('detail', 'DETAIL')}
        {mobileTabBtn('map', 'MAP')}
        {mobileTabBtn('status', 'STATUS')}
      </div>
    </div>
  );
}
