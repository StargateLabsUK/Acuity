import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/herald/TopBar';
import { BottomNav } from '@/components/herald/BottomNav';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { IncidentsTab } from '@/components/herald/IncidentsTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { useCommandPull } from '@/lib/useCommandPull';
import { getReports, getDispositionsForShift } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import type { HeraldReport, CasualtyDisposition } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';

const IncidentsPage = () => {
  const [activeTab, setActiveTab] = useState<'live' | 'reports' | 'incidents'>('incidents');
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const [session, setSession] = useState<HeraldSession | null>(getSession());
  const [incidentRefresh, setIncidentRefresh] = useState(0);
  const [closedCasualties, setClosedCasualties] = useState<CasualtyDisposition[]>([]);
  const syncStatus = useHeraldSync();
  const navigate = useNavigate();

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
  }, [activeTab, session]);

  const handleShiftStarted = useCallback((s: HeraldSession) => {
    setSession(s);
  }, []);

  const handleCasualtyClosed = useCallback((_d: CasualtyDisposition) => {
    refreshReports();
  }, [refreshReports]);

  const handleTabChange = useCallback((tab: 'live' | 'reports' | 'incidents') => {
    if (tab === 'live') {
      navigate('/');
    } else {
      setActiveTab(tab);
    }
  }, [navigate]);

  if (!session) {
    return <ShiftLogin onShiftStarted={handleShiftStarted} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#1A1E24' }}>
      <TopBar micStatus="granted" aiStatus="ok" syncStatus={syncStatus} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'incidents' ? (
          <IncidentsTab session={session} onCasualtyClosed={handleCasualtyClosed} refreshKey={incidentRefresh} />
        ) : (
          <ReportsTab closedCasualties={closedCasualties} reports={reports} session={session} />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
};

export default IncidentsPage;
