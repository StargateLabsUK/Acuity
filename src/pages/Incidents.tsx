import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Hospital } from 'lucide-react';
import { TopBar } from '@/components/herald/TopBar';
import { ShiftLinkCode } from '@/components/herald/ShiftLinkCode';
import { BottomNav } from '@/components/herald/BottomNav';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { IncidentsTab } from '@/components/herald/IncidentsTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { clearSession, endShiftRemote, leaveShiftRemote } from '@/lib/herald-session';
import { supabase } from '@/integrations/supabase/client';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { useCommandPull } from '@/lib/useCommandPull';
import { getReports, getDispositionsForShift } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import { fetchIncidentsRemote } from '@/lib/herald-api';
import { supabase } from '@/integrations/supabase/client';
import type { HeraldReport, CasualtyDisposition } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';

interface HospitalAlert {
  reportId: string;
  callsign: string | null;
  hospital: string;
  incidentNumber: string | null;
  headline: string | null;
}

const IncidentsPage = () => {
  const location = useLocation();
  const initialTab = (location.state as any)?.tab === 'reports' ? 'reports' : 'incidents';
  const [activeTab, setActiveTab] = useState<'live' | 'reports' | 'incidents' | 'crew'>(initialTab as any);
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const [fetchOk, setFetchOk] = useState(true);
  const [session, setSession] = useState<HeraldSession | null>(null);

  useEffect(() => {
    // TEST BYPASS: ?bypass=true skips login and injects a test session
    const params = new URLSearchParams(window.location.search);
    if (params.get('bypass') === 'true') {
      setSession({
        service: 'ambulance',
        service_emoji: '🚑',
        callsign: 'TEST-01',
        operator_id: 'TEST',
        station: null,
        session_date: new Date().toISOString().slice(0, 10),
        shift_started: new Date().toISOString(),
      });
      return;
    }
    getSession().then(setSession);
  }, []);
  const [incidentRefresh, setIncidentRefresh] = useState(0);
  const [closedCasualties, setClosedCasualties] = useState<CasualtyDisposition[]>([]);
  const [hospitalAlert, setHospitalAlert] = useState<HospitalAlert | null>(null);
  const knownHospitalsRef = useRef<Map<string, string>>(new Map());
  const { syncStatus, queuedCount } = useHeraldSync();
  const navigate = useNavigate();

  // Seed known hospitals from initial data so we don't alert on load
  useEffect(() => {
    for (const r of reports) {
      if ((r as any).receiving_hospital) {
        knownHospitalsRef.current.set(r.id, (r as any).receiving_hospital);
      }
    }
  }, [reports]);

  const refreshReports = useCallback(async () => {
    const localReports = await getReports();
    setIncidentRefresh(n => n + 1);
    if (!session) {
      setReports(localReports);
      return;
    }

    const todayStart = session.session_date + 'T00:00:00.000Z';

    // Get local dispositions first
    const localDisps = await getDispositionsForShift(session.callsign, session.session_date);

    try {
      const { reports: remoteReports, dispositions: remoteDisps } = await fetchIncidentsRemote({
        shift_id: session.shift_id,
        trust_id: session.trust_id,
        callsign: session.callsign,
        session_date: session.session_date,
      });
      setFetchOk(true);

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
      setFetchOk(false);
      setReports(localReports);
      setClosedCasualties(localDisps);
    }
  }, [session]);

  useCommandPull(refreshReports);

  useEffect(() => {
    refreshReports();
  }, [activeTab, session, refreshReports]);

  // Realtime subscription for disposition changes + hospital assignments
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`crew-realtime-${session.shift_id ?? session.callsign}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'casualty_dispositions' },
        () => { refreshReports(); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'herald_reports' },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;

          // Only alert for reports belonging to this crew's shift
          const isOurs = row.session_callsign === session.callsign ||
            row.shift_id === session.shift_id;
          if (!isOurs) return;

          const newHospital = row.receiving_hospital?.trim();
          if (!newHospital) return;

          const prev = knownHospitalsRef.current.get(row.id);
          if (prev === newHospital) return;

          // New or changed hospital assignment
          knownHospitalsRef.current.set(row.id, newHospital);
          setHospitalAlert({
            reportId: row.id,
            callsign: row.session_callsign,
            hospital: newHospital,
            incidentNumber: row.incident_number,
            headline: row.headline,
          });

          refreshReports();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session, refreshReports]);

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
    navigate('/fieldapp');
  }, [navigate, session]);

  const handleTabChange = useCallback((tab: 'live' | 'reports' | 'incidents' | 'crew') => {
    if (tab === 'live') {
      navigate('/fieldapp');
    } else {
      setActiveTab(tab);
    }
  }, [navigate]);

  if (!session) {
    return <ShiftLogin onShiftStarted={handleShiftStarted} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#F5F5F0' }}>
      <TopBar syncStatus={fetchOk ? syncStatus : 'offline'} queuedCount={queuedCount} onEndShift={handleEndShift} />
      <ShiftLinkCode session={session} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'incidents' ? (
          <IncidentsTab session={session} onCasualtyClosed={handleCasualtyClosed} refreshKey={incidentRefresh} />
        ) : activeTab === 'crew' ? (
          <CrewTab session={session} />
        ) : (
          <ReportsTab closedCasualties={closedCasualties} reports={reports} session={session} />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={handleTabChange} hideTabs={['live']} />

      {/* Hospital assignment alert overlay */}
      {hospitalAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="mx-4 w-full max-w-md rounded-xl p-6"
            style={{ background: '#F5F5F0', border: '2px solid #1E90FF' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-full p-3" style={{ background: 'rgba(30,144,255,0.15)' }}>
                <Hospital size={28} style={{ color: '#1E90FF' }} />
              </div>
              <div>
                <p className="text-lg font-bold tracking-wider" style={{ color: '#1E90FF' }}>
                  HOSPITAL ASSIGNED
                </p>
                <p className="text-lg text-foreground opacity-60">
                  {hospitalAlert.incidentNumber
                    ? `Incident ${hospitalAlert.incidentNumber}`
                    : hospitalAlert.headline ?? 'Active incident'}
                </p>
              </div>
            </div>

            <div className="rounded-lg p-4 mb-4"
              style={{ background: 'rgba(30,144,255,0.08)', border: '1px solid rgba(30,144,255,0.25)' }}>
              <p className="text-lg text-foreground opacity-60 mb-1">Receiving Hospital</p>
              <p className="text-2xl font-bold text-foreground">{hospitalAlert.hospital}</p>
            </div>

            <button
              onClick={() => setHospitalAlert(null)}
              className="w-full py-3 text-lg font-bold rounded-lg tracking-wider"
              style={{
                background: 'rgba(30,144,255,0.12)',
                border: '2px solid #1E90FF',
                color: '#1E90FF',
              }}>
              ACKNOWLEDGED
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function CrewTab({ session }: { session: import('@/lib/herald-session').HeraldSession }) {
  const [crew, setCrew] = useState<{ operator_id: string | null; used_at: string | null; left_at: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCrew = useCallback(async () => {
    if (!session.shift_id) return;
    try {
      const { data } = await supabase
        .from('shift_link_codes')
        .select('operator_id, used_at, left_at')
        .eq('shift_id', session.shift_id)
        .not('used_at', 'is', null)
        .not('operator_id', 'is', null);
      setCrew((data ?? []) as any);
    } catch { /* silent */ }
    setLoading(false);
  }, [session.shift_id]);

  useEffect(() => {
    fetchCrew();
    const id = setInterval(fetchCrew, 15000);
    return () => clearInterval(id);
  }, [fetchCrew]);

  const handleRemoveCrew = async (operatorId: string) => {
    if (!session.shift_id) return;
    await leaveShiftRemote(session.shift_id, operatorId);
    fetchCrew();
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <p style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2em', color: '#666666', marginBottom: 16 }}>
        CREW ON SHIFT ({crew.filter(c => !c.left_at).length})
      </p>

      {loading ? (
        <p style={{ color: '#666666', fontSize: 14 }}>Loading...</p>
      ) : crew.length === 0 ? (
        <p style={{ color: '#666666', fontSize: 14 }}>No crew members linked yet. Share the link code above.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {crew.map((c, i) => {
            const isActive = !c.left_at;
            return (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg border"
                style={{
                  background: isActive ? 'rgba(5,150,105,0.04)' : 'rgba(136,136,136,0.04)',
                  borderColor: isActive ? 'rgba(5,150,105,0.15)' : 'rgba(136,136,136,0.15)',
                }}>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 700, color: isActive ? '#FFFFFF' : '#888' }}>
                    {c.operator_id || 'Unknown'}
                  </p>
                  <p style={{ fontSize: 12, color: '#666666' }}>
                    {isActive ? 'Active' : 'Left shift'}
                    {c.used_at ? ` · joined ${new Date(c.used_at).toLocaleTimeString()}` : ''}
                  </p>
                </div>
                {isActive && (
                  <button
                    onClick={() => c.operator_id && handleRemoveCrew(c.operator_id)}
                    style={{
                      padding: '6px 16px',
                      background: 'transparent',
                      border: '1px solid rgba(255,149,0,0.4)',
                      color: '#FF9500',
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}
                  >
                    REMOVE
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default IncidentsPage;
