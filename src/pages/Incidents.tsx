import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TopBar } from '@/components/herald/TopBar';
import { ShiftLinkCode } from '@/components/herald/ShiftLinkCode';
import { BottomNav } from '@/components/herald/BottomNav';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { IncidentsTab } from '@/components/herald/IncidentsTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { clearSession, endShiftRemote } from '@/lib/herald-session';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { useCommandPull } from '@/lib/useCommandPull';
import { getReports, getDispositionsForShift } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import { fetchIncidentsRemote } from '@/lib/herald-api';
import type { HeraldReport, CasualtyDisposition } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';

const IncidentsPage = () => {
  const location = useLocation();
  const initialTab = (location.state as any)?.tab === 'reports' ? 'reports' : 'incidents';
  const [activeTab, setActiveTab] = useState<'live' | 'reports' | 'incidents'>(initialTab as any);
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const [session, setSession] = useState<HeraldSession | null>(getSession());
  const [incidentRefresh, setIncidentRefresh] = useState(0);
  const [closedCasualties, setClosedCasualties] = useState<CasualtyDisposition[]>([]);
  const syncStatus = useHeraldSync();
  const navigate = useNavigate();

  const refreshReports = useCallback(async () => {
    const localReports = getReports();
    setIncidentRefresh(n => n + 1);
    if (!session) {
      setReports(localReports);
      return;
    }

    const todayStart = session.session_date + 'T00:00:00.000Z';

    // Get local dispositions first
    const localDisps = getDispositionsForShift(session.callsign, session.session_date);

    try {
      const { reports: remoteReports, dispositions: remoteDisps } = await fetchIncidentsRemote({
        shift_id: session.shift_id,
        trust_id: session.trust_id,
        callsign: session.callsign,
        session_date: session.session_date,
      });

      // Merge local + remote reports for ReportsTab rendering
      const mergedReports = new Map<string, HeraldReport>();
      for (const r of localReports) mergedReports.set(r.id, r);
      for (const r of remoteReports) {
        mergedReports.set(r.id as string, {
          ...(r as unknown as HeraldReport),
          assessment: (r.assessment as unknown as HeraldReport['assessment']) ?? null,
        });
      }
      setReports(Array.from(mergedReports.values()));

      if (remoteDisps.length > 0) {
        const mergedDisps = new Map<string, CasualtyDisposition>();
        for (const row of remoteDisps as any[]) {
          const key = `${row.report_id}-${row.casualty_key}`;
          mergedDisps.set(key, {
            disposition: row.disposition as CasualtyDisposition['disposition'],
            closed_at: row.closed_at,
            casualty_key: row.casualty_key,
            casualty_label: row.casualty_label,
            priority: row.priority,
            incident_id: row.report_id,
            incident_number: row.incident_number,
            session_callsign: row.session_callsign,
            fields: (row.fields as CasualtyDisposition['fields']) ?? {},
          });
        }
        for (const d of localDisps) {
          mergedDisps.set(`${d.incident_id}-${d.casualty_key}`, d);
        }
        setClosedCasualties(Array.from(mergedDisps.values()));
      } else {
        setClosedCasualties(localDisps);
      }
    } catch {
      setReports(localReports);
      setClosedCasualties(localDisps);
    }
  }, [session]);

  useCommandPull(refreshReports);

  useEffect(() => {
    refreshReports();
  }, [activeTab, session, refreshReports]);

  const handleShiftStarted = useCallback((s: HeraldSession) => {
    setSession(s);
  }, []);

  const handleCasualtyClosed = useCallback((_d: CasualtyDisposition) => {
    refreshReports();
  }, [refreshReports]);

  const handleEndShift = useCallback(async () => {
    if (session?.shift_id) {
      await endShiftRemote(session.shift_id);
    }
    clearSession();
    setSession(null);
    navigate('/');
  }, [navigate, session]);

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
      <TopBar micStatus="granted" aiStatus="ok" syncStatus={syncStatus} onEndShift={handleEndShift} />
      <ShiftLinkCode session={session} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'incidents' ? (
          <IncidentsTab session={session} onCasualtyClosed={handleCasualtyClosed} refreshKey={incidentRefresh} />
        ) : (
          <ReportsTab closedCasualties={closedCasualties} reports={reports} session={session} />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} hideTabs={['live']} />
    </div>
  );
};

export default IncidentsPage;
