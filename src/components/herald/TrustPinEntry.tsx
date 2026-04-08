import { useState, useRef, useEffect } from 'react';
import { validateTrustPin, setCachedTrust } from '@/lib/trust-cache';
import type { CachedTrust } from '@/lib/trust-cache';

interface Props {
  onValidated: (trust: CachedTrust) => void;
}

export function TrustPinEntry({ onValidated }: Props) {
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
    // Auto-submit when all 6 digits are entered
    if (next.every((d) => d !== '')) {
      handleSubmit(next.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleSubmit = async (pin: string) => {
    if (submitting) return;
    setSubmitting(true);
    const result = await validateTrustPin(pin);
    if ('error' in result) {
      setError(result.error);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
      setSubmitting(false);
      return;
    }
    const cached: CachedTrust = {
      trust_id: result.trust_id,
      trust_name: result.trust_name,
      trust_slug: result.trust_slug,
      cached_at: new Date().toISOString(),
    };
    await setCachedTrust(cached);
    onValidated(cached);
    setSubmitting(false);
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#080B10' }}
    >
      <div className="w-full" style={{ maxWidth: 400 }}>
        <h1
          className="text-4xl font-bold tracking-[0.08em] text-center mb-1"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, color: '#FFFFFF' }}
        >
          HERALD
        </h1>
        <p style={{ color: '#4A6058', fontSize: 12, textAlign: 'center', letterSpacing: '0.15em', marginBottom: 6 }}>
          Real-time Field Intelligence
        </p>
        <p
          style={{
            color: '#8A9B94',
            fontSize: 14,
            letterSpacing: '0.25em',
            textAlign: 'center',
            marginBottom: 48,
          }}
        >
          ENTER YOUR TRUST CODE
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
                border: error ? '1px solid #FF3B30' : '1px solid #2A3A32',
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
            VALIDATING...
          </p>
        )}
      </div>
    </div>
  );
}
