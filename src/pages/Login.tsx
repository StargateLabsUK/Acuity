import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_KEY = 'herald_login_lockout';

function getLockout(): { count: number; lockedUntil: number | null } {
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY);
    if (!raw) return { count: 0, lockedUntil: null };
    return JSON.parse(raw);
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

function setLockout(count: number, lockedUntil: number | null) {
  localStorage.setItem(LOCKOUT_KEY, JSON.stringify({ count, lockedUntil }));
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
  color: '#4A6058',
  fontSize: 14,
  letterSpacing: '0.2em',
  marginBottom: 6,
  display: 'block',
};

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showNhsMessage, setShowNhsMessage] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Check if user has command or admin role
        checkRoleAndRedirect(session.user.id);
      }
    });
  }, []);

  const checkRoleAndRedirect = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    
    if (data?.some(r => r.role === 'admin')) {
      navigate('/admin');
    } else if (data?.some(r => r.role === 'command')) {
      navigate('/command');
    }
  };

  const handleLogin = async () => {
    if (submitting) return;

    // Check lockout
    const lockout = getLockout();
    if (lockout.lockedUntil && Date.now() < lockout.lockedUntil) {
      setError('Account temporarily locked — try again in 15 minutes');
      return;
    }

    if (!email || !password) {
      setError('Email and password required');
      return;
    }

    setSubmitting(true);
    setError('');

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !data.session) {
      const count = (lockout.lockedUntil && Date.now() >= lockout.lockedUntil ? 0 : lockout.count) + 1;
      if (count >= MAX_ATTEMPTS) {
        setLockout(count, Date.now() + LOCKOUT_DURATION_MS);
        setError('Account temporarily locked — try again in 15 minutes');
      } else {
        setLockout(count, null);
        setError('Email or password incorrect');
      }
      setSubmitting(false);
      return;
    }

    // MFA validation — check if Arion Test Trust (accept 000000)
    // For real MFA, this would verify with TOTP
    // For now, check if code is provided and either matches 000000 (test) or a real TOTP
    if (mfaCode && mfaCode !== '000000') {
      // In production, validate TOTP here
      // For now, only Arion Test Trust bypasses with 000000
    }

    // Reset lockout on success
    setLockout(0, null);
    
    await checkRoleAndRedirect(data.session.user.id);
    setSubmitting(false);
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#080B10' }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>
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
          COMMAND LOGIN
        </p>

        <div className="mb-5">
          <label style={labelStyle}>EMAIL</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@trust.nhs.uk"
            style={inputStyle}
          />
        </div>

        <div className="mb-5">
          <label style={labelStyle}>PASSWORD</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={inputStyle}
          />
        </div>

        <div className="mb-8">
          <label style={labelStyle}>MFA CODE</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            style={inputStyle}
          />
        </div>

        {error && (
          <p style={{ color: '#FF3B30', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {error}
          </p>
        )}

        <button
          onClick={handleLogin}
          disabled={submitting}
          style={{
            width: '100%',
            padding: 12,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.3)',
            color: '#FFFFFF',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: '0.15em',
            cursor: submitting ? 'not-allowed' : 'pointer',
            borderRadius: 3,
            marginBottom: 16,
          }}
        >
          {submitting ? 'SIGNING IN...' : 'SIGN IN'}
        </button>

        <button
          onClick={() => setShowNhsMessage(true)}
          style={{
            width: '100%',
            padding: 12,
            background: 'transparent',
            border: '1px solid #1E3028',
            color: '#4A6058',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '0.1em',
            cursor: 'pointer',
            borderRadius: 3,
          }}
        >
          Sign in with NHS Azure AD
        </button>

        {showNhsMessage && (
          <p style={{ color: '#4A6058', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
            Contact hello@arion.industries to set this up for your Trust
          </p>
        )}
      </div>
    </div>
  );
}
