import { useState, useCallback } from 'react';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { SERVICE_EMOJIS, PRIORITY_COLORS } from '@/lib/herald-types';
import type { ReportDiff } from '@/lib/herald-diff';

interface Props {
  reports: CommandReport[];
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-xs tracking-[0.15em] font-bold px-3 py-1 rounded-sm bg-transparent cursor-pointer"
      style={{ color: '#3DFF8C', border: '1px solid rgba(61,255,140,0.3)' }}
    >
      {copied ? 'COPIED' : 'COPY RECOMMENDATIONS'}
    </button>
  );
}

export function TrainingTab({ reports }: Props) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);

  const confirmed = reports.filter((r) => r.confirmed_at);
  const editedReports = reports.filter((r) => (r as any).edited === true);
  const noEditReports = confirmed.filter((r) => !(r as any).edited);

  const totalConfirmed = confirmed.length;
  const noEditPct = totalConfirmed > 0 ? Math.round((noEditReports.length / totalConfirmed) * 100) : 0;
  const editPct = totalConfirmed > 0 ? Math.round((editedReports.length / totalConfirmed) * 100) : 0;

  // Most commonly corrected field
  const fieldCounts: Record<string, number> = {};
  editedReports.forEach((r) => {
    const diff = (r as any).diff as ReportDiff | null;
    diff?.fields_changed?.forEach((f: string) => {
      fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    });
  });
  const topField = Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  const analyseWithAI = useCallback(async () => {
    setAnalysing(true);
    setAnalysis(null);
    try {
      const diffs = editedReports
        .slice(0, 100)
        .map((r) => (r as any).diff)
        .filter(Boolean);

      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/assess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ mode: 'analyse_training_data', diffs }),
      });

      if (!res.ok) throw new Error('Analysis failed');
      const data = await res.json();
      setAnalysis(data.analysis || JSON.stringify(data, null, 2));
    } catch {
      setAnalysis('Failed to analyse corrections. Please try again.');
    } finally {
      setAnalysing(false);
    }
  }, [editedReports]);

  return (
    <div className="flex flex-col h-full overflow-y-auto px-3 md:px-4 py-3" style={{ scrollbarWidth: 'thin' }}>
      {/* Section 1: Edit Summary */}
      <p className="text-xs font-bold tracking-[0.25em] mb-3" style={{ color: '#3DFF8C' }}>
        EDIT SUMMARY
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        <div className="px-3 py-2.5 rounded border border-border bg-card text-center">
          <div className="text-2xl font-bold text-foreground">{totalConfirmed}</div>
          <div className="text-[9px] tracking-[0.15em] text-foreground opacity-70 mt-1">CONFIRMED</div>
        </div>
        <div className="px-3 py-2.5 rounded border border-border bg-card text-center">
          <div className="text-2xl font-bold" style={{ color: '#3DFF8C' }}>{noEditPct}%</div>
          <div className="text-[9px] tracking-[0.15em] text-foreground opacity-70 mt-1">AI CORRECT</div>
        </div>
        <div className="px-3 py-2.5 rounded border border-border bg-card text-center">
          <div className="text-2xl font-bold" style={{ color: '#FF9500' }}>{editPct}%</div>
          <div className="text-[9px] tracking-[0.15em] text-foreground opacity-70 mt-1">AI CORRECTED</div>
        </div>
        <div className="px-3 py-2.5 rounded border border-border bg-card text-center">
          <div className="text-sm font-bold mt-1" style={{ color: '#C8D0CC' }}>{topField}</div>
          <div className="text-[9px] tracking-[0.15em] text-foreground opacity-70 mt-1">MOST CORRECTED</div>
        </div>
      </div>

      {/* Section 2: Corrections Log */}
      <p className="text-xs font-bold tracking-[0.25em] mb-3" style={{ color: '#FF9500' }}>
        CORRECTIONS LOG
      </p>

      {editedReports.length === 0 ? (
        <p className="text-sm text-foreground opacity-50 mb-6">No corrected reports yet</p>
      ) : (
        <div className="mb-6">
          {editedReports.map((r) => {
            const diff = (r as any).diff as ReportDiff | null;
            if (!diff) return null;
            const service = r.assessment?.service ?? r.service ?? 'unknown';
            const callsign = r.assessment?.structured?.callsign ?? 'UNKNOWN';
            const time = new Date(r.created_at ?? r.timestamp).toISOString().replace('T', ' ').slice(0, 19) + 'Z';

            return (
              <div
                key={r.id}
                className="mb-2 rounded"
                style={{ border: '1px solid #0F1820', padding: '14px' }}
              >
                {/* Top row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{SERVICE_EMOJIS[service] ?? '📻'}</span>
                    <span className="text-sm font-bold text-foreground">{callsign}</span>
                  </div>
                  <span className="text-xs text-foreground opacity-70">{time}</span>
                </div>

                {/* Fields corrected pills */}
                <div className="flex items-center gap-1 flex-wrap mb-2">
                  <span className="text-[9px] tracking-[0.15em] font-bold" style={{ color: '#FF9500' }}>FIELDS CORRECTED</span>
                  {diff.fields_changed.map((f) => (
                    <span
                      key={f}
                      className="text-[10px] rounded-sm"
                      style={{
                        color: '#FF9500',
                        border: '1px solid rgba(255,149,0,0.3)',
                        padding: '2px 8px',
                        borderRadius: '2px 10px',
                      }}
                    >
                      {f}
                    </span>
                  ))}
                </div>

                {/* Priority change */}
                {diff.priority_changed && (
                  <div className="flex items-center gap-2 mb-2 px-2 py-1 rounded" style={{ background: 'rgba(255,149,0,0.08)' }}>
                    <span className="text-[9px] tracking-[0.15em] font-bold" style={{ color: '#FF9500' }}>PRIORITY CHANGED:</span>
                    <span className="text-sm font-bold" style={{ color: PRIORITY_COLORS[diff.original_priority ?? ''] ?? '#fff' }}>
                      {diff.original_priority}
                    </span>
                    <span className="text-xs text-foreground opacity-50">→</span>
                    <span className="text-sm font-bold" style={{ color: PRIORITY_COLORS[diff.corrected_priority ?? ''] ?? '#fff' }}>
                      {diff.corrected_priority}
                    </span>
                  </div>
                )}

                {/* Each changed field */}
                {diff.changes.filter((c) => c.field !== 'priority').map((c) => (
                  <div key={c.field} className="mb-1.5">
                    <div className="flex gap-2">
                      <span className="text-[9px] tracking-[0.1em]" style={{ color: '#1E3028' }}>ORIGINAL</span>
                      <span className="text-[11px] italic" style={{ color: '#4A6058' }}>{c.original || '—'}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[9px] tracking-[0.1em]" style={{ color: '#3DFF8C' }}>CORRECTED</span>
                      <span className="text-[11px]" style={{ color: '#8A9890' }}>{c.corrected || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Section 3: Analyse with AI */}
      {!analysing && !analysis && (
        <button
          onClick={analyseWithAI}
          className="w-full text-left cursor-pointer mb-4"
          style={{
            background: 'rgba(61,255,140,0.06)',
            border: '1px solid #3DFF8C',
            color: '#3DFF8C',
            padding: '14px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '11px',
            letterSpacing: '0.2em',
          }}
        >
          ANALYSE CORRECTIONS WITH AI
        </button>
      )}

      {analysing && (
        <div className="flex items-center gap-3 mb-4 px-4 py-3">
          <div
            className="animate-spin-herald w-5 h-5 rounded-full flex-shrink-0"
            style={{ border: '2px solid hsl(var(--border))', borderTopColor: 'hsl(var(--primary))' }}
          />
          <span className="text-[10px] tracking-[0.2em]" style={{ color: '#1E3028' }}>
            CLAUDE IS ANALYSING CORRECTIONS
          </span>
        </div>
      )}

      {analysis && (
        <div
          className="mb-4 rounded"
          style={{ border: '1px solid rgba(61,255,140,0.2)', padding: '16px' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[9px] tracking-[0.25em] font-bold" style={{ color: '#3DFF8C' }}>
              AI TRAINING ANALYSIS
            </span>
            <CopyBtn text={analysis} />
          </div>
          <div
            className="text-[13px] leading-[1.8] whitespace-pre-wrap"
            style={{ color: '#8A9890' }}
          >
            {analysis}
          </div>
          <p className="text-[10px] mt-4 opacity-70" style={{ color: '#8A9890' }}>
            USE THESE RECOMMENDATIONS to update your assess prompt in the edge function.
          </p>
        </div>
      )}
    </div>
  );
}
