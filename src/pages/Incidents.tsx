import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TopBar } from '@/components/herald/TopBar';
import { BottomNav } from '@/components/herald/BottomNav';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { IncidentsTab } from '@/components/herald/IncidentsTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { useCommandPull } from '@/lib/useCommandPull';
import { getReports, getDispositionsForShift } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import { supabase } from '@/integrations/supabase/client';
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
    setReports(getReports());
    setIncidentRefresh(n => n + 1);
    if (!session) return;

    // Get local dispositions
    const localDisps = getDispositionsForShift(session.callsign, session.session_date);

    // Also fetch from Supabase as fallback
    try {
      const todayStart = session.session_date + 'T00:00:00.000Z';
      const { data } = await supabase
        .from('casualty_dispositions')
        .select('*')
        .eq('session_callsign', session.callsign)
        .gte('created_at', todayStart);

      if (data && data.length > 0) {
        // Merge: use Supabase data keyed by report_id+casualty_key, overlay with local
        const merged = new Map<string, CasualtyDisposition>();
        for (const row of data) {
          const key = `${row.report_id}-${row.casualty_key}`;
          merged.set(key, {
            disposition: row.disposition as CasualtyDisposition['disposition'],
            closed_at: row.closed_at,
            casualty_key: row.casualty_key,
            casualty_label: row.casualty_label,
            priority: row.priority,
            incident_id: row.report_id,
            incident_number: row.incident_number,
            fields: (row.fields as CasualtyDisposition['fields']) ?? {},
          });
        }
        // Local data takes priority (more recent)
        for (const d of localDisps) {
          merged.set(`${d.incident_id}-${d.casualty_key}`, d);
        }
        setClosedCasualties(Array.from(merged.values()));
      } else {
        setClosedCasualties(localDisps);
      }
    } catch {
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

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} hideTabs={['live']} />
    </div>
  );
};

export default IncidentsPage;
