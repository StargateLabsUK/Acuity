import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Hospital } from 'lucide-react';
import { TopBar } from '@/components/herald/TopBar';
import { ShiftLinkCode } from '@/components/herald/ShiftLinkCode';
import { BottomNav } from '@/components/herald/BottomNav';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { IncidentsTab } from '@/components/herald/IncidentsTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { clearSession, endShiftRemote, ensureSessionShiftId, leaveShiftRemote, saveSession } from '@/lib/herald-session';
import { clearCachedTrust } from '@/lib/trust-cache';
import { supabase } from '@/integrations/supabase/client';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { useShiftPresence } from '@/hooks/useShiftPresence';
import { useCommandPull } from '@/lib/useCommandPull';
import { getReports, getDispositionsForShift } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import { fetchIncidentsRemote } from '@/lib/herald-api';
import { getDeadLetters, retryDeadLetter, countDeadLetters } from '@/lib/offline-queue';
import type { HeraldReport, CasualtyDisposition } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';

interface HospitalAlert {
  reportId: string;
  callsign: string | null;
  hospital: string;
  incidentNumber: string | null;
  headline: string | null;
}

function toHeraldReport(row: Record<string, unknown>): HeraldReport {
  return {
    ...(row as unknown as HeraldReport),
    assessment: (row.assessment as HeraldReport['assessment']) ?? null,
  };
}

const IncidentsPage = () => {
  const location = useLocation();
  const initialTab = (location.state as any)?.tab === 'reports' ? 'reports' : 'incidents';
  const [activeTab, setActiveTab] = useState<'live' | 'reports' | 'incidents' | 'crew'>(initialTab as any);
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const [fetchOk, setFetchOk] = useState(true);
  const [session, setSession] = useState<HeraldSession | null>(null);
  const [endShiftError, setEndShiftError] = useState('');

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
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const [deadLetterOpen, setDeadLetterOpen] = useState(false);
  const [deadLetters, setDeadLetters] = useState<Array<{
    id?: number;
    type: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>>([]);
  const [retryingDeadLetterId, setRetryingDeadLetterId] = useState<number | null>(null);
  const knownHospitalsRef = useRef<Map<string, string>>(new Map());
  const { syncStatus, queuedCount, triggerSync } = useHeraldSync();
  const { fieldOnline } = useShiftPresence(session?.shift_id ?? session?.callsign, 'crew');
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
        mergedReports.set(r.id as string, toHeraldReport(r));
      }

      const mergedDisps = new Map<string, CasualtyDisposition>();
      for (const row of remoteDisps as any[]) {
        const key = `${row.report_id}-${row.casualty_key}`;
        mergedDisps.set(key, {
          disposition: row.disposition as CasualtyDisposition['disposition'],
          closed_at: row.closed_at,
          patient_id: row.patient_id ?? null,
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

      // Closed casualties can outlive "active incidents"; hydrate any missing parent reports
      // so ePRFs still have full clinical context after handover.
      const missingReportIds = Array.from(
        new Set(
          Array.from(mergedDisps.values())
            .map((d) => d.incident_id)
            .filter((incidentId) => !mergedReports.has(incidentId)),
        ),
      );
      if (missingReportIds.length > 0) {
        const { data: closedReports } = await supabase
          .from('herald_reports')
          .select('*')
          .in('id', missingReportIds);
        for (const reportRow of closedReports ?? []) {
          mergedReports.set(reportRow.id, toHeraldReport(reportRow as unknown as Record<string, unknown>));
        }
      }

      setReports(Array.from(mergedReports.values()));
      setClosedCasualties(Array.from(mergedDisps.values()));
    } catch {
      setFetchOk(false);
      setReports(localReports);
      setClosedCasualties(localDisps);
    }
  }, [session]);

  const refreshDeadLetterSummary = useCallback(async () => {
    const count = await countDeadLetters();
    setDeadLetterCount(count);
  }, []);

  const openDeadLetterReview = useCallback(async () => {
    const items = await getDeadLetters();
    setDeadLetters(items.map((item) => ({
      id: item.id,
      type: item.type,
      attempts: item.attempts,
      lastError: item.lastError,
      createdAt: item.createdAt,
    })));
    setDeadLetterOpen(true);
  }, []);

  const handleRetryDeadLetter = useCallback(async (id: number | undefined) => {
    if (typeof id !== 'number') return;
    setRetryingDeadLetterId(id);
    try {
      await retryDeadLetter(id);
      const items = await getDeadLetters();
      setDeadLetters(items.map((item) => ({
        id: item.id,
        type: item.type,
        attempts: item.attempts,
        lastError: item.lastError,
        createdAt: item.createdAt,
      })));
      await refreshDeadLetterSummary();
    } finally {
      setRetryingDeadLetterId(null);
    }
  }, [refreshDeadLetterSummary]);

  useCommandPull(refreshReports);

  useEffect(() => {
    refreshReports();
  }, [activeTab, session, refreshReports]);

  useEffect(() => {
    refreshDeadLetterSummary();
    const id = setInterval(() => {
      void refreshDeadLetterSummary();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshDeadLetterSummary]);

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
    setEndShiftError('');
    if (session) {
      const ensured = await ensureSessionShiftId(session);
      const targetSession = ensured.session;
      if (targetSession.shift_id) {
        if (targetSession.shift_id !== session.shift_id) {
          setSession(targetSession);
          await saveSession(targetSession);
        }
        const result = await endShiftRemote(targetSession.shift_id);
        if (!result.ok) {
          const openIncidents = result.open_incident_ids?.length ?? 0;
          const transferredPatients = result.outstanding_accepted_transfer_count ?? 0;
          setEndShiftError(
            result.error ??
              `Cannot end shift: ${openIncidents} incident(s) and ${transferredPatients} transferred patient(s) still need disposition.`,
          );
          return;
        }
      }
    }
    clearSession();
    clearCachedTrust();
    setSession(null);
    navigate('/');
  }, [navigate, session]);

  const handleTabChange = useCallback((tab: 'live' | 'reports' | 'incidents' | 'crew') => {
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
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#F5F5F0' }}>
      <TopBar
        syncStatus={!fetchOk ? 'offline' : !fieldOnline ? 'offline' : syncStatus}
        queuedCount={queuedCount}
        deadLetterCount={deadLetterCount}
        onDeadLetterReview={openDeadLetterReview}
        onEndShift={handleEndShift}
        onRefresh={async () => {
          await Promise.all([triggerSync(), refreshReports(), refreshDeadLetterSummary()]);
        }}
      />
      {endShiftError && (
        <div
          className="px-4 py-2"
          style={{ borderBottom: '1px solid rgba(255,59,48,0.2)', background: 'rgba(255,59,48,0.05)' }}
        >
          <p style={{ color: '#FF3B30', fontSize: 13, fontFamily: "'IBM Plex Mono', monospace" }}>
            {endShiftError}
          </p>
        </div>
      )}
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

      {deadLetterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="mx-4 w-full max-w-2xl rounded-xl p-6 max-h-[80vh] overflow-auto" style={{ background: '#F5F5F0', border: '2px solid #FF9500' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-lg font-bold tracking-[0.15em]" style={{ color: '#FF9500' }}>
                DEAD LETTER REVIEW ({deadLetters.length})
              </p>
              <button
                onClick={() => setDeadLetterOpen(false)}
                className="px-3 py-1 rounded border"
                style={{ borderColor: 'rgba(0,0,0,0.2)', color: '#333333' }}
              >
                Close
              </button>
            </div>

            {deadLetters.length === 0 ? (
              <p style={{ color: '#666666' }}>No dead-lettered queue items.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {deadLetters.map((item) => (
                  <div key={item.id ?? `${item.type}-${item.createdAt}`} className="rounded-lg border p-3" style={{ borderColor: 'rgba(255,149,0,0.3)', background: 'rgba(255,149,0,0.07)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold" style={{ color: '#FF9500' }}>{item.type.toUpperCase()}</p>
                        <p style={{ color: '#333333', fontSize: 13 }}>Attempts: {item.attempts}</p>
                        <p style={{ color: '#333333', fontSize: 13 }}>Created: {new Date(item.createdAt).toLocaleString()}</p>
                        {item.lastError && (
                          <p style={{ color: '#FF3B30', fontSize: 13, marginTop: 4 }}>{item.lastError}</p>
                        )}
                      </div>
                      <button
                        onClick={() => void handleRetryDeadLetter(item.id)}
                        disabled={retryingDeadLetterId === item.id}
                        className="px-3 py-2 rounded border"
                        style={{
                          borderColor: '#FF9500',
                          color: '#FF9500',
                          opacity: retryingDeadLetterId === item.id ? 0.6 : 1,
                        }}
                      >
                        {retryingDeadLetterId === item.id ? 'Retrying...' : 'Retry'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
