import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { updateReport } from '@/lib/herald-storage';
import { PRIORITY_COLORS, SERVICE_LABELS } from '@/lib/herald-types';
import type { Assessment, IncidentTransmission, ActionItem } from '@/lib/herald-types';
import { renderStructuredValue } from '@/components/StructuredValue';
import type { HeraldSession } from '@/lib/herald-session';
import { sanitizeAssessment, formatActionAge } from '@/lib/sanitize-assessment';

interface Incident {
  id: string;
  incident_number: string | null;
  headline: string | null;
  priority: string | null;
  service: string | null;
  status: string;
  transmission_count: number | null;
  latest_transmission_at: string | null;
  created_at: string | null;
  timestamp: string;
  transcript: string | null;
  assessment: Assessment | null;
  session_callsign: string | null;
  session_operator_id: string | null;
  confirmed_at: string | null;
}

interface Props {
  session: HeraldSession;
  onCloseIncident: (id: string, incidentNumber: string | null) => void;
}

function ResolvedActions({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-lg font-bold tracking-[0.15em] bg-transparent border-none cursor-pointer"
        style={{ color: '#888' }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
        RESOLVED ({items.length})
      </button>
      {open && (
        <div className="flex flex-col gap-1 mt-1">
          {items.map((item, i) => (
            <div key={i} className="rounded p-2 flex gap-2 items-start"
              style={{ background: 'rgba(136,136,136,0.06)', border: '1px solid rgba(136,136,136,0.15)' }}>
              <span className="text-lg flex-shrink-0" style={{ color: '#34C759' }}>✓</span>
              <span className="text-lg text-foreground opacity-50 line-through">{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function IncidentsTab({ session, onCloseIncident }: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transmissions, setTransmissions] = useState<IncidentTransmission[]>([]);
  const [closing, setClosing] = useState<string | null>(null);

  const fetchIncidents = useCallback(async () => {
    if (!session.shift_id) return;
    const { data } = await supabase
      .from('herald_reports')
      .select('*')
      .eq('shift_id', session.shift_id)
      .order('latest_transmission_at', { ascending: false, nullsFirst: false });

    if (data) {
      setIncidents(data.map((r: any) => ({
        ...r,
        assessment: r.assessment ? sanitizeAssessment(r.assessment as unknown as Assessment) : null,
      })));
    }
  }, [session.shift_id]);

  useEffect(() => { fetchIncidents(); }, [fetchIncidents]);

  useEffect(() => {
    if (!expandedId) { setTransmissions([]); return; }
    supabase
      .from('incident_transmissions')
      .select('*')
      .eq('report_id', expandedId)
      .order('timestamp', { ascending: true })
      .then(({ data }) => setTransmissions((data as unknown as IncidentTransmission[]) ?? []));
  }, [expandedId]);

  const handleClose = useCallback(async (inc: Incident) => {
    setClosing(inc.id);
  }, []);

  const confirmClose = useCallback(async (inc: Incident) => {
    const closedAt = inc.confirmed_at ?? new Date().toISOString();
    await supabase
      .from('herald_reports')
      .update({ status: 'closed', confirmed_at: closedAt })
      .eq('id', inc.id);
    // Also update local storage so field app immediately reflects closure
    updateReport(inc.id, { status: 'closed', confirmed_at: closedAt } as any);
    setClosing(null);
    onCloseIncident(inc.id, inc.incident_number);
    fetchIncidents();
  }, [onCloseIncident, fetchIncidents]);

  const active = incidents.filter((i) => i.status === 'active');
  const closed = incidents.filter((i) => i.status === 'closed');

  const getTime = (ts: string | null) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getUTCHours().toString().padStart(2, '0') + ':' +
      d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
  };

  const renderCard = (inc: Incident, muted: boolean) => {
    const p = inc.assessment?.priority ?? inc.priority ?? 'P3';
    const col = PRIORITY_COLORS[p] ?? '#34C759';
    const expanded = expandedId === inc.id;

    return (
      <div key={inc.id} className="mb-2 rounded-lg border border-border shadow-sm overflow-hidden"
        style={{ opacity: muted ? 0.6 : 1, background: 'hsl(var(--card))' }}>
        <button onClick={() => setExpandedId(expanded ? null : inc.id)}
          className="w-full text-left p-3">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
              style={{ color: col, border: `1px solid ${col}66`, minWidth: 36, textAlign: 'center' }}>
              {p}
            </span>
            {inc.incident_number && (
              <span className="text-lg font-semibold text-foreground border border-border rounded-sm px-1.5 py-0.5">
                #{inc.incident_number}
              </span>
            )}
            {(inc.transmission_count ?? 1) > 1 && (
              <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
                style={{ color: '#1E90FF', border: '1px solid rgba(30,144,255,0.3)', background: 'rgba(30,144,255,0.08)' }}>
                {inc.transmission_count} TX
              </span>
            )}
            <span className="text-lg text-foreground ml-auto">
              {getTime(inc.latest_transmission_at ?? inc.created_at)}
            </span>
          </div>
          <p className="truncate text-lg text-foreground font-semibold">
            {inc.assessment?.headline ?? inc.headline ?? 'No headline'}
          </p>
          {muted && inc.confirmed_at && (
            <p className="text-lg text-foreground opacity-50 mt-1">
              Closed {getTime(inc.confirmed_at)}
            </p>
          )}
        </button>

        {expanded && (
          <div className="px-3 pb-3 border-t border-border">
            {/* Transcript */}
            <div className="mt-3 p-3 border border-border rounded bg-card">
              <p className="text-lg text-foreground italic break-words">
                &ldquo;{inc.transcript ?? 'N/A'}&rdquo;
              </p>
            </div>

            {/* Structured fields with empty prompts */}
            {inc.assessment?.structured && Object.keys(inc.assessment.structured).length > 0 && (
              <div className="mt-3">
                <p className="text-lg font-bold tracking-[0.15em] mb-2" style={{ color: col }}>PROTOCOL FIELDS</p>
                <div className="p-3 border border-border rounded bg-card">
                  {Object.entries(inc.assessment.structured).map(([k, v]) => {
                    const isEmpty = !v || v === 'null';
                    const isIncNum = k === 'incident_number';
                    const isOpId = k === 'operator_id';
                    return (
                      <div key={k} className="mb-1">
                        <span className="text-lg font-bold" style={{ color: col }}>{k}: </span>
                        {isEmpty && (isIncNum || isOpId) ? (
                          <span className="text-lg" style={{ color: '#FF9500', opacity: 0.7 }}>
                            {isIncNum ? 'Awaiting incident number — say or tap to enter' : 'Awaiting operator ID — tap to enter'}
                          </span>
                        ) : (
                          <span className="text-lg text-foreground whitespace-pre-wrap">{renderStructuredValue(v)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Items */}
            {inc.assessment?.action_items && inc.assessment.action_items.length > 0 && (
              <div className="mt-3">
                <p className="text-lg font-bold tracking-[0.15em] mb-2" style={{ color: '#FF9500' }}>⚠ ACTION ITEMS</p>
                <div className="flex flex-col gap-1.5">
                  {inc.assessment.action_items.map((item, i) => {
                    const itemObj = typeof item === 'object' ? (item as any) : null;
                    const text = itemObj?.text || item;
                    const openedAt = itemObj?.opened_at || inc.created_at || inc.timestamp;
                    return (
                      <div key={i} className="rounded p-2.5 flex gap-2 items-start"
                        style={{ background: 'rgba(255,149,0,0.06)', border: '1px solid rgba(255,149,0,0.2)' }}>
                        <span className="text-lg font-bold flex-shrink-0" style={{ color: '#FF9500' }}>⚠</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-lg text-foreground">{text}</span>
                          <span className="text-lg ml-1 opacity-50" style={{ color: '#FF9500' }}>
                            — {formatActionAge(openedAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Resolved Action Items */}
            {(inc.assessment as any)?.resolved_action_items?.length > 0 && (
              <ResolvedActions items={(inc.assessment as any).resolved_action_items} />
            )}

            {/* Legacy Actions */}
            {inc.assessment?.actions && inc.assessment.actions.length > 0 && !(inc.assessment?.action_items?.length) && (
              <div className="mt-3">
                <p className="text-lg font-bold tracking-[0.15em] mb-2" style={{ color: col }}>ACTIONS</p>
                <div className="p-3 border border-border rounded bg-card">
                  {inc.assessment.actions.map((a, i) => (
                    <div key={i} className="flex gap-2 mb-1">
                      <span className="text-lg font-bold" style={{ color: col }}>{i + 1}.</span>
                      <span className="text-lg text-foreground">{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transmission log */}
            {transmissions.length > 1 && (
              <div className="mt-3">
                <p className="text-lg font-bold tracking-[0.15em] mb-2" style={{ color: '#1E90FF' }}>
                  TRANSMISSION LOG ({transmissions.length})
                </p>
                {transmissions.map((tx, i) => {
                  const txP = tx.priority ?? 'P3';
                  const txCol = PRIORITY_COLORS[txP] ?? '#34C759';
                  return (
                    <div key={tx.id} className="p-3 border border-border rounded bg-card mb-2">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>#{i + 1}</span>
                        <span className="text-lg font-bold rounded-sm px-1.5 py-0.5" style={{ color: txCol, border: `1px solid ${txCol}66` }}>{txP}</span>
                        <span className="text-lg text-foreground">{getTime(tx.timestamp)}</span>
                        {tx.session_callsign && <span className="text-lg font-semibold" style={{ color: '#3DFF8C' }}>{tx.session_callsign}</span>}
                      </div>
                      {tx.headline && <p className="text-lg text-foreground font-medium mb-1">{tx.headline}</p>}
                      {tx.transcript && <p className="text-lg text-foreground italic opacity-80">&ldquo;{tx.transcript}&rdquo;</p>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Close button */}
            {inc.status === 'active' && (
              <div className="mt-3">
                {closing === inc.id ? (
                  <div className="p-3 border rounded" style={{ borderColor: '#FF9500', background: 'rgba(255,149,0,0.08)' }}>
                    <p className="text-lg font-bold mb-2" style={{ color: '#FF9500' }}>
                      Close incident {inc.incident_number ? `#${inc.incident_number}` : ''}?
                    </p>
                    <p className="text-lg text-foreground mb-3 opacity-70">
                      This marks the incident as handed over.
                    </p>
                    <div className="flex gap-3">
                      <button onClick={() => setClosing(null)}
                        className="flex-1 py-2 text-lg font-bold border border-border rounded-sm bg-transparent text-foreground">
                        CANCEL
                      </button>
                      <button onClick={() => confirmClose(inc)}
                        className="flex-1 py-2 text-lg font-bold rounded-sm"
                        style={{ background: 'rgba(255,149,0,0.15)', border: '2px solid #FF9500', color: '#FF9500' }}>
                        CLOSE INCIDENT
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => handleClose(inc)}
                    className="w-full py-2.5 text-lg font-bold rounded-sm tracking-wide"
                    style={{ background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)', color: '#FF9500' }}>
                    CLOSE INCIDENT
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto px-3 py-3">
      {/* Active */}
      <p className="text-lg font-bold tracking-[0.2em] mb-3" style={{ color: '#FF9500' }}>
        ACTIVE ({active.length})
      </p>
      {active.length === 0 ? (
        <p className="text-lg text-foreground opacity-50 mb-6">No active incidents</p>
      ) : (
        <div className="mb-6">{active.map((i) => renderCard(i, false))}</div>
      )}

      {/* Closed */}
      <p className="text-lg font-bold tracking-[0.2em] mb-3 text-foreground opacity-50">
        CLOSED ({closed.length})
      </p>
      {closed.length === 0 ? (
        <p className="text-lg text-foreground opacity-30">No closed incidents</p>
      ) : (
        closed.map((i) => renderCard(i, true))
      )}
    </div>
  );
}
