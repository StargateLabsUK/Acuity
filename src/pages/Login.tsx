import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

type LoginStep = 'credentials' | 'mfa-verify' | 'mfa-enroll';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#FFFFFF',
  border: '1px solid #E2E2DE',
  color: '#1A1A1A',
  padding: '14px',
  borderRadius: 3,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 18,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  color: '#8A9B94',
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

  // MFA state
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');

  // Check for existing session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        checkMfaAndRedirect(session.user.id);
      }
    });
  }, []);

  const checkRoleAndRedirect = async (userId: string) => {
    const { data, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (roleError) {
      setError('Role check failed: ' + roleError.message);
      return;
    }

    if (!data || data.length === 0) {
      setError('No roles found for this account. Contact your administrator.');
      return;
    }

    if (data.some(r => r.role === 'owner')) {
      window.location.href = '/admin';
    } else if (data.some(r => r.role === 'admin')) {
      window.location.href = '/admin';
    } else if (data.some(r => r.role === 'command')) {
      window.location.href = '/operations';
    } else {
      setError('Account has no admin or command role. Roles: ' + data.map(r => r.role).join(', '));
    }
  };

  const checkMfaAndRedirect = async (userId: string) => {
    // Check AAL level - if user has MFA but session is AAL1, don't redirect
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.currentLevel === 'aal1' && aalData?.nextLevel === 'aal2') {
      // Need MFA verification still
      return;
    }
    await checkRoleAndRedirect(userId);
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
      setError(authError?.message || 'Login failed');
      setSubmitting(false);
      return;
    }

    // Check lockout
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

    if (profile && (profile.failed_login_attempts ?? 0) > 0) {
      await supabase
        .from('profiles')
        .update({ failed_login_attempts: 0, locked: false, locked_until: null })
        .eq('id', data.session.user.id);
    }

    // Check MFA status
    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    const totpFactors = factorsData?.totp ?? [];
    const verifiedFactor = totpFactors.find(f => f.status === 'verified');

    if (verifiedFactor) {
      // Has MFA — go to verify step
      setMfaFactorId(verifiedFactor.id);
      setStep('mfa-verify');
      setSubmitting(false);
      return;
    }

    // Clean up any unverified factors from previous failed attempts
    for (const f of totpFactors.filter(f => f.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }

    // No MFA — enroll now
    // FIX: Set issuer to 'Acuity' so authenticator app shows correct name
    const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Acuity',
      issuer: 'Acuity',
    });

    if (enrollError || !enrollData) {
      setError('MFA setup failed: ' + (enrollError?.message || 'unknown'));
      setSubmitting(false);
      return;
    }

    setMfaFactorId(enrollData.id);
    setQrCode(enrollData.totp.qr_code);
    setMfaSecret(enrollData.totp.secret);
    setStep('mfa-enroll');
    setSubmitting(false);
  };

  // FIX: Create a FRESH challenge for every verify attempt
  // This prevents stale challenge IDs from causing failures
  const handleMfaVerify = async () => {
    if (submitting || mfaCode.length !== 6) return;
    setSubmitting(true);
    setError('');

    try {
      // Always create a new challenge right before verify
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });

      if (challengeError || !challenge) {
        setError('Challenge error: ' + (challengeError?.message || 'no challenge returned'));
        setSubmitting(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaCode,
      });

      if (verifyError) {
        setError('Invalid code: ' + verifyError.message);
        setMfaCode('');
        setSubmitting(false);
        return;
      }

      // MFA verified — redirect
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await checkRoleAndRedirect(session.user.id);
      }
      setSubmitting(false);
    } catch (e: any) {
      setError('Error: ' + (e?.message || String(e)));
      setSubmitting(false);
    }
  };

  // MFA enrollment verify — same flow but for first-time setup
  const handleMfaEnrollVerify = async () => {
    if (submitting || mfaCode.length !== 6) return;
    setSubmitting(true);
    setError('');

    try {
      // FIX: Fresh challenge for enrollment verification too
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });

      if (challengeError || !challenge) {
        setError('Challenge error: ' + (challengeError?.message || 'no challenge returned'));
        setSubmitting(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaCode,
      });

      if (verifyError) {
        // FIX: Show specific error to help debug clock skew vs wrong code
        const msg = verifyError.message || '';
        if (msg.includes('expired') || msg.includes('invalid')) {
          setError('Code rejected. Make sure your phone clock is set to automatic/network time, then try a fresh code.');
        } else {
          setError('Verify failed: ' + msg);
        }
        setMfaCode('');
        setSubmitting(false);
        return;
      }

      // Enrollment verified — redirect
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await checkRoleAndRedirect(session.user.id);
      }
      setSubmitting(false);
    } catch (e: any) {
      setError('Error: ' + (e?.message || String(e)));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: '#F5F5F0' }}
    >
      <div className="w-full" style={{ maxWidth: 360 }}>
        <h1
          className="text-center mb-6"
        >
          <img
            src="/Acuity.png"
            alt="Acuity"
            style={{ width: 220, maxWidth: '100%', height: 'auto', margin: '0 auto', objectFit: 'contain' }}
          />
        </h1>
        <p
          style={{
            color: '#8A9B94',
            fontSize: 14,
            letterSpacing: '0.25em',
            textAlign: 'center',
            marginBottom: 40,
          }}
        >
          {step === 'credentials' && 'COMMAND LOGIN'}
          {step === 'mfa-verify' && 'ENTER MFA CODE'}
          {step === 'mfa-enroll' && 'SET UP MFA'}
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
                border: '1px solid rgba(0,0,0,0.15)',
                color: '#1A1A1A',
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
          </>
        )}

        {/* STEP 2: MFA Verify (returning user with MFA) */}
        {step === 'mfa-verify' && (
          <>
            <p style={{ color: '#333333', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
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
                border: '1px solid rgba(0,0,0,0.15)',
                color: '#1A1A1A',
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
                color: '#666666',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              BACK TO LOGIN
            </button>
          </>
        )}

        {/* STEP 3: MFA Enrollment (first time) */}
        {step === 'mfa-enroll' && (
          <>
            <p style={{ color: '#333333', fontSize: 14, textAlign: 'center', marginBottom: 8 }}>
              Scan this QR code with your authenticator app
            </p>
            <p style={{ color: '#666666', fontSize: 12, textAlign: 'center', marginBottom: 20 }}>
              Google Authenticator, Authy, or Microsoft Authenticator
            </p>

            {qrCode && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <img
                  src={qrCode}
                  alt="MFA QR Code"
                  style={{ width: 200, height: 200, borderRadius: 8, background: '#FFF', padding: 8 }}
                />
              </div>
            )}

            {mfaSecret && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ color: '#666666', fontSize: 11, letterSpacing: '0.15em', textAlign: 'center', marginBottom: 4 }}>
                  OR ENTER THIS CODE MANUALLY
                </p>
                <p style={{
                  color: '#333333',
                  fontSize: 13,
                  textAlign: 'center',
                  fontFamily: "'IBM Plex Mono', monospace",
                  background: '#FFFFFF',
                  border: '1px solid #E2E2DE',
                  padding: '8px 12px',
                  borderRadius: 3,
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}>
                  {mfaSecret}
                </p>
              </div>
            )}

            <p style={{ color: '#FF9500', fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              Make sure your phone clock is set to automatic time
            </p>

            <div className="mb-6">
              <label style={labelStyle}>ENTER CODE FROM APP</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                style={{ ...inputStyle, textAlign: 'center', letterSpacing: '0.5em', fontSize: 24 }}
                onKeyDown={(e) => e.key === 'Enter' && handleMfaEnrollVerify()}
              />
            </div>

            {error && (
              <p style={{ color: '#FF3B30', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
                {error}
              </p>
            )}

            <button
              onClick={handleMfaEnrollVerify}
              disabled={submitting || mfaCode.length !== 6}
              style={{
                width: '100%',
                padding: 12,
                background: 'transparent',
                border: '1px solid rgba(0,0,0,0.15)',
                color: '#1A1A1A',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: '0.15em',
                cursor: submitting ? 'not-allowed' : 'pointer',
                borderRadius: 3,
                marginBottom: 12,
              }}
            >
              {submitting ? 'VERIFYING...' : 'ACTIVATE MFA'}
            </button>

            <button
              onClick={() => { setStep('credentials'); setMfaCode(''); setError(''); }}
              style={{
                width: '100%',
                padding: 8,
                background: 'transparent',
                border: 'none',
                color: '#666666',
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
