import { useState, useCallback, useEffect } from 'react';
import { TopBar } from '@/components/herald/TopBar';
import { LiveTab } from '@/components/herald/LiveTab';
import { ShiftInfoBar } from '@/components/herald/ShiftInfoBar';
import { LinkCodeEntry } from '@/components/herald/LinkCodeEntry';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { countDeadLetters } from '@/lib/offline-queue';
import { useShiftEndedPoll } from '@/hooks/useShiftEndedPoll';
import { useShiftPresence } from '@/hooks/useShiftPresence';
import { getSession } from '@/lib/herald-session';
import type { HeraldSession } from '@/lib/herald-session';

const Index = () => {
  const [aiStatus, setAiStatus] = useState<'ok' | 'error'>('ok');
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
    getSession().then(s => {
      if (s && s.operator_id) {
        setSession(s);
      } else {
        setSession(null);
      }
    });
  }, []);
  const { syncStatus, queuedCount, triggerSync } = useHeraldSync();
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  // Join shift presence so crew page can see this device is online
  useShiftPresence(session?.shift_id ?? session?.callsign, 'field');

  const handleShiftLinked = useCallback((s: HeraldSession) => {
    setSession(s);
  }, []);

  const handleEndShift = useCallback(() => {
    setSession(null);
  }, []);

  useShiftEndedPoll(handleEndShift);

  useEffect(() => {
    const refresh = async () => {
      setDeadLetterCount(await countDeadLetters());
    };
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  if (!session) {
    return <LinkCodeEntry onShiftLinked={handleShiftLinked} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#F5F5F0' }}>
      <TopBar
        micStatus="granted"
        aiStatus={aiStatus}
        syncStatus={syncStatus}
        queuedCount={queuedCount}
        deadLetterCount={deadLetterCount}
        onRefresh={async () => {
          await Promise.all([triggerSync(), getSession().then(setSession)]);
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <LiveTab onAiStatus={setAiStatus} onReportSaved={() => {}} autoSend queuedCount={queuedCount} />
      </div>

      <ShiftInfoBar session={session} onEndShift={handleEndShift} position="bottom" isLinkedDevice={true} />
    </div>
  );
};

export default Index;
