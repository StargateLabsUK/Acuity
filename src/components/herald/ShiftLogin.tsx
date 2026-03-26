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
  background: '#0D1117',
  border: '1px solid #0F1820',
  color: '#C8D0CC',
  padding: '14px',
  borderRadius: 3,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 18,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  color: '#1E3028',
  fontSize: 18,
  letterSpacing: '0.2em',
  marginBottom: 6,
  display: 'block',
};

export function ShiftLogin({ onShiftStarted }: Props) {
  const service = 'ambulance';
  const [callsign, setCallsign] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  
  const [trust, setTrust] = useState<CachedTrust | null>(getCachedTrust());
  const [submitting, setSubmitting] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [linkDigits, setLinkDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [linkError, setLinkError] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const linkInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const canSubmit = callsign.trim() !== '' && vehicleType !== '';

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
      operator_id: collarNumber.trim() || null,
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
    saveSession(session);
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
    saveSession(session);
    onShiftStarted(session);
    setLinkSubmitting(false);
  };

  // Link code entry screen
  if (linkMode) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen px-4"
        style={{ background: '#080B10' }}
      >
        <div className="w-full" style={{ maxWidth: 400 }}>
          <h1
            className="text-2xl font-bold tracking-[0.08em] text-center mb-1"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, color: '#FFFFFF' }}
          >
            HERALD
          </h1>
          <p
            style={{
              color: '#4A6058',
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
                  background: '#0D1117',
                  border: linkError ? '1px solid #FF3B30' : '1px solid #0F1820',
                  color: '#FFFFFF',
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
            <p style={{ color: '#4A6058', fontSize: 14, textAlign: 'center', letterSpacing: '0.15em' }}>
              LINKING...
            </p>
          )}

          <button
            onClick={() => { setLinkMode(false); setLinkError(''); setLinkDigits(['', '', '', '', '', '']); }}
            style={{
              display: 'block',
              margin: '24px auto 0',
              fontSize: 14,
              color: '#4A6058',
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
      style={{ background: '#080B10' }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>
        <h1 className="font-heading text-2xl text-foreground tracking-[0.08em] text-center mb-1">
          HERALD
        </h1>
        <p
          style={{
            color: '#4A6058',
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
          <span style={{ color: '#C8D0CC', fontSize: 14, fontFamily: "'IBM Plex Mono', monospace" }}>
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
              color: vehicleType ? '#C8D0CC' : '#1E3028',
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

        {/* COLLAR NUMBER */}
        <div className="mb-8">
          <label style={labelStyle}>COLLAR NUMBER</label>
          <input
            type="text"
            value={collarNumber}
            onChange={(e) => setCollarNumber(e.target.value)}
            placeholder="Your personal ID number"
            style={inputStyle}
          />
        </div>

        {/* BEGIN SHIFT */}
        <button
          onClick={handleBeginShift}
          disabled={!canSubmit || submitting}
          style={{
            width: '100%',
            padding: 12,
            background: 'transparent',
            border: canSubmit ? '1px solid rgba(255,255,255,0.3)' : '1px solid #1E3028',
            color: canSubmit ? '#FFFFFF' : '#1E3028',
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

        {/* LINK TO EXISTING SHIFT */}
        <button
          onClick={() => {
            setLinkMode(true);
            setTimeout(() => linkInputRefs.current[0]?.focus(), 100);
          }}
          style={{
            width: '100%',
            padding: 12,
            marginTop: 12,
            background: 'transparent',
            border: '1px solid rgba(61, 255, 140, 0.2)',
            color: 'hsl(147, 100%, 62%)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '0.15em',
            cursor: 'pointer',
            borderRadius: 3,
          }}
        >
          LINK TO EXISTING SHIFT
        </button>
      </div>
    </div>
  );
}
