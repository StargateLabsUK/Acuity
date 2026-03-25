import { useState, useCallback } from 'react';
import { TopBar } from '@/components/herald/TopBar';
import { LiveTab } from '@/components/herald/LiveTab';
import { ShiftLogin } from '@/components/herald/ShiftLogin';
import { ShiftInfoBar } from '@/components/herald/ShiftInfoBar';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { getSession } from '@/lib/herald-session';
import type { HeraldSession } from '@/lib/herald-session';

const Index = () => {
  const [aiStatus, setAiStatus] = useState<'ok' | 'error'>('ok');
  const [session, setSession] = useState<HeraldSession | null>(getSession());
  const syncStatus = useHeraldSync();
  const navigate = useNavigate();

  const handleShiftStarted = useCallback((s: HeraldSession) => {
    setSession(s);
  }, []);

  const handleEndShift = useCallback(() => {
    setSession(null);
  }, []);

  const handleTabChange = useCallback((tab: 'live' | 'reports' | 'incidents') => {
    if (tab === 'live') return;
    navigate('/incidents', { state: { tab } });
  }, [navigate]);

  if (!session) {
    return <ShiftLogin onShiftStarted={handleShiftStarted} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#1A1E24' }}>
      <TopBar micStatus="granted" aiStatus={aiStatus} syncStatus={syncStatus} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <LiveTab onAiStatus={setAiStatus} onReportSaved={() => {}} />
      </div>

      <ShiftInfoBar session={session} onEndShift={handleEndShift} position="bottom" />
    </div>
  );
};

export default Index;
