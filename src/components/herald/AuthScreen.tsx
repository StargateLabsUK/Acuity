import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  variant: 'field' | 'command';
  onSignIn: (email: string, password: string) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0D1117',
  border: '1px solid #0F1820',
  color: '#C8D0CC',
  padding: '14px 16px',
  borderRadius: 3,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  color: '#FFFFFF',
  fontSize: 9,
  letterSpacing: '0.2em',
  marginBottom: 6,
  display: 'block',
};

function mapError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('invalid') || lower.includes('credentials')) return 'INVALID CREDENTIALS';
  if (lower.includes('email not confirmed') || lower.includes('not confirmed')) return 'CHECK YOUR EMAIL FOR CONFIRMATION LINK';
  if (lower.includes('too many') || lower.includes('rate')) return 'TOO MANY ATTEMPTS — WAIT A MOMENT';
  if (lower.includes('network') || lower.includes('fetch')) return 'CONNECTION ERROR — CHECK YOUR SIGNAL';
  return msg.toUpperCase();
}

export function AuthScreen({ variant, onSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAccessInfo, setShowAccessInfo] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError('');
    setLoading(true);
    try {
      await onSignIn(email.trim(), password);
    } catch (err: any) {
      setError(mapError(err?.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#080B10' }}
    >
      <form onSubmit={handleSubmit} className="w-full" style={{ maxWidth: variant === 'command' ? 400 : 340, padding: 24 }}>
        {/* Wordmark — matches CommandTopBar */}
        <div style={{ textAlign: 'center', marginBottom: 0 }}>
          <span className="font-heading text-2xl text-foreground tracking-[0.08em]">
            {variant === 'command' ? 'HERALD COMMAND' : 'HERALD'}
          </span>
        </div>

        <div style={{ height: 1, background: '#0F1820', margin: '20px 0' }} />

        <p style={{ color: '#FFFFFF', fontSize: 9, letterSpacing: '0.25em', textAlign: 'center', marginBottom: 24 }}>
          {variant === 'command' ? 'COMMAND ACCESS' : 'FIELD ACCESS'}
        </p>

        {/* Email */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>EMAIL</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(61,255,140,0.3)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#0F1820'; }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>PASSWORD</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...inputStyle, paddingRight: 44 }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(61,255,140,0.3)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#0F1820'; }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#FFFFFF',
                padding: 0,
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p style={{ color: '#FF3B30', fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
            {error}
          </p>
        )}

        {/* Sign In Button */}
        <button
          type="submit"
          disabled={loading || !email || !password}
          style={{
            width: '100%',
            marginTop: 20,
            padding: 16,
            background: 'rgba(61,255,140,0.08)',
            border: '2px solid #3DFF8C',
            color: '#3DFF8C',
            fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '0.1em',
            cursor: loading ? 'wait' : 'pointer',
            borderRadius: 3,
            opacity: loading || !email || !password ? 0.5 : 1,
          }}
        >
          {loading ? 'SIGNING IN…' : 'SIGN IN'}
        </button>

        {/* Access info */}
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          {variant === 'field' ? (
            <>
              <button
                type="button"
                onClick={() => setShowAccessInfo(!showAccessInfo)}
                style={{
                  color: '#FFFFFF',
                  fontSize: 9,
                  letterSpacing: '0.15em',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                REQUEST ACCESS
              </button>
              {showAccessInfo && (
                <p style={{ color: '#FFFFFF', fontSize: 10, marginTop: 8, opacity: 0.7 }}>
                  CONTACT YOUR TRUST ADMINISTRATOR TO CREATE AN ACCOUNT
                </p>
              )}
            </>
          ) : (
            <p style={{ color: '#FFFFFF', fontSize: 9, letterSpacing: '0.1em', opacity: 0.7 }}>
              FIELD OPERATORS SIGN IN AT THE HERALD FIELD APP
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
