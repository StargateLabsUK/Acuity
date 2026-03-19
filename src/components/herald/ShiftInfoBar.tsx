import { useState } from 'react';
import type { HeraldSession } from '@/lib/herald-session';
import { clearSession } from '@/lib/herald-session';
import { SERVICE_LABELS } from '@/lib/herald-types';

interface Props {
  session: HeraldSession;
  onEndShift: () => void;
  position: 'top' | 'bottom';
}

export function ShiftInfoBar({ session, onEndShift, position }: Props) {
  const [confirming, setConfirming] = useState(false);

  const handleEndShift = () => {
    clearSession();
    onEndShift();
  };

  if (position === 'top') {
    return (
      <div
        className="flex flex-col items-center flex-shrink-0 py-2"
        style={{ background: '#1A1E24', borderBottom: '1px solid #0F1820' }}
      >
        <span style={{ color: '#FFFFFF', fontSize: 18, letterSpacing: '0.15em', fontWeight: 700, textTransform: 'uppercase' as const }}>
          {SERVICE_LABELS[session.service] ?? session.service.toUpperCase()}
        </span>
        <span style={{ color: '#C8D0CC', fontSize: 18, fontWeight: 700 }}>
          {session.callsign}
          {session.operator_id ? ` · ${session.operator_id}` : ''}
        </span>
        {session.station && (
          <span style={{ color: '#4A6058', fontSize: 18 }}>
            {session.station}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex-shrink-0 flex justify-center py-2" style={{ background: '#1A1E24', borderTop: '1px solid #0F1820' }}>
        <button
          onClick={() => setConfirming(true)}
          style={{
            padding: '8px 24px',
            background: '#FF3B30',
            color: '#FFFFFF',
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '0.1em',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          END SHIFT
        </button>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
          style={{ background: '#080B10' }}
        >
          <span style={{ color: '#FF3B30', fontSize: 18, letterSpacing: '0.2em', fontWeight: 700, marginBottom: 8 }}>
            END SHIFT?
          </span>
          <p style={{ color: '#4A6058', fontSize: 18, textAlign: 'center', marginBottom: 40 }}>
            This will end your current shift as {session.callsign}.
          </p>

          <button
            onClick={handleEndShift}
            className="w-full max-w-xs mb-4"
            style={{
              padding: 16,
              background: 'rgba(255,59,48,0.1)',
              border: '1px solid #FF3B30',
              color: '#FF3B30',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.15em',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            CONFIRM END SHIFT
          </button>

          <button
            onClick={() => setConfirming(false)}
            className="w-full max-w-xs"
            style={{
              padding: 16,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#C8D0CC',
              fontSize: 18,
              letterSpacing: '0.15em',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
        </div>
      )}
    </>
  );
}
