import { useState, useRef, useEffect } from 'react';
import { saveSession, redeemLinkCode } from '@/lib/herald-session';
import type { HeraldSession } from '@/lib/herald-session';

interface Props {
  onShiftLinked: (session: HeraldSession) => void;
}

export function LinkCodeEntry({ onShiftLinked }: Props) {
  const [collarNumber, setCollarNumber] = useState('');
  const [collarConfirmed, setCollarConfirmed] = useState(false);
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const collarRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!collarConfirmed) {
      collarRef.current?.focus();
    }
  }, [collarConfirmed]);

  useEffect(() => {
    if (collarConfirmed) {
      inputRefs.current[0]?.focus();
    }
  }, [collarConfirmed]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...digits];
    next[index] = value.slice(-1);
    setDigits(next);
    setError('');
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    if (next.every((d) => d !== '')) {
      handleSubmit(next.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // Validate collar number: alphanumeric, hyphens, underscores, spaces, max 30 chars
  const COLLAR_PATTERN = /^[a-zA-Z0-9\-_ ]{1,30}$/;

  const handleSubmit = async (code: string) => {
    if (submitting) return;
    setSubmitting(true);
    const trimmedCollar = collarNumber.trim();
    if (trimmedCollar && !COLLAR_PATTERN.test(trimmedCollar)) {
      setError('Invalid collar number format');
      setSubmitting(false);
      return;
    }
    const result = await redeemLinkCode(code, trimmedCollar || undefined);
    if ('error' in result) {
      setError(result.error);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
      setSubmitting(false);
      return;
    }
    const session = result.session_data;
    session.operator_id = collarNumber.trim() || null;
    await saveSession(session);
    onShiftLinked(session);
    setSubmitting(false);
  };

  // Step 1: Collar number entry
  if (!collarConfirmed) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen px-4"
        style={{ background: '#F5F5F0' }}
      >
        <div className="w-full" style={{ maxWidth: 400 }}>
          <div className="flex justify-center mb-6">
            <img
              src="/Acuity.png"
              alt="Acuity"
              style={{ width: 56, height: 56, objectFit: 'contain' }}
            />
          </div>
          <p
            style={{
              color: '#8A9B94',
              fontSize: 14,
              letterSpacing: '0.25em',
              textAlign: 'center',
              marginBottom: 48,
            }}
          >
            ENTER YOUR COLLAR NUMBER
          </p>

          <input
            ref={collarRef}
            type="text"
            value={collarNumber}
            onChange={(e) => setCollarNumber(e.target.value)}
            placeholder="Your personal ID number"
            style={{
              width: '100%',
              background: '#FFFFFF',
              border: '1px solid #E2E2DE',
              color: '#1A1A1A',
              padding: '14px',
              borderRadius: 3,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 18,
              outline: 'none',
              marginBottom: 24,
              textAlign: 'center',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && collarNumber.trim()) {
                setCollarConfirmed(true);
              }
            }}
          />

          <button
            onClick={() => setCollarConfirmed(true)}
            disabled={!collarNumber.trim()}
            style={{
              width: '100%',
              padding: 12,
              background: 'transparent',
              border: collarNumber.trim()
                ? '1px solid rgba(0,0,0,0.15)'
                : '1px solid #1E3028',
              color: collarNumber.trim() ? '#1A1A1A' : '#999999',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: '0.15em',
              cursor: collarNumber.trim() ? 'pointer' : 'not-allowed',
              borderRadius: 3,
            }}
          >
            CONTINUE
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Link code entry
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#F5F5F0' }}
    >
      <div className="w-full" style={{ maxWidth: 400 }}>
        <div className="flex justify-center mb-6">
          <img
            src="/Acuity.png"
            alt="Acuity"
            style={{ width: 56, height: 56, objectFit: 'contain' }}
          />
        </div>
        <p
          style={{
            color: '#8A9B94',
            fontSize: 14,
            letterSpacing: '0.25em',
            textAlign: 'center',
            marginBottom: 48,
          }}
        >
          ENTER SHIFT LINK CODE
        </p>

        <div className="flex justify-center gap-3 mb-8">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={submitting}
              className="text-center"
              style={{
                width: 52,
                height: 64,
                background: '#FFFFFF',
                border: error ? '1px solid #FF3B30' : '1px solid #E2E2DE',
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

        {error && (
          <p style={{ color: '#FF3B30', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {error}
          </p>
        )}

        {submitting && (
          <p style={{ color: '#666666', fontSize: 14, textAlign: 'center', letterSpacing: '0.15em' }}>
            LINKING...
          </p>
        )}

        <button
          onClick={() => { setCollarConfirmed(false); setError(''); setDigits(['', '', '', '', '', '']); }}
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
          ← BACK
        </button>
      </div>
    </div>
  );
}
