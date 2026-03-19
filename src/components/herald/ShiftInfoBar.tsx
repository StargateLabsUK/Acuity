import { useState } from 'react';
import type { HeraldSession } from '@/lib/herald-session';
import { clearSession } from '@/lib/herald-session';
import { SERVICE_LABELS } from '@/lib/herald-types';

interface Props {
  session: HeraldSession;
  onEndShift: () => void;
}

export function ShiftInfoBar({ session, onEndShift }: Props) {
  const [confirming, setConfirming] = useState(false);

  const handleEndShift = () => {
    clearSession();
    onEndShift();
  };

  return (
    <div>
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          background: '#0D1117',
          borderBottom: '1px solid #0F1820',
          padding: '6px 20px',
        }}
      >
        <div className="flex items-center gap-3">
          <span style={{ color: '#C8D0CC', fontSize: 18, fontWeight: 700 }}>
            {SERVICE_LABELS[session.service] ?? session.service} — {session.callsign}
          </span>
          {session.operator_id && (
            <span style={{ color: '#3A5048', fontSize: 18 }}>
              {session.operator_id}
            </span>
          )}
        </div>
        <button
          onClick={() => setConfirming(true)}
          style={{
            color: '#1E3028',
            fontSize: 18,
            border: '1px solid #0F1820',
            padding: '3px 10px',
            borderRadius: 2,
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          END SHIFT
        </button>
      </div>
      {confirming && (
        <div
          className="flex items-center justify-center gap-4"
          style={{
            background: '#0D1117',
            borderBottom: '1px solid #0F1820',
            padding: '8px 20px',
          }}
        >
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
      )}
    </div>
  );
}
