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
import { getReports, getDispositionsForShift } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import type { HeraldReport } from '@/lib/herald-types';
import type { CasualtyDisposition } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';

const Index = () => {
  const [activeTab, setActiveTab] = useState<'live' | 'reports' | 'incidents'>('live');
  const [aiStatus, setAiStatus] = useState<'ok' | 'error'>('ok');
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const [session, setSession] = useState<HeraldSession | null>(getSession());
  const [incidentRefresh, setIncidentRefresh] = useState(0);
  const [closedCasualties, setClosedCasualties] = useState<CasualtyDisposition[]>([]);
  const syncStatus = useHeraldSync();

  const refreshReports = useCallback(() => {
    setReports(getReports());
    setIncidentRefresh(n => n + 1);
    if (session) {
      setClosedCasualties(getDispositionsForShift(session.callsign, session.session_date));
    }
  }, [session]);

  useCommandPull(refreshReports);

  useEffect(() => {
    setReports(getReports());
    if (session) {
      setClosedCasualties(getDispositionsForShift(session.callsign, session.session_date));
    }
    if (activeTab === 'incidents') setIncidentRefresh(n => n + 1);
  }, [activeTab, session]);

  const handleShiftStarted = useCallback((s: HeraldSession) => {
    setSession(s);
  }, []);

  const handleEndShift = useCallback(() => {
    setSession(null);
  }, []);

  const handleCasualtyClosed = useCallback((_d: CasualtyDisposition) => {
    refreshReports();
  }, [refreshReports]);

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
          <IncidentsTab session={session} onCasualtyClosed={handleCasualtyClosed} refreshKey={incidentRefresh} />
        ) : (
          <ReportsTab closedCasualties={closedCasualties} reports={reports} session={session} />
        )}
      </div>

      {activeTab === 'live' && <ShiftInfoBar session={session} onEndShift={handleEndShift} position="bottom" />}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
