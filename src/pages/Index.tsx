import { useState, useCallback, useEffect } from 'react';
import { TopBar } from '@/components/herald/TopBar';
import { BottomNav } from '@/components/herald/BottomNav';
import { LiveTab } from '@/components/herald/LiveTab';
import { ReportsTab } from '@/components/herald/ReportsTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { ShiftInfoBar } from '@/components/herald/ShiftInfoBar';
import { AuthScreen } from '@/components/herald/AuthScreen';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { useAuth } from '@/hooks/useAuth';
import { getReports } from '@/lib/herald-storage';
import { getSession } from '@/lib/herald-session';
import type { HeraldReport } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';

const Index = () => {
  const { session: authSession, user, loading: authLoading, signIn, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'live' | 'reports'>('live');
  const [aiStatus, setAiStatus] = useState<'ok' | 'error'>('ok');
  const [reports, setReports] = useState<HeraldReport[]>([]);
  const [session, setSession] = useState<HeraldSession | null>(getSession());
  const syncStatus = useHeraldSync();

  useEffect(() => {
    setReports(getReports());
  }, [activeTab]);

  const refreshReports = useCallback(() => {
    setReports(getReports());
  }, []);

  const handleShiftStarted = useCallback((s: HeraldSession) => {
    setSession(s);
  }, []);

  const handleEndShift = useCallback(() => {
    setSession(null);
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setSession(null);
  }, [signOut]);

  // Filter reports to current session
  const sessionReports = session
    ? reports.filter(
        (r) =>
          r.session_callsign === session.callsign &&
          new Date(r.timestamp).toISOString().slice(0, 10) === session.session_date
      )
    : reports;

  // Auth loading
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#080B10' }}>
        <div
          className="animate-spin-herald rounded-full"
          style={{ width: 32, height: 32, border: '2px solid #0F1820', borderTopColor: '#3DFF8C' }}
        />
      </div>
    );
  }

  // Not authenticated
  if (!authSession || !user) {
    return <AuthScreen variant="field" onSignIn={signIn} />;
  }

  // No active shift — show shift login
  if (!session) {
    return <ShiftLogin onShiftStarted={handleShiftStarted} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#1A1E24' }}>
      <TopBar micStatus="granted" aiStatus={aiStatus} syncStatus={syncStatus} />

      {activeTab === 'live' && <ShiftInfoBar session={session} onEndShift={handleEndShift} onSignOut={handleSignOut} position="bottom" />}

      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'live' ? (
          <LiveTab
            onAiStatus={setAiStatus}
            onReportSaved={refreshReports}
          />
        ) : (
          <ReportsTab reports={sessionReports} session={session} />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
