import { useState } from 'react';
import { saveSession } from '@/lib/herald-session';
import type { HeraldSession } from '@/lib/herald-session';

const SERVICE_OPTIONS = [
  { value: 'ambulance', emoji: '🚑', label: '🚑 Ambulance' },
  { value: 'police', emoji: '👮', label: '👮 Police' },
  { value: 'fire', emoji: '🚒', label: '🚒 Fire & Rescue' },
  { value: 'military', emoji: '⚔️', label: '⚔️ Military' },
  { value: 'other', emoji: '📻', label: 'Other' },
];

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
  const [service, setService] = useState('');
  const [callsign, setCallsign] = useState('');
  const [collarNumber, setCollarNumber] = useState('');
  const [station, setStation] = useState('');

  const canSubmit = service !== '' && callsign.trim() !== '';

  const handleBeginShift = () => {
    if (!canSubmit) return;
    const opt = SERVICE_OPTIONS.find((o) => o.value === service);
    const session: HeraldSession = {
      service,
      service_emoji: opt?.emoji ?? '📻',
      callsign: callsign.trim(),
      operator_id: collarNumber.trim() || null,
      station: station.trim() || null,
      session_date: new Date().toISOString().slice(0, 10),
      shift_started: new Date().toISOString(),
    };
    saveSession(session);
    onShiftStarted(session);
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#080B10' }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>
        {/* Wordmark */}
        <h1
          style={{
            fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
            fontWeight: 800,
            fontSize: 28,
            color: '#FFFFFF',
            textAlign: 'center',
            marginBottom: 8,
          }}
        >
          HERALD
        </h1>
        <p
          style={{
            color: '#1E3028',
            fontSize: 18,
            letterSpacing: '0.25em',
            textAlign: 'center',
            marginBottom: 48,
          }}
        >
          START OF SHIFT SETUP
        </p>

        {/* SERVICE */}
        <div className="mb-5">
          <label style={labelStyle}>SERVICE</label>
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            style={{
              ...inputStyle,
              color: service ? '#C8D0CC' : '#1E3028',
              appearance: 'none',
              WebkitAppearance: 'none',
            }}
          >
            <option value="" disabled>Select service</option>
            {SERVICE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
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

        {/* STATION */}
        <div className="mb-8">
          <label style={labelStyle}>STATION / TRUST</label>
          <input
            type="text"
            value={station}
            onChange={(e) => setStation(e.target.value)}
            placeholder="Optional"
            style={inputStyle}
          />
        </div>

        {/* BEGIN SHIFT */}
        <button
          onClick={handleBeginShift}
          disabled={!canSubmit}
          style={{
            width: '100%',
            padding: 18,
            background: canSubmit ? 'rgba(61,255,140,0.08)' : 'rgba(255,255,255,0.02)',
            border: canSubmit ? '2px solid #3DFF8C' : '2px solid #1E3028',
            color: canSubmit ? '#3DFF8C' : '#1E3028',
            fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '0.1em',
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
