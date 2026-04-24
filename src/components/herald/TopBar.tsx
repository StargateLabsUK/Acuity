import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface TopBarProps {
  micStatus?: 'pending' | 'granted' | 'denied';
  aiStatus?: 'ok' | 'error';
  syncStatus: 'ok' | 'error' | 'offline';
  queuedCount?: number;
  deadLetterCount?: number;
  onEndShift?: () => void;
  onRefresh?: () => void;
}

export function TopBar({ micStatus, aiStatus, syncStatus, queuedCount, deadLetterCount, onEndShift, onRefresh }: TopBarProps) {
  const [utc, setUtc] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setUtc(
        now.getUTCHours().toString().padStart(2, '0') + ':' +
        now.getUTCMinutes().toString().padStart(2, '0') + ':' +
        now.getUTCSeconds().toString().padStart(2, '0') + 'Z'
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const dot = (label: string, ok: boolean, warn?: boolean) => (
    <div className="flex items-center gap-1">
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: ok ? 'hsl(var(--primary))' : warn ? '#FF9500' : '#FF3B30' }}
      />
      <span className="text-lg md:text-lg text-foreground tracking-wide">{label}</span>
    </div>
  );

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.resolve(onRefresh());
    } finally {
      // Keep animation visible briefly so users get feedback.
      setTimeout(() => setRefreshing(false), 450);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0 border-b border-border" style={{ minHeight: 48, paddingTop: 50 }}>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          {micStatus != null && dot('MIC', micStatus === 'granted')}
          {aiStatus != null && dot('AI', aiStatus === 'ok')}
          {dot('SYNC', syncStatus === 'ok', syncStatus === 'offline')}
          {(queuedCount ?? 0) > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,149,0,0.15)', border: '1px solid rgba(255,149,0,0.3)' }}>
              <span className="text-lg font-bold" style={{ color: '#FF9500' }}>{queuedCount}</span>
              <span className="text-lg" style={{ color: '#FF9500' }}>queued</span>
            </div>
          )}
          {(deadLetterCount ?? 0) > 0 && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,59,48,0.15)', border: '1px solid rgba(255,59,48,0.3)' }}>
              <span className="text-lg font-bold" style={{ color: '#FF3B30' }}>{deadLetterCount}</span>
              <span className="text-lg" style={{ color: '#FF3B30' }}>dead-letter</span>
            </div>
          )}
          {onRefresh && (
            <button
              onClick={handleRefresh}
              className="ml-1 p-1 rounded hover:bg-muted/40 active:bg-muted/60 transition-colors"
              title="Refresh status"
              disabled={refreshing}
            >
              <RefreshCw
                size={16}
                className="text-muted-foreground"
                style={{
                  animation: refreshing ? 'spin 0.8s linear infinite' : undefined,
                }}
              />
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-end gap-3">
          <span className="text-lg text-foreground font-bold">{utc}</span>
          {onEndShift && (
            <button
              onClick={() => setConfirmEnd(true)}
              className="text-lg font-bold tracking-wide px-3 py-1 rounded"
              style={{ background: 'rgba(255,59,48,0.15)', color: '#FF3B30', border: '1px solid #FF3B30' }}
            >
              END SHIFT
            </button>
          )}
        </div>
      </div>

      {confirmEnd && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6" style={{ background: '#F5F5F0' }}>
          <span style={{ color: '#FF3B30', fontSize: 18, letterSpacing: '0.2em', fontWeight: 700, marginBottom: 8 }}>
            END SHIFT?
          </span>
          <p style={{ color: '#666666', fontSize: 18, textAlign: 'center', marginBottom: 40 }}>
            This will end your current shift.
          </p>
          <button
            onClick={() => { setConfirmEnd(false); onEndShift?.(); }}
            className="w-full max-w-xs mb-4"
            style={{ padding: 16, background: 'rgba(255,59,48,0.1)', border: '1px solid #FF3B30', color: '#FF3B30', fontSize: 18, fontWeight: 700, letterSpacing: '0.15em', borderRadius: 3, cursor: 'pointer' }}
          >
            CONFIRM END SHIFT
          </button>
          <button
            onClick={() => setConfirmEnd(false)}
            className="w-full max-w-xs"
            style={{ padding: 16, background: 'transparent', border: '1px solid rgba(0,0,0,0.12)', color: '#333333', fontSize: 18, letterSpacing: '0.15em', borderRadius: 3, cursor: 'pointer' }}
          >
            CANCEL
          </button>
        </div>
      )}
    </>
  );
}
