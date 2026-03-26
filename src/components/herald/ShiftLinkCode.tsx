import { useState, useEffect } from 'react';
import { generateLinkCode } from '@/lib/herald-session';
import { supabase } from '@/integrations/supabase/client';
import type { HeraldSession } from '@/lib/herald-session';

interface Props {
  session: HeraldSession;
}

export function ShiftLinkCode({ session }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [linkedCount, setLinkedCount] = useState(0);

  const generate = async () => {
    if (!session.shift_id) return;
    setLoading(true);
    setError('');
    const result = await generateLinkCode(session);
    if (result?.code) {
      setCode(result.code);
      setExpiresAt(result.expires_at);
    } else {
      setError('Failed to generate code');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (session.shift_id && !code) generate();
  }, [session.shift_id]);

  // Check if any device has linked
  useEffect(() => {
    if (!session.shift_id) return;
    const fetchCount = async () => {
      try {
        const { count } = await supabase
          .from('shift_link_codes')
          .select('*', { count: 'exact', head: true })
          .eq('shift_id', session.shift_id!)
          .not('used_at', 'is', null);
        setLinkedCount(count ?? 0);
      } catch {
        // silent
      }
    };
    fetchCount();
    const id = setInterval(fetchCount, 15_000);
    window.addEventListener('focus', fetchCount);
    return () => { clearInterval(id); window.removeEventListener('focus', fetchCount); };
  }, [session.shift_id]);

  // Countdown
  const [timeLeft, setTimeLeft] = useState('');
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('EXPIRED');
        setCode(null);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}:${String(secs).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{
        background: 'rgba(61, 255, 140, 0.04)',
        borderBottom: '1px solid rgba(61, 255, 140, 0.1)',
      }}
    >
      <span
        style={{
          color: 'hsl(var(--muted-foreground))',
          fontSize: 13,
          letterSpacing: '0.12em',
          fontFamily: "'IBM Plex Mono', monospace",
          whiteSpace: 'nowrap',
        }}
      >
        LINK CODE
      </span>

      {code ? (
        <>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '0.35em',
              color: 'hsl(147, 100%, 62%)',
            }}
          >
            {code}
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            {timeLeft}
          </span>
        </>
      ) : loading ? (
        <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>Generating…</span>
      ) : null}

      {linkedCount > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            color: 'hsl(147, 100%, 62%)',
            background: 'rgba(61, 255, 140, 0.08)',
            border: '1px solid rgba(61, 255, 140, 0.2)',
            borderRadius: 3,
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 10 }}>📱</span>
          {linkedCount} LINKED
        </span>
      )}

      <button
        onClick={generate}
        disabled={loading}
        style={{
          marginLeft: 'auto',
          fontSize: 12,
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: '0.1em',
          color: 'hsl(var(--muted-foreground))',
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.15)',
          padding: '4px 10px',
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        {code ? 'REFRESH' : 'GENERATE'}
      </button>

      {error && (
        <span style={{ color: '#FF3B30', fontSize: 12 }}>{error}</span>
      )}
    </div>
  );
}
