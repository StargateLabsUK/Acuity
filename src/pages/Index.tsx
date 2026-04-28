import { useState, useCallback, useEffect } from 'react';
import { TopBar } from '@/components/herald/TopBar';
import { LiveTab } from '@/components/herald/LiveTab';
import { ShiftInfoBar } from '@/components/herald/ShiftInfoBar';
import { LinkCodeEntry } from '@/components/herald/LinkCodeEntry';
import { useHeraldSync } from '@/hooks/useHeraldSync';
import { countDeadLetters, getAll, getDeadLetters, retryDeadLetter, remove } from '@/lib/offline-queue';
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
    getSession().then((s) => {
      // Accept any valid session. Operator ID can be null on trust-managed flows.
      setSession(s ?? null);
    });
  }, []);
  const { syncStatus, queuedCount, triggerSync } = useHeraldSync();
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const [queueReviewOpen, setQueueReviewOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState<Array<{
    id?: number;
    type: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>>([]);
  const [deadLetters, setDeadLetters] = useState<Array<{
    id?: number;
    type: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>>([]);
  const [retryingDeadLetterId, setRetryingDeadLetterId] = useState<number | null>(null);
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

  const openQueueReview = useCallback(async () => {
    const [allItems, dlItems] = await Promise.all([getAll(), getDeadLetters()]);
    const deadLetterIds = new Set(dlItems.map((item) => item.id).filter((id): id is number => typeof id === 'number'));
    setPendingItems(
      allItems
        .filter((item) => !(typeof item.id === 'number' && deadLetterIds.has(item.id)))
        .map((item) => ({
          id: item.id,
          type: item.type,
          attempts: item.attempts,
          lastError: item.lastError,
          createdAt: item.createdAt,
        }))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    );
    setDeadLetters(
      dlItems.map((item) => ({
        id: item.id,
        type: item.type,
        attempts: item.attempts,
        lastError: item.lastError,
        createdAt: item.createdAt,
      })),
    );
    setQueueReviewOpen(true);
  }, []);

  const handleRetryDeadLetter = useCallback(async (id: number | undefined) => {
    if (typeof id !== 'number') return;
    setRetryingDeadLetterId(id);
    try {
      await retryDeadLetter(id);
      await openQueueReview();
      setDeadLetterCount(await countDeadLetters());
    } finally {
      setRetryingDeadLetterId(null);
    }
  }, [openQueueReview]);

  const handleDismissDeadLetter = useCallback(async (id: number | undefined) => {
    if (typeof id !== 'number') return;
    await remove(id);
    await openQueueReview();
    setDeadLetterCount(await countDeadLetters());
  }, [openQueueReview]);

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
        onQueueReview={openQueueReview}
        onDeadLetterReview={openQueueReview}
        onRefresh={async () => {
          await Promise.all([triggerSync(), getSession().then(setSession)]);
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <LiveTab onAiStatus={setAiStatus} onReportSaved={() => {}} autoSend queuedCount={queuedCount} />
      </div>

      <ShiftInfoBar session={session} onEndShift={handleEndShift} position="bottom" isLinkedDevice={true} />

      {queueReviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="mx-4 w-full max-w-2xl rounded-xl p-6 max-h-[80vh] overflow-auto" style={{ background: '#F5F5F0', border: '2px solid #FF9500' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-lg font-bold tracking-[0.15em]" style={{ color: '#FF9500' }}>
                QUEUE REVIEW ({pendingItems.length} pending, {deadLetters.length} dead-letter)
              </p>
              <button
                onClick={() => setQueueReviewOpen(false)}
                className="px-3 py-1 rounded border"
                style={{ borderColor: 'rgba(0,0,0,0.2)', color: '#333333' }}
              >
                Close
              </button>
            </div>

            <div className="mb-5">
              <p className="font-bold mb-2" style={{ color: '#FF9500' }}>PENDING</p>
              {pendingItems.length === 0 ? (
                <p style={{ color: '#666666' }}>No pending queue items.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {pendingItems.map((item) => (
                    <div key={item.id ?? `${item.type}-${item.createdAt}`} className="rounded-lg border p-3" style={{ borderColor: 'rgba(255,149,0,0.3)', background: 'rgba(255,149,0,0.07)' }}>
                      <p className="font-bold" style={{ color: '#FF9500' }}>{item.type.toUpperCase()}</p>
                      <p style={{ color: '#333333', fontSize: 13 }}>Attempts: {item.attempts}</p>
                      <p style={{ color: '#333333', fontSize: 13 }}>Created: {new Date(item.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="font-bold mb-2" style={{ color: '#FF3B30' }}>DEAD LETTER</p>
              {deadLetters.length === 0 ? (
                <p style={{ color: '#666666' }}>No dead-lettered queue items.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {deadLetters.map((item) => (
                    <div key={item.id ?? `${item.type}-${item.createdAt}`} className="rounded-lg border p-3" style={{ borderColor: 'rgba(255,59,48,0.3)', background: 'rgba(255,59,48,0.07)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-bold" style={{ color: '#FF3B30' }}>{item.type.toUpperCase()}</p>
                          <p style={{ color: '#333333', fontSize: 13 }}>Attempts: {item.attempts}</p>
                          <p style={{ color: '#333333', fontSize: 13 }}>Created: {new Date(item.createdAt).toLocaleString()}</p>
                          {item.lastError && (
                            <p style={{ color: '#FF3B30', fontSize: 13, marginTop: 4 }}>{item.lastError}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void handleRetryDeadLetter(item.id)}
                            disabled={retryingDeadLetterId === item.id}
                            className="px-3 py-2 rounded border"
                            style={{
                              borderColor: '#FF3B30',
                              color: '#FF3B30',
                              opacity: retryingDeadLetterId === item.id ? 0.6 : 1,
                            }}
                          >
                            {retryingDeadLetterId === item.id ? 'Retrying...' : 'Retry'}
                          </button>
                          <button
                            onClick={() => void handleDismissDeadLetter(item.id)}
                            disabled={retryingDeadLetterId === item.id}
                            className="px-3 py-2 rounded border"
                            style={{
                              borderColor: 'rgba(0,0,0,0.25)',
                              color: '#333333',
                              opacity: retryingDeadLetterId === item.id ? 0.6 : 1,
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
