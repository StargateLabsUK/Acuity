import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getReports, updateReport } from '@/lib/herald-storage';
import { PRIORITY_COLORS } from '@/lib/herald-types';
import type { Assessment, IncidentTransmission, ActionItem } from '@/lib/herald-types';
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
  receiving_hospital?: string | null;
}

interface CasualtyData {
  key: string; // e.g. "P1", "P1-2", "P2"
  priority: string; // base priority e.g. "P1"
  label: string; // e.g. "P1 — Male, approximately 40"
  atmist: Record<string, string>;
  receivingHospital: string;
  actionItems: (string | ActionItem)[];
  resolvedItems: ActionItem[];
}

interface Props {
  session: HeraldSession;
  onCloseIncident: (id: string, incidentNumber: string | null) => void;
  refreshKey?: number;
}

// ── Helpers ──

function getTime(ts: string | null) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getUTCHours().toString().padStart(2, '0') + ':' +
    d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={copy}
      className="text-lg text-foreground border border-border px-3 py-1.5 rounded-sm bg-transparent cursor-pointer tracking-wide hover:border-primary transition-colors">
      {copied ? 'COPIED' : label}
    </button>
  );
}

/** Extract per-casualty data from the incident assessment */
function extractCasualties(inc: Incident): CasualtyData[] {
  const a = inc.assessment;
  if (!a) return [];

  const atmist = a.atmist;
  if (!atmist || Object.keys(atmist).length === 0) {
    // Single casualty with no ATMIST keying — build from top-level fields
    const hasClinic = a.clinical_findings || a.clinical_history || a.headline;
    if (!hasClinic) return [];

    const singleAtmist: Record<string, string> = {};
    if (a.clinical_findings) {
      // Map ABCDE into pseudo-ATMIST
      singleAtmist.A = a.clinical_findings.A ?? '—';
      singleAtmist.S = [a.clinical_findings.B, a.clinical_findings.C, a.clinical_findings.D]
        .filter(Boolean).join('; ') || '—';
    }
    if (a.clinical_history) singleAtmist.M = a.clinical_history;
    if (a.treatment_given?.length) singleAtmist.T_treatment = a.treatment_given.join('; ');

    const assessHospital: string[] = a.receiving_hospital ?? [];
    const reportHospital = inc.receiving_hospital;
    const hospital = reportHospital || (assessHospital.length > 0 ? assessHospital[0] : '');

    // Build label from headline
    const demo = a.headline ?? 'Casualty';
    const p = a.priority ?? inc.priority ?? 'P3';

    return [{
      key: p,
      priority: p,
      label: `${p} — ${demo}`,
      atmist: singleAtmist,
      receivingHospital: hospital,
      actionItems: filterActionItemsForCasualty(a, p, true),
      resolvedItems: filterResolvedForCasualty(a, p, true),
    }];
  }

  // Multi-casualty or keyed single
  const assessHospitals: string[] = a.receiving_hospital ?? [];
  const reportHospital = inc.receiving_hospital;
  const keys = Object.keys(atmist).sort();

  return keys
    .filter(key => {
      // Only include casualties with actual clinical data
      const val = (atmist as any)[key];
      if (!val) return false;
      const fields = ['A', 'T', 'M', 'I', 'S', 'T_treatment'];
      return fields.some(f => val[f] && val[f] !== '—' && val[f] !== 'null');
    })
    .map((key, idx) => {
      const val = (atmist as any)[key];
      const baseP = key.replace(/-\d+$/, '');

      // Build demographic label from Age field
      const ageField = val?.A ?? '';
      const label = ageField && ageField !== '—'
        ? `${baseP} — ${ageField}`
        : baseP;

      // Per-casualty hospital: if multiple hospitals listed, try to match by index
      let hospital = '';
      if (reportHospital) {
        hospital = reportHospital;
      } else if (assessHospitals.length === 1) {
        hospital = assessHospitals[0];
      } else if (assessHospitals.length > idx) {
        hospital = assessHospitals[idx];
      }

      const isSingle = keys.length === 1;

      return {
        key,
        priority: baseP,
        label,
        atmist: {
          A: val?.A ?? '—',
          T: val?.T ?? '—',
          M: val?.M ?? '—',
          I: val?.I ?? '—',
          S: val?.S ?? '—',
          T_treatment: val?.T_treatment ?? '—',
        },
        receivingHospital: hospital,
        actionItems: filterActionItemsForCasualty(a, key, isSingle),
        resolvedItems: filterResolvedForCasualty(a, key, isSingle),
      };
    });
}

/** Filter active action items relevant to a specific casualty */
function filterActionItemsForCasualty(a: Assessment, casualtyKey: string, isSingle: boolean): (string | ActionItem)[] {
  const items: (string | ActionItem)[] = a.action_items ?? [];
  if (isSingle) {
    return items.filter(item => {
      if (typeof item === 'object' && (item as ActionItem).resolved_at) return false;
      return true;
    });
  }
  const baseP = casualtyKey.replace(/-\d+$/, '');
  return items.filter(item => {
    const text = typeof item === 'object' ? (item as ActionItem).text : item;
    if (typeof item === 'object' && (item as ActionItem).resolved_at) return false;
    // Include if it mentions this priority, or is generic (no priority mentioned)
    const mentionsP = /P[1-4]/.test(text);
    return !mentionsP || text.includes(baseP);
  });
}

function filterResolvedForCasualty(a: Assessment, casualtyKey: string, isSingle: boolean): ActionItem[] {
  const items: (string | ActionItem)[] = a.action_items ?? [];
  const resolved: ActionItem[] = [];
  const baseP = casualtyKey.replace(/-\d+$/, '');
  for (const item of items) {
    if (typeof item === 'object' && (item as ActionItem).resolved_at) {
      if (isSingle) {
        resolved.push(item as ActionItem);
      } else {
        const text = (item as ActionItem).text;
        const mentionsP = /P[1-4]/.test(text);
        if (!mentionsP || text.includes(baseP)) {
          resolved.push(item as ActionItem);
        }
      }
    }
  }
  // Also check resolved_action_items
  const resolvedItems: ActionItem[] = (a as any)?.resolved_action_items ?? [];
  for (const item of resolvedItems) {
    if (isSingle) {
      resolved.push(item);
    } else {
      const mentionsP = /P[1-4]/.test(item.text);
      if (!mentionsP || item.text.includes(baseP)) {
        resolved.push(item);
      }
    }
  }
  return resolved;
}

/** Build ePRF text for a single casualty */
function buildCasualtyEprf(cas: CasualtyData, inc: Incident): string {
  const ts = new Date(inc.timestamp);
  const dateStr = ts.toISOString().slice(0, 10);
  const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' +
    ts.getUTCMinutes().toString().padStart(2, '0') + ':' +
    ts.getUTCSeconds().toString().padStart(2, '0') + 'Z';

  const a = inc.assessment;
  const incidentNum = inc.incident_number ?? (a?.structured as any)?.incident_number ?? '—';
  const activeItems = cas.actionItems.map(i => typeof i === 'object' ? (i as ActionItem).text : i);

  return `ePRF — PATIENT HANDOVER
═══════════════════════════
INCIDENT: ${incidentNum}
DATE/TIME: ${dateStr} ${timeStr}
CALLSIGN: ${inc.session_callsign ?? '—'}
INCIDENT TYPE: ${a?.incident_type ?? a?.protocol ?? 'Unknown'}${a?.major_incident ? ' [MAJOR INCIDENT]' : ''}
SCENE: ${a?.scene_location || 'Not specified'}

PATIENT: ${cas.label}
PRIORITY: ${cas.priority}

ATMIST:
  Age/Sex: ${cas.atmist.A}
  Time of Injury: ${cas.atmist.T}
  Mechanism: ${cas.atmist.M}
  Injuries: ${cas.atmist.I}
  Signs/Vitals: ${cas.atmist.S}
  Treatment: ${cas.atmist.T_treatment}

RECEIVING HOSPITAL: ${cas.receivingHospital || 'Not confirmed'}
${activeItems.length > 0 ? `\nACTION ITEMS:\n${activeItems.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : ''}
═══════════════════════════
Generated by Herald Radio Intelligence`;
}

// ── Sub-components ──

function ResolvedActions({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
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

function CasualtyCard({ cas, inc }: { cas: CasualtyData; inc: Incident }) {
  const [expanded, setExpanded] = useState(false);
  const [showEprf, setShowEprf] = useState(false);
  const col = PRIORITY_COLORS[cas.priority] ?? '#34C759';

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden mb-2">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3">
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown size={20} style={{ color: col }} className="flex-shrink-0" />
            : <ChevronRight size={20} style={{ color: col }} className="flex-shrink-0" />}
          <span className="text-lg font-bold rounded-sm px-2 py-0.5 flex-shrink-0"
            style={{ color: col, border: `1px solid ${col}66`, background: `${col}1A` }}>
            {cas.priority}
          </span>
          <span className="text-lg text-foreground font-medium flex-1 min-w-0 truncate">
            {cas.label.replace(/^P\d\s*—\s*/, '')}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-4 border-t border-border">
          {/* 1. Priority + headline */}
          <div className="mt-3 rounded p-3" style={{ background: `${col}1A`, borderLeft: `4px solid ${col}` }}>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-2xl font-bold" style={{ color: col }}>{cas.priority}</span>
              <span className="text-lg font-bold" style={{ color: col }}>
                {inc.assessment?.priority_label ?? ''}
              </span>
            </div>
            <p className="text-lg text-foreground font-medium">
              {inc.assessment?.headline ?? inc.headline ?? ''}
            </p>
          </div>

          {/* 2. ATMIST — formatted for reading aloud */}
          <div className="mt-4">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>
              ATMIST
            </p>
            <div className="border border-border rounded bg-card p-3">
              {[
                { k: 'A', label: 'Age / Sex' },
                { k: 'T', label: 'Time of Injury' },
                { k: 'M', label: 'Mechanism' },
                { k: 'I', label: 'Injuries' },
                { k: 'S', label: 'Signs / Vitals' },
                { k: 'T_treatment', label: 'Treatment Given' },
              ].map(({ k, label }) => (
                <div key={k} className="mb-2 last:mb-0">
                  <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>{label}: </span>
                  <span className="text-lg text-foreground break-words">{cas.atmist[k] ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Receiving Hospital — prominent */}
          <div className="mt-4">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: col }}>
              RECEIVING HOSPITAL
            </p>
            {cas.receivingHospital ? (
              <div className="border border-border rounded p-3" style={{ background: `${col}0D` }}>
                <p className="text-xl text-foreground font-bold break-words">{cas.receivingHospital}</p>
              </div>
            ) : (
              <div className="rounded p-3" style={{ color: '#FF9500', background: 'rgba(255,149,0,0.06)', border: '1px dashed rgba(255,149,0,0.3)' }}>
                <p className="text-lg">No receiving hospital confirmed — contact Control</p>
              </div>
            )}
          </div>

          {/* 4. Active action items for this patient */}
          {cas.actionItems.length > 0 && (
            <div className="mt-4">
              <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#FF9500' }}>
                ⚠ ACTION ITEMS
              </p>
              <div className="flex flex-col gap-1.5">
                {cas.actionItems.map((item, i) => {
                  const text = typeof item === 'object' ? (item as ActionItem).text : item;
                  const openedAt = typeof item === 'object' ? (item as ActionItem).opened_at : inc.timestamp;
                  return (
                    <div key={i} className="rounded p-2.5 flex gap-2 items-start"
                      style={{ background: 'rgba(255,149,0,0.06)', border: '1px solid rgba(255,149,0,0.2)' }}>
                      <span className="text-lg font-bold flex-shrink-0" style={{ color: '#FF9500' }}>⚠</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-lg text-foreground break-words">{text}</span>
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

          {/* Resolved */}
          <ResolvedActions items={cas.resolvedItems} />

          {/* 5. ePRF button */}
          <div className="mt-4">
            <button
              onClick={(e) => { e.stopPropagation(); setShowEprf(!showEprf); }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded text-lg font-bold tracking-[0.15em] border cursor-pointer transition-colors"
              style={{
                color: showEprf ? '#1A1E24' : 'hsl(var(--primary))',
                background: showEprf ? 'hsl(var(--primary))' : 'transparent',
                borderColor: 'hsl(var(--primary))',
              }}>
              <FileText size={20} />
              {showEprf ? 'HIDE ePRF' : 'VIEW ePRF'}
            </button>
            {showEprf && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-lg font-bold tracking-[0.2em]" style={{ color: 'hsl(var(--primary))' }}>
                    ePRF — PATIENT HANDOVER
                  </p>
                  <CopyBtn text={buildCasualtyEprf(cas, inc)} label="COPY ePRF" />
                </div>
                <div className="border border-border rounded bg-card p-3">
                  <div className="text-lg text-foreground leading-7 whitespace-pre-wrap break-words">
                    {buildCasualtyEprf(cas, inc)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentHeader({ inc }: { inc: Incident }) {
  const [expanded, setExpanded] = useState(false);
  const a = inc.assessment;
  const p = a?.priority ?? inc.priority ?? 'P3';
  const col = PRIORITY_COLORS[p] ?? '#34C759';

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden mb-3">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3">
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown size={18} className="text-foreground opacity-50 flex-shrink-0" />
            : <ChevronRight size={18} className="text-foreground opacity-50 flex-shrink-0" />}
          <span className="text-lg font-bold tracking-[0.15em]" style={{ color: col }}>INCIDENT</span>
          {inc.incident_number && (
            <span className="text-lg font-semibold text-foreground border border-border rounded-sm px-1.5 py-0.5">
              #{inc.incident_number}
            </span>
          )}
          <span className="text-lg text-foreground ml-auto">
            {getTime(inc.latest_transmission_at ?? inc.created_at)}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border">
          <div className="mt-2 flex flex-col gap-1.5">
            {a?.incident_type && a.incident_type !== 'Unknown' && (
              <div>
                <span className="text-lg font-bold" style={{ color: col }}>Type: </span>
                <span className="text-lg text-foreground">{a.incident_type}{a.major_incident ? ' [MAJOR]' : ''}</span>
              </div>
            )}
            {a?.scene_location && (
              <div>
                <span className="text-lg font-bold" style={{ color: col }}>Location: </span>
                <span className="text-lg text-foreground">{a.scene_location}</span>
              </div>
            )}
            <div>
              <span className="text-lg font-bold" style={{ color: col }}>Time: </span>
              <span className="text-lg text-foreground">{getTime(inc.timestamp)}</span>
            </div>
            {(inc.transmission_count ?? 1) > 1 && (
              <div>
                <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>Transmissions: </span>
                <span className="text-lg text-foreground">{inc.transmission_count}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──

export function IncidentsTab({ session, onCloseIncident, refreshKey }: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [closing, setClosing] = useState<string | null>(null);

  const fetchIncidents = useCallback(async () => {
    const localIncidents: Incident[] = getReports()
      .filter((r) =>
        r.session_callsign === session.callsign &&
        new Date(r.timestamp).toISOString().slice(0, 10) === session.session_date &&
        (r.status ?? 'active') === 'active'
      )
      .map((r) => ({
        id: r.id,
        incident_number: r.incident_number ?? null,
        headline: r.headline ?? null,
        priority: r.priority ?? null,
        service: r.service ?? null,
        status: r.status ?? 'active',
        transmission_count: r.transmission_count ?? null,
        latest_transmission_at: r.latest_transmission_at ?? r.timestamp,
        created_at: r.timestamp,
        timestamp: r.timestamp,
        transcript: r.transcript ?? null,
        assessment: r.assessment ? sanitizeAssessment(r.assessment as unknown as Assessment) : null,
        session_callsign: r.session_callsign ?? null,
        session_operator_id: r.session_operator_id ?? null,
        confirmed_at: r.confirmed_at ?? null,
      }));

    let remoteIncidents: Incident[] = [];
    const todayStart = session.session_date + 'T00:00:00.000Z';

    let query = supabase
      .from('herald_reports')
      .select('*')
      .eq('session_callsign', session.callsign)
      .gte('created_at', todayStart)
      .order('latest_transmission_at', { ascending: false, nullsFirst: false });

    if (session.shift_id) {
      query = supabase
        .from('herald_reports')
        .select('*')
        .or(`shift_id.eq.${session.shift_id},and(session_callsign.eq.${session.callsign},created_at.gte.${todayStart})`)
        .order('latest_transmission_at', { ascending: false, nullsFirst: false });
    }

    const { data } = await query;
    if (data) {
      remoteIncidents = data.map((r: any) => ({
        ...r,
        assessment: r.assessment ? sanitizeAssessment(r.assessment as unknown as Assessment) : null,
      }));
    }

    const merged = new Map<string, Incident>();
    for (const inc of localIncidents) merged.set(inc.id, inc);
    for (const inc of remoteIncidents) merged.set(inc.id, inc);

    const sorted = Array.from(merged.values()).sort((a, b) => {
      const at = new Date(a.latest_transmission_at ?? a.timestamp ?? a.created_at ?? 0).getTime();
      const bt = new Date(b.latest_transmission_at ?? b.timestamp ?? b.created_at ?? 0).getTime();
      return bt - at;
    });

    setIncidents(sorted);
  }, [session.callsign, session.session_date, session.shift_id]);

  useEffect(() => { fetchIncidents(); }, [fetchIncidents, refreshKey]);

  useEffect(() => {
    const id = window.setInterval(fetchIncidents, 5000);
    return () => window.clearInterval(id);
  }, [fetchIncidents]);

  const confirmClose = useCallback(async (inc: Incident) => {
    const closedAt = inc.confirmed_at ?? new Date().toISOString();
    await supabase.from('herald_reports')
      .update({ status: 'closed', confirmed_at: closedAt })
      .eq('id', inc.id);
    updateReport(inc.id, { status: 'closed', confirmed_at: closedAt } as any);
    setClosing(null);
    onCloseIncident(inc.id, inc.incident_number);
    fetchIncidents();
  }, [onCloseIncident, fetchIncidents]);

  const active = incidents.filter((i) => i.status === 'active');
  const closed = incidents.filter((i) => i.status === 'closed');

  const renderIncident = (inc: Incident, muted: boolean) => {
    const casualties = extractCasualties(inc);
    const isMulti = casualties.length > 1;
    const p = inc.assessment?.priority ?? inc.priority ?? 'P3';
    const col = PRIORITY_COLORS[p] ?? '#34C759';

    return (
      <div key={inc.id} className="mb-4" style={{ opacity: muted ? 0.6 : 1 }}>
        {/* For multi-casualty: collapsible incident header */}
        {isMulti && <IncidentHeader inc={inc} />}

        {/* Single casualty: inline headline only */}
        {!isMulti && (
          <div className="flex items-center gap-3 mb-2 px-1">
            <span className="text-lg font-bold" style={{ color: col }}>
              {inc.assessment?.headline ?? inc.headline ?? 'Incident'}
            </span>
            {inc.incident_number && (
              <span className="text-lg font-semibold text-foreground border border-border rounded-sm px-1.5 py-0.5">
                #{inc.incident_number}
              </span>
            )}
            <span className="text-lg text-foreground ml-auto">
              {getTime(inc.latest_transmission_at ?? inc.created_at)}
            </span>
          </div>
        )}

        {/* Casualty cards */}
        {casualties.length > 0 ? (
          casualties.map(cas => <CasualtyCard key={cas.key} cas={cas} inc={inc} />)
        ) : (
          <div className="rounded-lg border border-border bg-card p-3 mb-2">
            <p className="text-lg text-foreground opacity-50">Awaiting clinical assessment…</p>
          </div>
        )}

        {/* Close button for active incidents */}
        {inc.status === 'active' && (
          <div className="mt-2 px-1">
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
              <button onClick={() => setClosing(inc.id)}
                className="w-full py-2.5 text-lg font-bold rounded-sm tracking-wide"
                style={{ background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)', color: '#FF9500' }}>
                CLOSE INCIDENT
              </button>
            )}
          </div>
        )}

        {/* Closed label */}
        {muted && inc.confirmed_at && (
          <p className="text-lg text-foreground opacity-50 mt-1 px-1">
            Closed {getTime(inc.confirmed_at)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto px-3 py-3">
      <p className="text-lg font-bold tracking-[0.2em] mb-3" style={{ color: '#FF9500' }}>
        ACTIVE ({active.length})
      </p>
      {active.length === 0 ? (
        <p className="text-lg text-foreground opacity-50 mb-6">No active incidents</p>
      ) : (
        <div className="mb-6">{active.map((i) => renderIncident(i, false))}</div>
      )}

      <p className="text-lg font-bold tracking-[0.2em] mb-3 text-foreground opacity-50">
        CLOSED ({closed.length})
      </p>
      {closed.length === 0 ? (
        <p className="text-lg text-foreground opacity-30">No closed incidents</p>
      ) : (
        closed.map((i) => renderIncident(i, true))
      )}
    </div>
  );
}
