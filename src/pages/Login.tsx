import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

type LoginStep = 'credentials' | 'mfa';

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
  const [step, setStep] = useState<LoginStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showNhsMessage, setShowNhsMessage] = useState(false);

  // MFA state
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState('');

  // Check for existing session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
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
      setError(authError?.message || 'Login failed — no session returned');
      setSubmitting(false);
      return;
    }

    // Check lockout status
    const { data: profile } = await supabase
      .from('profiles')
      .select('locked, locked_until, failed_login_attempts')
      .eq('id', data.session.user.id)
      .maybeSingle();

    if (profile?.locked && profile?.locked_until) {
      const lockedUntil = new Date(profile.locked_until);
      if (lockedUntil > new Date()) {
        await supabase.auth.signOut();
        setError('Account temporarily locked — try again in 15 minutes');
        setSubmitting(false);
        return;
      }
    }

    // Reset lockout on successful login
    if (profile && (profile.failed_login_attempts ?? 0) > 0) {
      await supabase
        .from('profiles')
        .update({ failed_login_attempts: 0, locked: false, locked_until: null })
        .eq('id', data.session.user.id);
    }

    // Check if user has MFA enrolled
    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    const totpFactors = factorsData?.totp ?? [];
    const verifiedFactor = totpFactors.find(f => f.status === 'verified');

    if (verifiedFactor) {
      // User has MFA — need to verify
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: verifiedFactor.id,
      });

      if (challengeError || !challenge) {
        setError('Failed to start MFA challenge');
        setSubmitting(false);
        return;
      }

      setMfaFactorId(verifiedFactor.id);
      setMfaChallengeId(challenge.id);
      setStep('mfa');
      setSubmitting(false);
      return;
    }

    // No MFA — proceed directly. MFA can be enabled from admin settings.
    await checkRoleAndRedirect(data.session.user.id);
    setSubmitting(false);
  };

  const handleMfaVerify = async () => {
    if (submitting || mfaCode.length !== 6) return;
    setSubmitting(true);
    setError('');

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });

    if (verifyError) {
      setError('Invalid code — try again');
      setMfaCode('');
      setSubmitting(false);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await checkRoleAndRedirect(session.user.id);
    }
    setSubmitting(false);
  };

  const handleSkipMfa = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await checkRoleAndRedirect(session.user.id);
    }
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
          {step === 'credentials' && 'COMMAND LOGIN'}
          {step === 'mfa' && 'ENTER MFA CODE'}
        </p>

        {/* STEP 1: Email + Password */}
        {step === 'credentials' && (
          <>
            <div className="mb-5">
              <label style={labelStyle}>EMAIL</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@trust.nhs.uk"
                style={inputStyle}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>

            <div className="mb-8">
              <label style={labelStyle}>PASSWORD</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
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
          </>
        )}

        {/* STEP 2: MFA Code Entry (returning user) */}
        {step === 'mfa' && (
          <>
            <p style={{ color: '#C8D0CC', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
              Open your authenticator app and enter the 6-digit code
            </p>

            <div className="mb-8">
              <label style={labelStyle}>VERIFICATION CODE</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                style={{ ...inputStyle, textAlign: 'center', letterSpacing: '0.5em', fontSize: 24 }}
                onKeyDown={(e) => e.key === 'Enter' && handleMfaVerify()}
              />
            </div>

            {error && (
              <p style={{ color: '#FF3B30', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
                {error}
              </p>
            )}

            <button
              onClick={handleMfaVerify}
              disabled={submitting || mfaCode.length !== 6}
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
              {submitting ? 'VERIFYING...' : 'VERIFY'}
            </button>

            <button
              onClick={() => { setStep('credentials'); setMfaCode(''); setError(''); }}
              style={{
                width: '100%',
                padding: 8,
                background: 'transparent',
                border: 'none',
                color: '#4A6058',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              BACK TO LOGIN
            </button>
          </>
        )}

      </div>
    </div>
  );
}
