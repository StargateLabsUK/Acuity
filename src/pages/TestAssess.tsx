import { useState, useCallback } from 'react';
import { PRIORITY_COLORS } from '@/lib/herald-types';
import type { Assessment } from '@/lib/herald-types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface TransmissionResult {
  id: number;
  transcript: string;
  assessment: Assessment | null;
  error: string | null;
  duration: number;
}

async function callAssess(transcript: string): Promise<Assessment> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/assess`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ transcript, vehicle_type: 'DSA' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return await res.json();
}

function getTime() {
  const d = new Date();
  return d.getUTCHours().toString().padStart(2, '0') + ':' +
    d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
}

// ── ATMIST display (mirrors crew CasualtyReportView) ──

function AtmistCard({ casualtyKey, data }: { casualtyKey: string; data: Record<string, string | undefined> }) {
  const baseP = casualtyKey.replace(/-\d+$/, '');
  const col = PRIORITY_COLORS[baseP] ?? '#34C759';
  const label = data.A && data.A !== '—' ? `${baseP} — ${data.A}` : baseP;

  const fields: Array<{ k: string; label: string }> = [
    { k: 'A', label: 'Age / Sex' },
    { k: 'T', label: 'Time of Injury' },
    { k: 'M', label: 'Mechanism' },
    { k: 'I', label: 'Injuries' },
    { k: 'S', label: 'Signs / Vitals' },
    { k: 'T_treatment', label: 'Treatment Given' },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-3 mb-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-2xl font-bold" style={{ color: col }}>{baseP}</span>
        <span className="text-lg font-medium text-foreground">{label}</span>
      </div>
      {(data as any).name && (
        <div className="mb-2">
          <span className="text-lg font-bold" style={{ color: col }}>Name: </span>
          <span className="text-lg text-foreground">{(data as any).name}</span>
        </div>
      )}
      <div className="border border-border rounded-lg bg-background p-3">
        {fields.map(({ k, label: fLabel }) => {
          const val = data[k];
          if (!val || val === '—') return null;
          return (
            <div key={k} className="mb-2 last:mb-0">
              <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>{fLabel}: </span>
              <span className="text-lg text-foreground">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssessmentView({ result }: { result: TransmissionResult }) {
  const a = result.assessment;
  if (!a) return null;

  const p = a.priority ?? 'P3';
  const col = PRIORITY_COLORS[p] ?? '#34C759';
  const atmist = a.atmist ?? {};
  const casualtyKeys = Object.keys(atmist).sort();

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden mb-4">
      {/* Header */}
      <div className="p-3" style={{ background: `${col}1A`, borderLeft: `4px solid ${col}` }}>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <span className="text-2xl font-bold" style={{ color: col }}>{p}</span>
          <span className="text-lg font-bold rounded-sm px-2 py-0.5" style={{ color: col, border: `1px solid ${col}66`, background: `${col}1A` }}>
            {a.priority_label ?? ''}
          </span>
          <span className="text-lg text-foreground opacity-50">{getTime()} · {result.duration}ms</span>
        </div>
        <p className="text-lg text-foreground font-medium">{a.headline ?? '—'}</p>
        {a.incident_type && a.incident_type !== 'Unknown' && (
          <p className="text-lg mt-1" style={{ color: col }}>{a.incident_type}</p>
        )}
        {a.scene_location && (
          <p className="text-lg text-foreground opacity-70 mt-1">📍 {a.scene_location}</p>
        )}
        {a.receiving_hospital && a.receiving_hospital.length > 0 && (
          <p className="text-lg text-foreground opacity-70 mt-1">🏥 {a.receiving_hospital.join(', ')}</p>
        )}
        {a.structured?.number_of_casualties && (
          <p className="text-lg text-foreground opacity-70 mt-1">Casualties: {a.structured.number_of_casualties}</p>
        )}
      </div>

      <div className="p-3">
        {/* Safeguarding alert */}
        {a.safeguarding?.concern_identified && (
          <div className="rounded-lg p-3 mb-3" style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }}>
            <p className="text-lg font-bold" style={{ color: '#FF3B30' }}>⚠ SAFEGUARDING CONCERN</p>
            {a.safeguarding.details && (
              <p className="text-lg text-foreground mt-1">{a.safeguarding.details}</p>
            )}
            <div className="flex gap-3 mt-1 flex-wrap">
              {a.safeguarding.police_requested && (
                <span className="text-lg font-bold" style={{ color: '#FF9500' }}>Police requested</span>
              )}
              {a.safeguarding.referral_required && (
                <span className="text-lg font-bold" style={{ color: '#FF3B30' }}>Referral required</span>
              )}
            </div>
          </div>
        )}

        {/* ATMIST per casualty */}
        {casualtyKeys.length > 0 && (
          <div className="mb-3">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>
              ATMIST ({casualtyKeys.length} {casualtyKeys.length === 1 ? 'casualty' : 'casualties'})
            </p>
            {casualtyKeys.map(key => (
              <AtmistCard key={key} casualtyKey={key} data={(atmist[key] ?? {}) as Record<string, string | undefined>} />
            ))}
          </div>
        )}

        {/* Clinical History */}
        {a.clinical_history && (
          <div className="mb-3">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>CLINICAL HISTORY</p>
            <div className="rounded-lg border border-border bg-background p-3 text-lg text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {a.clinical_history}
            </div>
          </div>
        )}

        {/* Formatted Report (ePRF) */}
        {a.formatted_report && (
          <div className="mb-3">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#34C759' }}>ePRF REPORT</p>
            <div className="rounded-lg border border-border bg-background p-3 text-lg text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {a.formatted_report}
            </div>
          </div>
        )}

        {/* Clinical Findings (ABCDE) */}
        {a.clinical_findings && Object.values(a.clinical_findings).some(v => v && v !== 'Not assessed') && (
          <div className="mb-3">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>ABCDE CLINICAL FINDINGS</p>
            <div className="rounded-lg border border-border bg-background p-3">
              {(['A', 'B', 'C', 'D', 'E'] as const).map(k => {
                const val = a.clinical_findings?.[k];
                if (!val || val === 'Not assessed') return null;
                const labels: Record<string, string> = { A: 'Airway', B: 'Breathing', C: 'Circulation', D: 'Disability', E: 'Exposure' };
                return (
                  <div key={k} className="mb-2 last:mb-0">
                    <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>{labels[k]}: </span>
                    <span className="text-lg text-foreground">{val}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Treatment given */}
        {a.treatment_given && a.treatment_given.length > 0 && (
          <div className="mb-3">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>TREATMENT GIVEN</p>
            <div className="rounded-lg border border-border bg-background p-3">
              {a.treatment_given.map((t, i) => (
                <p key={i} className="text-lg text-foreground">• {t}</p>
              ))}
            </div>
          </div>
        )}

        {/* Raw transcript */}
        <details className="mt-3">
          <summary className="text-lg cursor-pointer" style={{ color: '#666666' }}>Show transcript + raw JSON</summary>
          <div className="mt-2 rounded-lg border border-border bg-background p-3">
            <p className="text-lg font-bold mb-1" style={{ color: '#666666' }}>TRANSCRIPT:</p>
            <p className="text-lg text-foreground opacity-70 italic mb-3">"{result.transcript}"</p>
            <p className="text-lg font-bold mb-1" style={{ color: '#666666' }}>RAW JSON:</p>
            <pre className="text-sm text-foreground opacity-60 whitespace-pre-wrap break-words font-mono">
              {JSON.stringify(a, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

// ── Main page ──

export default function TestAssess() {
  const [transcript, setTranscript] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<TransmissionResult[]>([]);
  const [nextId, setNextId] = useState(1);

  const handleSend = useCallback(async () => {
    const text = transcript.trim();
    if (!text || sending) return;

    setSending(true);
    const start = Date.now();
    const id = nextId;
    setNextId(n => n + 1);

    try {
      const assessment = await callAssess(text);
      setResults(prev => [{
        id,
        transcript: text,
        assessment: assessment as Assessment,
        error: null,
        duration: Date.now() - start,
      }, ...prev]);
    } catch (err: any) {
      setResults(prev => [{
        id,
        transcript: text,
        assessment: null,
        error: err.message ?? 'Unknown error',
        duration: Date.now() - start,
      }, ...prev]);
    }

    setSending(false);
    setTranscript('');
  }, [transcript, sending, nextId]);

  return (
    <div className="min-h-screen" style={{ background: '#F5F5F0' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border" style={{ background: '#EEEEE9' }}>
        <h1 className="text-lg font-bold tracking-[0.2em]" style={{ color: '#1E90FF' }}>
          ACUITY — ATMIST TEST
        </h1>
        <p className="text-lg text-foreground opacity-50 mt-1">
          Type a transcript below and send it to the AI. Results show exactly as crew would see them.
        </p>
      </div>

      {/* Input area */}
      <div className="px-4 py-4 border-b border-border" style={{ background: '#F5F5F0' }}>
        <textarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          placeholder="Control, this is Delta Four. We are on scene at..."
          rows={5}
          className="w-full text-lg px-4 py-3 rounded-lg border border-border bg-card text-foreground resize-y"
          style={{ minHeight: '120px' }}
          disabled={sending}
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleSend(); }}
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={handleSend}
            disabled={!transcript.trim() || sending}
            className="px-6 py-3 text-lg font-bold rounded-lg tracking-wide"
            style={{
              background: sending ? 'rgba(30,144,255,0.05)' : 'rgba(30,144,255,0.12)',
              border: '2px solid #1E90FF',
              color: '#1E90FF',
              opacity: !transcript.trim() || sending ? 0.4 : 1,
              cursor: !transcript.trim() || sending ? 'not-allowed' : 'pointer',
            }}
          >
            {sending ? 'ASSESSING...' : 'SEND TRANSMISSION'}
          </button>
          {results.length > 0 && (
            <button
              onClick={() => setResults([])}
              className="px-4 py-3 text-lg font-bold rounded-lg tracking-wide border border-border text-foreground opacity-50 bg-transparent"
              style={{ cursor: 'pointer' }}
            >
              CLEAR ALL
            </button>
          )}
          <span className="text-lg text-foreground opacity-30 ml-auto">
            {results.length} transmission{results.length !== 1 ? 's' : ''} sent
          </span>
        </div>
      </div>

      {/* Results */}
      <div className="px-4 py-4">
        {sending && (
          <div className="text-center py-8">
            <p className="text-lg text-foreground opacity-50">Sending to AI... this takes 5–15 seconds</p>
          </div>
        )}

        {results.map(result => (
          <div key={result.id}>
            {result.error ? (
              <div className="rounded-lg p-4 mb-4" style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }}>
                <p className="text-lg font-bold" style={{ color: '#FF3B30' }}>ERROR</p>
                <p className="text-lg text-foreground mt-1">{result.error}</p>
                <p className="text-lg text-foreground opacity-50 italic mt-2">"{result.transcript}"</p>
              </div>
            ) : (
              <AssessmentView result={result} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
