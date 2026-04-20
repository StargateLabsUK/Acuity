import { useState, useRef, useEffect } from 'react';
import { saveSession, startShiftRemote, redeemLinkCode } from '@/lib/herald-session';
import type { HeraldSession } from '@/lib/herald-session';
import { VEHICLE_TYPES } from '@/lib/vehicle-types';
import { getCachedTrust } from '@/lib/trust-cache';
import { TrustPinEntry } from './TrustPinEntry';
import type { CachedTrust } from '@/lib/trust-cache';

interface Props {
  onShiftStarted: (session: HeraldSession) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#FFFFFF',
  border: '1px solid #E2E2DE',
  color: '#333333',
  padding: '14px',
  borderRadius: 3,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 18,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  color: '#8A9B94',
  fontSize: 18,
  letterSpacing: '0.2em',
  marginBottom: 6,
  display: 'block',
};

export function ShiftLogin({ onShiftStarted }: Props) {
  const service = 'ambulance';
  const [callsign, setCallsign] = useState('');
  const [vehicleType, setVehicleType] = useState('');

  const [trust, setTrust] = useState<CachedTrust | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getCachedTrust().then(setTrust);
  }, []);
  const [linkMode, setLinkMode] = useState(false);
  const [linkDigits, setLinkDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [linkError, setLinkError] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const linkInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Input validation: alphanumeric, hyphens, spaces, max 30 chars
  const CALLSIGN_PATTERN = /^[a-zA-Z0-9\-_ ]{1,30}$/;
  const isCallsignValid = callsign.trim() !== '' && CALLSIGN_PATTERN.test(callsign.trim());
  const canSubmit = isCallsignValid && vehicleType !== '';

  if (!trust) {
    return <TrustPinEntry onValidated={(t) => setTrust(t)} />;
  }

  const handleBeginShift = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const vt = VEHICLE_TYPES.find((v) => v.code === vehicleType);
    const session: HeraldSession = {
      service,
      service_emoji: '',
      callsign: callsign.trim(),
      operator_id: null,
      station: null,
      session_date: new Date().toISOString().slice(0, 10),
      shift_started: new Date().toISOString(),
      vehicle_type: vehicleType,
      can_transport: vt?.can_transport ?? true,
      critical_care: vt?.critical_care ?? false,
      trust_id: trust.trust_id,
    };
    const shiftId = await startShiftRemote(session);
    if (shiftId) session.shift_id = shiftId;
    await saveSession(session);
    onShiftStarted(session);
    setSubmitting(false);
  };

  // Link code handlers
  const handleLinkChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...linkDigits];
    next[index] = value.slice(-1);
    setLinkDigits(next);
    setLinkError('');
    if (value && index < 5) {
      linkInputRefs.current[index + 1]?.focus();
    }
    if (next.every((d) => d !== '')) {
      handleLinkSubmit(next.join(''));
    }
  };

  const handleLinkKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !linkDigits[index] && index > 0) {
      linkInputRefs.current[index - 1]?.focus();
    }
  };

  const handleLinkSubmit = async (code: string) => {
    if (linkSubmitting) return;
    setLinkSubmitting(true);
    const result = await redeemLinkCode(code);
    if ('error' in result) {
      setLinkError(result.error);
      setLinkDigits(['', '', '', '', '', '']);
      setTimeout(() => linkInputRefs.current[0]?.focus(), 100);
      setLinkSubmitting(false);
      return;
    }
    const session = result.session_data;
    await saveSession(session);
    onShiftStarted(session);
    setLinkSubmitting(false);
  };

  // Link code entry screen
  if (linkMode) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen px-4"
        style={{ background: '#F5F5F0' }}
      >
        <div className="w-full" style={{ maxWidth: 400 }}>
          <img
            src="/Acuity.png"
            alt="Acuity"
            className="mx-auto mb-6"
            style={{ width: 180, maxWidth: '100%', height: 'auto' }}
          />
          <p
            style={{
              color: '#666666',
              fontSize: 14,
              letterSpacing: '0.25em',
              textAlign: 'center',
              marginBottom: 48,
            }}
          >
            ENTER SHIFT LINK CODE
          </p>

          <div className="flex justify-center gap-3 mb-8">
            {linkDigits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { linkInputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleLinkChange(i, e.target.value)}
                onKeyDown={(e) => handleLinkKeyDown(i, e)}
                disabled={linkSubmitting}
                className="text-center"
                style={{
                  width: 52,
                  height: 64,
                  background: '#FFFFFF',
                  border: linkError ? '1px solid #FF3B30' : '1px solid #E2E2DE',
                  color: '#1A1A1A',
                  fontSize: 28,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 700,
                  borderRadius: 4,
                  outline: 'none',
                  caretColor: 'hsl(147, 100%, 62%)',
                }}
              />
            ))}
          </div>

          {linkError && (
            <p style={{ color: '#FF3B30', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
              {linkError}
            </p>
          )}

          {linkSubmitting && (
            <p style={{ color: '#666666', fontSize: 14, textAlign: 'center', letterSpacing: '0.15em' }}>
              LINKING...
            </p>
          )}

          <button
            onClick={() => { setLinkMode(false); setLinkError(''); setLinkDigits(['', '', '', '', '', '']); }}
            style={{
              display: 'block',
              margin: '24px auto 0',
              fontSize: 14,
              color: '#666666',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.1em',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            ← BACK TO SHIFT SETUP
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#F5F5F0' }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>
        <img
          src="/Acuity.png"
          alt="Acuity"
          className="mx-auto mb-6"
          style={{ width: 220, maxWidth: '100%', height: 'auto' }}
        />
        <p
          style={{
            color: '#8A9B94',
            fontSize: 14,
            letterSpacing: '0.25em',
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          START OF SHIFT SETUP
        </p>

        {/* Trust indicator */}
        <div
          className="flex items-center justify-center gap-2 mb-8"
          style={{
            padding: '8px 16px',
            background: 'rgba(61, 255, 140, 0.06)',
            border: '1px solid rgba(61, 255, 140, 0.2)',
            borderRadius: 4,
          }}
        >
          <span style={{ color: 'hsl(147, 100%, 62%)', fontSize: 14, fontWeight: 600 }}>✓</span>
          <span style={{ color: '#333333', fontSize: 14, fontFamily: "'IBM Plex Mono', monospace" }}>
            Trust: {trust.trust_name}
          </span>
        </div>

        {/* CALLSIGN */}
        <div className="mb-5">
          <label style={labelStyle}>CALLSIGN / UNIT</label>
          <input
            type="text"
            value={callsign}
            onChange={(e) => setCallsign(e.target.value)}
            placeholder="e.g. Alpha Two, Bravo Three"
            style={inputStyle}
          />
        </div>

        {/* VEHICLE TYPE */}
        <div className="mb-5">
          <label style={labelStyle}>VEHICLE TYPE</label>
          <select
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
            style={{
              ...inputStyle,
              color: vehicleType ? '#E0E8E4' : '#4A6058',
              appearance: 'none',
              WebkitAppearance: 'none',
            }}
          >
            <option value="">Select vehicle type</option>
            {VEHICLE_TYPES.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code} — {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* BEGIN SHIFT */}
        <button
          onClick={handleBeginShift}
          disabled={!canSubmit || submitting}
          style={{
            width: '100%',
            padding: 12,
            background: 'transparent',
            border: canSubmit ? '1px solid rgba(0,0,0,0.15)' : '1px solid #E2E2DE',
            color: canSubmit ? '#1A1A1A' : '#999999',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: '0.15em',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            borderRadius: 3,
          }}
        >
          BEGIN SHIFT
        </button>
      </div>
    </div>
  );
}
