import { useState, useCallback, useEffect } from 'react';
import { TopBar } from '@/components/herald/TopBar';
import { BottomNav } from '@/components/herald/BottomNav';
import { LiveTab } from '@/components/herald/LiveTab';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { IncidentsTab } from '@/components/herald/IncidentsTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { ShiftInfoBar } from '@/components/herald/ShiftInfoBar';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { useCommandPull } from '@/lib/useCommandPull';
import { getReports } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import type { HeraldReport } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';

const Index = () => {
  const [activeTab, setActiveTab] = useState<'live' | 'reports' | 'incidents'>('live');
  const [aiStatus, setAiStatus] = useState<'ok' | 'error'>('ok');
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const [session, setSession] = useState<HeraldSession | null>(getSession());
  const syncStatus = useHeraldSync();

  const refreshReports = useCallback(() => {
    setReports(getReports());
  }, []);

  useCommandPull(refreshReports);

  useEffect(() => {
    setReports(getReports());
  }, [activeTab]);

  const handleShiftStarted = useCallback((s: HeraldSession) => {
    setSession(s);
  }, []);

  const handleEndShift = useCallback(() => {
    setSession(null);
  }, []);

  const handleCloseIncident = useCallback((_id: string, _num: string | null) => {
    refreshReports();
  }, [refreshReports]);

  // Filter reports to current session
  const sessionReports = session
    ? reports.filter(
        (r) =>
          r.session_callsign === session.callsign &&
          new Date(r.timestamp).toISOString().slice(0, 10) === session.session_date
      )
    : reports;

  // Only closed incidents go to Reports tab
  const closedReports = sessionReports.filter((r) => r.status === 'closed');

  // No active session — show shift login
  if (!session) {
    return <ShiftLogin onShiftStarted={handleShiftStarted} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#1A1E24' }}>
      <TopBar micStatus="granted" aiStatus={aiStatus} syncStatus={syncStatus} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'live' ? (
          <LiveTab
            onAiStatus={setAiStatus}
            onReportSaved={refreshReports}
          />
        ) : activeTab === 'incidents' ? (
          <IncidentsTab session={session} onCloseIncident={handleCloseIncident} />
        ) : (
          <ReportsTab reports={sessionReports} session={session} />
        )}
      </div>

      {activeTab === 'live' && <ShiftInfoBar session={session} onEndShift={handleEndShift} position="bottom" />}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
