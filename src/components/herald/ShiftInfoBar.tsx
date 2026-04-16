import { useState } from 'react';
import type { HeraldSession } from '@/lib/herald-session';
import { clearSession, endShiftRemote, leaveShiftRemote } from '@/lib/herald-session';
import { SERVICE_LABELS } from '@/lib/herald-types';
import { getVehicleLabel } from '@/lib/vehicle-types';

interface Props {
  session: HeraldSession;
  onEndShift?: () => void;
  position: 'top' | 'bottom';
  showEndShift?: boolean;
  /** If true, shows "LEAVE SHIFT" instead of "END SHIFT" — clears local session only */
  isLinkedDevice?: boolean;
}

export function ShiftInfoBar({ session, onEndShift, position, showEndShift = false, isLinkedDevice = false }: Props) {
  const [confirming, setConfirming] = useState(false);

  const handleEndShift = async () => {
    if (session.shift_id) {
      await endShiftRemote(session.shift_id);
    }
    clearSession();
    onEndShift?.();
  };

  const handleLeaveShift = async () => {
    if (session.shift_id && session.operator_id) {
      await leaveShiftRemote(session.shift_id, session.operator_id);
    }
    clearSession();
    onEndShift?.();
  };

  if (position === 'top') {
    return null;
  }

  return (
    <>
      <div className="flex-shrink-0 flex flex-col items-center pb-3 pt-0 gap-1" style={{ background: '#F5F5F0', marginBottom: 8 }}>
        <span style={{ color: '#1A1A1A', fontSize: 18, letterSpacing: '0.15em', fontWeight: 700, textTransform: 'uppercase' as const }}>
          {getVehicleLabel(session.vehicle_type) || (SERVICE_LABELS[session.service] ?? session.service.toUpperCase())}
        </span>
        <span style={{ color: '#333333', fontSize: 18, fontWeight: 700 }}>
          {session.callsign}
          {session.operator_id ? ` · ${session.operator_id}` : ''}
          {session.can_transport === false && (
            <span style={{ color: '#FF9500', marginLeft: 8 }}>NO TRANSPORT</span>
          )}
        </span>
        {session.station && (
          <span style={{ color: '#666666', fontSize: 18 }}>
            {session.station}
          </span>
        )}

        {showEndShift && !isLinkedDevice && (
          <button
            onClick={() => setConfirming(true)}
            style={{
              marginTop: 8,
              padding: '8px 24px',
              background: '#FF3B30',
              color: '#1A1A1A',
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
        )}
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
          style={{ background: '#F5F5F0' }}
        >
          <span style={{
            color: isLinkedDevice ? '#FF9500' : '#FF3B30',
            fontSize: 18,
            letterSpacing: '0.2em',
            fontWeight: 700,
            marginBottom: 8,
          }}>
            {isLinkedDevice ? 'LEAVE SHIFT?' : 'END SHIFT?'}
          </span>
          <p style={{ color: '#666666', fontSize: 18, textAlign: 'center', marginBottom: 40 }}>
            {isLinkedDevice
              ? `This will disconnect your device from ${session.callsign}. The shift will continue for other crew members.`
              : `This will end your current shift as ${session.callsign}.`}
          </p>

          <button
            onClick={isLinkedDevice ? handleLeaveShift : handleEndShift}
            className="w-full max-w-xs mb-4"
            style={{
              padding: 16,
              background: isLinkedDevice ? 'rgba(255,149,0,0.1)' : 'rgba(255,59,48,0.1)',
              border: `1px solid ${isLinkedDevice ? '#FF9500' : '#FF3B30'}`,
              color: isLinkedDevice ? '#FF9500' : '#FF3B30',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: '0.15em',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {isLinkedDevice ? 'CONFIRM LEAVE' : 'CONFIRM END SHIFT'}
          </button>

          <button
            onClick={() => setConfirming(false)}
            className="w-full max-w-xs"
            style={{
              padding: 16,
              background: 'transparent',
              border: '1px solid rgba(0,0,0,0.12)',
              color: '#333333',
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
