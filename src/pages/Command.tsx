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
        className="flex-1 h-12 font-heading"
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: active ? '#3DFF8C' : '#FFFFFF',
          borderTop: active ? '2px solid #3DFF8C' : '2px solid transparent',
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
        <div className="flex flex-1 overflow-hidden">
          <div
            className="flex flex-col overflow-hidden"
            style={{ width: '35%', borderRight: '1px solid hsl(var(--border))' }}
          >
            <IncomingFeed reports={reports} selectedId={selectedId} onSelect={handleSelect} />
          </div>

          <div
            className="flex flex-col overflow-hidden"
            style={{ width: '40%', borderRight: '1px solid hsl(var(--border))' }}
          >
            <ReportDetail report={selectedReport} />
          </div>

          <div className="flex flex-col overflow-hidden" style={{ width: '25%' }}>
            <CommandStatus
              todayReports={todayReports}
              priorityCounts={priorityCounts}
              serviceCounts={serviceCounts}
              uniqueDevices={uniqueDevices}
              connected={connected}
            />
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
          <div className="flex flex-shrink-0" style={{ borderTop: '1px solid #0F1820', background: '#0D1117' }}>
            {mobileTabBtn('feed', 'FEED')}
            {mobileTabBtn('detail', 'DETAIL')}
            {mobileTabBtn('status', 'STATUS')}
          </div>
        </>
      )}
    </div>
  );
}
