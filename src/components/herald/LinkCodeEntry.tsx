import { useState, useRef, useEffect } from 'react';
import { saveSession, redeemLinkCode } from '@/lib/herald-session';
import type { HeraldSession } from '@/lib/herald-session';

interface Props {
  onShiftLinked: (session: HeraldSession) => void;
}

export function LinkCodeEntry({ onShiftLinked }: Props) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

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

  const handleSubmit = async (code: string) => {
    if (submitting) return;
    setSubmitting(true);
    const result = await redeemLinkCode(code);
    if ('error' in result) {
      setError(result.error);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
      setSubmitting(false);
      return;
    }
    const session = result.session_data;
    saveSession(session);
    onShiftLinked(session);
    setSubmitting(false);
  };

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
                background: '#0D1117',
                border: error ? '1px solid #FF3B30' : '1px solid #0F1820',
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

        {error && (
          <p style={{ color: '#FF3B30', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {error}
          </p>
        )}

        {submitting && (
          <p style={{ color: '#4A6058', fontSize: 14, textAlign: 'center', letterSpacing: '0.15em' }}>
            LINKING...
          </p>
        )}
      </div>
    </div>
  );
}
