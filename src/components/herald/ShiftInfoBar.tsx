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
        style={{ background: '#0D1117', borderBottom: '1px solid #0F1820' }}
      >
        <span style={{ color: '#4A6058', fontSize: 18, letterSpacing: '0.15em' }}>
          {SERVICE_LABELS[session.service] ?? session.service.toUpperCase()}
        </span>
        <span style={{ color: '#C8D0CC', fontSize: 18, fontWeight: 700 }}>
          {session.callsign}
          {session.operator_id ? ` · ${session.operator_id}` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0" style={{ background: '#0D1117', borderTop: '1px solid #0F1820' }}>
      {confirming ? (
        <div className="flex items-center justify-center gap-4 py-2">
          <span style={{ color: '#FF9500', fontSize: 18, fontWeight: 700 }}>END SHIFT?</span>
          <button
            onClick={handleEndShift}
            style={{ color: '#FF9500', fontSize: 18, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            YES
          </button>
          <button
            onClick={() => setConfirming(false)}
            style={{ color: '#FF9500', fontSize: 18, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            CANCEL
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-full py-2"
          style={{
            color: '#4A6058',
            fontSize: 18,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            letterSpacing: '0.1em',
          }}
        >
          END SHIFT
        </button>
      )}
    </div>
  );
}
