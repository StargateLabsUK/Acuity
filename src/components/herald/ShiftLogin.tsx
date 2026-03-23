import { useState } from 'react';
import { saveSession, startShiftRemote } from '@/lib/herald-session';
import type { HeraldSession } from '@/lib/herald-session';
import { getStationsForService } from '@/lib/uk-stations';


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
  const [collarNumber, setCollarNumber] = useState('');
  const [station, setStation] = useState('');

  const canSubmit = callsign.trim() !== '';
  const stationOptions = getStationsForService(service);

  const [submitting, setSubmitting] = useState(false);

  const handleBeginShift = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const session: HeraldSession = {
      service,
      service_emoji: '',
      callsign: callsign.trim(),
      operator_id: collarNumber.trim() || null,
      station: station || null,
      session_date: new Date().toISOString().slice(0, 10),
      shift_started: new Date().toISOString(),
    };
    // Sync shift to Supabase and get shift_id
    const shiftId = await startShiftRemote(session);
    if (shiftId) session.shift_id = shiftId;
    saveSession(session);
    onShiftStarted(session);
    setSubmitting(false);
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#080B10' }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>
        {/* Wordmark */}
        <h1 className="font-heading text-2xl text-foreground tracking-[0.08em] text-center mb-1">
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
          START OF SHIFT SETUP
        </p>


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

        {/* COLLAR NUMBER */}
        <div className="mb-5">
          <label style={labelStyle}>COLLAR NUMBER</label>
          <input
            type="text"
            value={collarNumber}
            onChange={(e) => setCollarNumber(e.target.value)}
            placeholder="Your personal ID number"
            style={inputStyle}
          />
        </div>

        {/* STATION / TRUST */}
        <div className="mb-8">
          <label style={labelStyle}>STATION / TRUST</label>
          <select
            value={station}
            onChange={(e) => setStation(e.target.value)}
            style={{
              ...inputStyle,
              color: station ? '#C8D0CC' : '#1E3028',
              appearance: 'none',
              WebkitAppearance: 'none',
            }}
            disabled={!service}
          >
            <option value="">{service ? 'Select station / trust' : 'Select a service first'}</option>
            {stationOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
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
      </div>
    </div>
  );
}
