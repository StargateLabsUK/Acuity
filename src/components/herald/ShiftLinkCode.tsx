import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { ensureSessionShiftId, generateLinkCode } from '@/lib/herald-session';
import { normalizeLatestCrewRows } from '@/lib/normalize-latest-crew-rows';
import { supabase } from '@/integrations/supabase/client';
import type { HeraldSession } from '@/lib/herald-session';

interface Props {
  session: HeraldSession;
}

interface LinkedCrew {
  operator_id: string | null;
  used_at: string;
  left_at: string | null;
}

export function ShiftLinkCode({ session }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<HeraldSession>(session);
  const [generating, setGenerating] = useState(false);
  const [refreshingCrew, setRefreshingCrew] = useState(false);
  const [error, setError] = useState('');
  const [linkedCrew, setLinkedCrew] = useState<LinkedCrew[]>([]);

  const generate = async () => {
    setGenerating(true);
    setError('');
    const ensured = await ensureSessionShiftId(activeSession);
    if (ensured.error) {
      setError(ensured.error);
      setGenerating(false);
      return;
    }
    setActiveSession(ensured.session);
    const result = await generateLinkCode(ensured.session);
    if (result?.code) {
      setCode(result.code);
      setExpiresAt(result.expires_at);
    } else {
      setError(result.error ?? 'Failed to generate code — make sure your shift is active and try again');
    }
    setGenerating(false);
  };

  useEffect(() => {
    setActiveSession(session);
  }, [session]);

  useEffect(() => {
    if (!code) generate();
  }, [activeSession.shift_id]);

  // Fetch linked crew members
  useEffect(() => {
    if (!activeSession.shift_id) return;
    const fetchCrew = async (showSpinner = false) => {
      if (showSpinner) setRefreshingCrew(true);
      try {
        const { data } = await supabase
          .from('shift_link_codes')
          .select('operator_id, used_at, left_at')
          .eq('shift_id', activeSession.shift_id!)
          .not('used_at', 'is', null)
          .not('operator_id', 'is', null);
        setLinkedCrew(normalizeLatestCrewRows((data as LinkedCrew[]) ?? []));
      } catch {
        // silent
      } finally {
        if (showSpinner) setRefreshingCrew(false);
      }
    };
    fetchCrew();

    // Realtime subscription for instant updates
    const channel = supabase
      .channel(`crew-${activeSession.shift_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shift_link_codes',
          filter: `shift_id=eq.${activeSession.shift_id}`,
        },
        () => { fetchCrew(); }
      )
      .subscribe();

    const id = setInterval(fetchCrew, 30_000);
    window.addEventListener('focus', fetchCrew);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', fetchCrew);
      supabase.removeChannel(channel);
    };
  }, [activeSession.shift_id]);

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
      style={{
        background: 'rgba(61, 255, 140, 0.04)',
        borderBottom: '1px solid rgba(61, 255, 140, 0.1)',
      }}
    >
      {/* Top row: link code + generate button */}
      <div className="flex items-center gap-4 px-4 py-3">
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
        ) : generating ? (
          <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: 13 }}>Generating…</span>
        ) : null}

        <button
          onClick={generate}
          disabled={generating}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: '0.1em',
            color: 'hsl(var(--muted-foreground))',
            background: 'transparent',
            border: '1px solid rgba(0,0,0,0.12)',
            padding: '4px 10px',
            borderRadius: 3,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <RefreshCw
            size={12}
            className={generating ? 'animate-spin-acuity' : ''}
            style={{ animation: generating ? 'spin-acuity 0.9s linear infinite' : 'none' }}
          />
          {generating ? (code ? 'REFRESHING' : 'GENERATING') : (code ? 'REFRESH' : 'GENERATE')}
        </button>

        <button
          onClick={() => {
            if (activeSession.shift_id) {
              setRefreshingCrew(true);
              supabase
                .from('shift_link_codes')
                .select('operator_id, used_at, left_at')
                .eq('shift_id', activeSession.shift_id!)
                .not('used_at', 'is', null)
                .not('operator_id', 'is', null)
                .then(({ data }) => setLinkedCrew(normalizeLatestCrewRows((data as LinkedCrew[]) ?? [])))
                .finally(() => setRefreshingCrew(false));
            }
          }}
          disabled={refreshingCrew}
          title="Refresh linked crew"
          style={{
            fontSize: 12,
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: '0.1em',
            color: 'hsl(var(--muted-foreground))',
            background: 'transparent',
            border: '1px solid rgba(0,0,0,0.12)',
            padding: '4px 8px',
            borderRadius: 3,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RefreshCw
            size={12}
            className={refreshingCrew ? 'animate-spin-acuity' : ''}
            style={{ animation: refreshingCrew ? 'spin-acuity 0.9s linear infinite' : 'none' }}
          />
        </button>

        {error && (
          <span style={{ color: '#FF3B30', fontSize: 12 }}>{error}</span>
        )}
      </div>

      {/* Linked crew row */}
      {linkedCrew.length > 0 && (
        <div
          className="flex items-center gap-3 px-4 pb-3"
          style={{ flexWrap: 'wrap' }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: '0.12em',
              color: 'hsl(var(--muted-foreground))',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            CREW
          </span>
          {linkedCrew.map((crew, i) => {
            const hasLeft = !!crew.left_at;
            return (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 13,
                  fontWeight: 600,
                  color: hasLeft ? '#4A6058' : 'hsl(147, 100%, 62%)',
                  background: hasLeft ? 'rgba(74, 96, 88, 0.08)' : 'rgba(61, 255, 140, 0.08)',
                  border: `1px solid ${hasLeft ? 'rgba(74, 96, 88, 0.2)' : 'rgba(61, 255, 140, 0.2)'}`,
                  borderRadius: 3,
                  padding: '3px 10px',
                  whiteSpace: 'nowrap',
                  textDecoration: hasLeft ? 'line-through' : 'none',
                  opacity: hasLeft ? 0.6 : 1,
                }}
              >
                <span style={{ fontSize: 11 }}>{hasLeft ? '⏏' : '📱'}</span>
                {crew.operator_id || 'Unknown'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
