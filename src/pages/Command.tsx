import { useState } from 'react';
import { useHeraldCommand } from '@/hooks/useHeraldCommand';
import { CommandTopBar } from '@/components/command/CommandTopBar';
import { IncomingFeed } from '@/components/command/IncomingFeed';
import { ReportDetail } from '@/components/command/ReportDetail';
import { CommandStatus } from '@/components/command/CommandStatus';
import { useIsMobile } from '@/hooks/use-mobile';

type MobileTab = 'feed' | 'detail' | 'status';

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
  const isMobile = useIsMobile();

  const selectedReport = reports.find((r) => r.id === selectedId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (isMobile) setMobileTab('detail');
  };

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

  return (
    <div className="flex flex-col h-screen bg-background">
      <CommandTopBar priorityCounts={priorityCounts} connected={connected} />

      {!isMobile ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Status bar across the top */}
          <div className="flex-shrink-0 border-b border-border">
            <CommandStatus
              todayReports={todayReports}
              priorityCounts={priorityCounts}
              serviceCounts={serviceCounts}
              uniqueDevices={uniqueDevices}
              connected={connected}
            />
          </div>

          {/* Feed left, Detail right */}
          <div className="flex flex-1 overflow-hidden min-w-0">
            <div className="flex flex-col overflow-hidden min-w-0 w-1/2 border-r border-border">
              <IncomingFeed reports={reports} selectedId={selectedId} onSelect={handleSelect} />
            </div>

            <div className="flex flex-col overflow-hidden min-w-0 w-1/2">
              <ReportDetail report={selectedReport} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-hidden">
            {mobileTab === 'feed' && (
              <IncomingFeed reports={reports} selectedId={selectedId} onSelect={handleSelect} />
            )}
            {mobileTab === 'detail' && <ReportDetail report={selectedReport} />}
            {mobileTab === 'status' && (
              <CommandStatus
                todayReports={todayReports}
                priorityCounts={priorityCounts}
                serviceCounts={serviceCounts}
                uniqueDevices={uniqueDevices}
                connected={connected}
              />
            )}
          </div>
          <div className="flex flex-shrink-0 border-t border-border bg-card">
            {mobileTabBtn('feed', 'FEED')}
            {mobileTabBtn('detail', 'DETAIL')}
            {mobileTabBtn('status', 'STATUS')}
          </div>
        </>
      )}
    </div>
  );
}
