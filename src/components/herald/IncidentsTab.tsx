import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, FileText, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getReports, updateReport, saveCasualtyDisposition, isCasualtyClosed } from '@/lib/herald-storage';
import { PRIORITY_COLORS, DISPOSITION_LABELS } from '@/lib/herald-types';
import type { Assessment, ActionItem, DispositionType, CasualtyDisposition } from '@/lib/herald-types';
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
  key: string;
  priority: string;
  label: string;
  atmist: Record<string, string>;
  receivingHospital: string;
  actionItems: (string | ActionItem)[];
  resolvedItems: ActionItem[];
}

interface Props {
  session: HeraldSession;
  onCasualtyClosed: (d: CasualtyDisposition) => void;
  refreshKey?: number;
}

// ── Navigation state ──
type NavState =
  | { view: 'list' }
  | { view: 'incident'; incident: Incident }
  | { view: 'casualty'; incident: Incident; casualty: CasualtyData };

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

function extractCasualties(inc: Incident): CasualtyData[] {
  const a = inc.assessment;
  if (!a) return [];

  const atmist = a.atmist;
  if (!atmist || Object.keys(atmist).length === 0) {
    const hasClinic = a.clinical_findings || a.clinical_history || a.headline;
    if (!hasClinic) return [];

    const singleAtmist: Record<string, string> = {};
    if (a.clinical_findings) {
      singleAtmist.A = a.clinical_findings.A ?? '—';
      singleAtmist.S = [a.clinical_findings.B, a.clinical_findings.C, a.clinical_findings.D]
        .filter(Boolean).join('; ') || '—';
    }
    if (a.clinical_history) singleAtmist.M = a.clinical_history;
    if (a.treatment_given?.length) singleAtmist.T_treatment = a.treatment_given.join('; ');

    const assessHospital: string[] = a.receiving_hospital ?? [];
    const reportHospital = inc.receiving_hospital;
    const hospital = reportHospital || (assessHospital.length > 0 ? assessHospital[0] : '');
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

  const assessHospitals: string[] = a.receiving_hospital ?? [];
  const reportHospital = inc.receiving_hospital;
  const keys = Object.keys(atmist).sort();

  return keys
    .filter(key => {
      const val = (atmist as any)[key];
      if (!val) return false;
      const fields = ['A', 'T', 'M', 'I', 'S', 'T_treatment'];
      return fields.some(f => val[f] && val[f] !== '—' && val[f] !== 'null');
    })
    .map((key, idx) => {
      const val = (atmist as any)[key];
      const baseP = key.replace(/-\d+$/, '');
      const ageField = val?.A ?? '';
      const label = ageField && ageField !== '—'
        ? `${baseP} — ${ageField}`
        : baseP;

      let hospital = '';
      if (reportHospital) hospital = reportHospital;
      else if (assessHospitals.length === 1) hospital = assessHospitals[0];
      else if (assessHospitals.length > idx) hospital = assessHospitals[idx];

      const isSingle = keys.length === 1;
      return {
        key, priority: baseP, label,
        atmist: {
          A: val?.A ?? '—', T: val?.T ?? '—', M: val?.M ?? '—',
          I: val?.I ?? '—', S: val?.S ?? '—', T_treatment: val?.T_treatment ?? '—',
        },
        receivingHospital: hospital,
        actionItems: filterActionItemsForCasualty(a, key, isSingle),
        resolvedItems: filterResolvedForCasualty(a, key, isSingle),
      };
    });
}

function filterActionItemsForCasualty(a: Assessment, casualtyKey: string, isSingle: boolean): (string | ActionItem)[] {
  const items: (string | ActionItem)[] = a.action_items ?? [];
  if (isSingle) return items.filter(item => !(typeof item === 'object' && (item as ActionItem).resolved_at));
  const baseP = casualtyKey.replace(/-\d+$/, '');
  return items.filter(item => {
    const text = typeof item === 'object' ? (item as ActionItem).text : item;
    if (typeof item === 'object' && (item as ActionItem).resolved_at) return false;
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
      if (isSingle || !(/P[1-4]/.test((item as ActionItem).text)) || (item as ActionItem).text.includes(baseP)) {
        resolved.push(item as ActionItem);
      }
    }
  }
  const resolvedItems: ActionItem[] = (a as any)?.resolved_action_items ?? [];
  for (const item of resolvedItems) {
    if (isSingle || !(/P[1-4]/.test(item.text)) || item.text.includes(baseP)) {
      resolved.push(item);
    }
  }
  return resolved;
}

function buildCasualtyEprf(cas: CasualtyData, inc: Incident, disposition?: DispositionType, referTo?: string): string {
  const ts = new Date(inc.timestamp);
  const dateStr = ts.toISOString().slice(0, 10);
  const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' +
    ts.getUTCMinutes().toString().padStart(2, '0') + ':' +
    ts.getUTCSeconds().toString().padStart(2, '0') + 'Z';
  const a = inc.assessment;
  const incidentNum = inc.incident_number ?? (a?.structured as any)?.incident_number ?? '—';
  const activeItems = cas.actionItems.map(i => typeof i === 'object' ? (i as ActionItem).text : i);
  const dispLabel = disposition ? DISPOSITION_LABELS[disposition] : DISPOSITION_LABELS.conveyed;

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

DISPOSITION: ${dispLabel}${disposition === 'see_and_refer' && referTo ? ` — ${referTo}` : ''}
${disposition === 'conveyed' || !disposition ? `RECEIVING HOSPITAL: ${cas.receivingHospital || 'Not confirmed'}` : ''}
${activeItems.length > 0 ? `\nACTION ITEMS:\n${activeItems.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : ''}
═══════════════════════════
Generated by Herald Radio Intelligence`;
}

// ── Level 1: Incident Card with expandable casualty list ──

function IncidentCard({ inc, onSelectCasualty }: { inc: Incident; onSelectCasualty: (cas: CasualtyData) => void }) {
  const [expanded, setExpanded] = useState(false);
  const p = inc.assessment?.priority ?? inc.priority ?? 'P3';
  const col = PRIORITY_COLORS[p] ?? '#34C759';
  const casualties = extractCasualties(inc).filter(c => !isCasualtyClosed(inc.id, c.key));

  return (
    <div className="mb-2 rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left p-3">
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown size={20} style={{ color: col }} className="flex-shrink-0" />
            : <ChevronRight size={20} style={{ color: col }} className="flex-shrink-0" />}
          <span className="text-lg font-bold rounded-sm px-2 py-0.5 flex-shrink-0"
            style={{ color: col, border: `1px solid ${col}66`, background: `${col}1A` }}>
            {p}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-lg text-foreground font-medium truncate">
              {inc.assessment?.headline ?? inc.headline ?? 'Incident'}
            </p>
            <p className="text-lg text-foreground opacity-60">
              {casualties.length} casualt{casualties.length === 1 ? 'y' : 'ies'} · {getTime(inc.latest_transmission_at ?? inc.created_at)}
              {inc.incident_number ? ` · #${inc.incident_number}` : ''}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border">
          {/* Incident info */}
          {inc.assessment?.scene_location && (
            <p className="text-lg text-foreground opacity-70 mt-2 mb-1">📍 {inc.assessment.scene_location}</p>
          )}
          {inc.assessment?.incident_type && inc.assessment.incident_type !== 'Unknown' && (
            <p className="text-lg mb-2" style={{ color: col }}>
              {inc.assessment.incident_type}{inc.assessment.major_incident ? ' [MAJOR]' : ''}
            </p>
          )}

          {/* Casualty list */}
          <p className="text-lg font-bold tracking-[0.15em] mt-2 mb-2" style={{ color: '#1E90FF' }}>
            PATIENTS
          </p>
          {casualties.map(cas => {
            const casCol = PRIORITY_COLORS[cas.priority] ?? '#34C759';
            return (
              <button key={cas.key} onClick={() => onSelectCasualty(cas)}
                className="w-full text-left mb-1.5 rounded-lg border border-border bg-background p-3 hover:border-primary transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold rounded-sm px-2 py-0.5 flex-shrink-0"
                    style={{ color: casCol, border: `1px solid ${casCol}66`, background: `${casCol}1A` }}>
                    {cas.priority}
                  </span>
                  <span className="text-lg text-foreground font-medium flex-1 min-w-0 truncate">
                    {cas.label.replace(/^P\d\s*—\s*/, '')}
                  </span>
                  <ChevronRight size={18} className="text-foreground opacity-40 flex-shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Level 2: Incident Detail (header + casualty list) ──

function IncidentDetailView({ inc, onBack, onSelectCasualty }: {
  inc: Incident;
  onBack: () => void;
  onSelectCasualty: (cas: CasualtyData) => void;
}) {
  const a = inc.assessment;
  const p = a?.priority ?? inc.priority ?? 'P3';
  const col = PRIORITY_COLORS[p] ?? '#34C759';
  const casualties = extractCasualties(inc).filter(cas => !isCasualtyClosed(inc.id, cas.key));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Back bar */}
      <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-lg text-primary bg-transparent border-b border-border">
        <ArrowLeft size={20} /> Back to incidents
      </button>

      <div className="flex-1 overflow-auto px-3 py-3">
        {/* Incident header */}
        <div className="rounded-lg border border-border bg-card shadow-sm p-3 mb-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl font-bold" style={{ color: col }}>{p}</span>
            {inc.incident_number && (
              <span className="text-lg font-semibold text-foreground border border-border rounded-sm px-1.5 py-0.5">
                #{inc.incident_number}
              </span>
            )}
            <span className="text-lg text-foreground ml-auto">{getTime(inc.latest_transmission_at ?? inc.created_at)}</span>
          </div>
          <p className="text-lg text-foreground font-medium mb-2">
            {a?.headline ?? inc.headline ?? 'Incident'}
          </p>
          {a?.incident_type && a.incident_type !== 'Unknown' && (
            <p className="text-lg" style={{ color: col }}>
              {a.incident_type}{a.major_incident ? ' [MAJOR]' : ''}
            </p>
          )}
          {a?.scene_location && (
            <p className="text-lg text-foreground opacity-70 mt-1">📍 {a.scene_location}</p>
          )}
        </div>

        {/* Casualty cards */}
        <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>
          CASUALTIES ({casualties.length})
        </p>

        {casualties.length === 0 ? (
          <p className="text-lg text-foreground opacity-50">All casualties handed over</p>
        ) : (
          casualties.map(cas => {
            const casCol = PRIORITY_COLORS[cas.priority] ?? '#34C759';
            return (
              <button key={cas.key} onClick={() => onSelectCasualty(cas)}
                className="w-full text-left mb-2 rounded-lg border border-border bg-card shadow-sm overflow-hidden p-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold rounded-sm px-2 py-0.5 flex-shrink-0"
                    style={{ color: casCol, border: `1px solid ${casCol}66`, background: `${casCol}1A` }}>
                    {cas.priority}
                  </span>
                  <span className="text-lg text-foreground font-medium flex-1 min-w-0 truncate">
                    {cas.label.replace(/^P\d\s*—\s*/, '')}
                  </span>
                  <ChevronRight size={20} className="text-foreground opacity-40 flex-shrink-0" />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Level 3: Casualty Handover Report ──

function CasualtyReportView({ cas, inc, onBack, onHandover }: {
  cas: CasualtyData;
  inc: Incident;
  onBack: () => void;
  onHandover: (d: CasualtyDisposition) => void;
}) {
  const col = PRIORITY_COLORS[cas.priority] ?? '#34C759';
  const [showEprf, setShowEprf] = useState(false);
  const [disposition, setDisposition] = useState<DispositionType>('conveyed');
  const [referTo, setReferTo] = useState('');
  const [capacityAssessed, setCapacityAssessed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const showHospital = disposition === 'conveyed';

  const doHandover = useCallback(() => {
    const d: CasualtyDisposition = {
      disposition,
      closed_at: new Date().toISOString(),
      casualty_key: cas.key,
      casualty_label: cas.label,
      priority: cas.priority,
      incident_id: inc.id,
      incident_number: inc.incident_number,
      ...(disposition === 'see_and_refer' ? { refer_to: referTo } : {}),
      ...(disposition === 'refused_transport' ? { capacity_assessed: capacityAssessed } : {}),
    };
    saveCasualtyDisposition(d);
    onHandover(d);
  }, [disposition, referTo, capacityAssessed, cas, inc, onHandover]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Back bar */}
      <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-lg text-primary bg-transparent border-b border-border">
        <ArrowLeft size={20} /> Back
      </button>

      <div className="flex-1 overflow-auto px-3 py-3 pb-32">
        {/* 1. Priority + headline */}
        <div className="rounded-lg p-3 mb-4" style={{ background: `${col}1A`, borderLeft: `4px solid ${col}` }}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold" style={{ color: col }}>{cas.priority}</span>
            <span className="text-lg font-bold" style={{ color: col }}>
              {inc.assessment?.priority_label ?? ''}
            </span>
          </div>
          <p className="text-lg text-foreground font-medium">
            {cas.label}
          </p>
        </div>

        {/* 2. ATMIST */}
        <div className="mb-4">
          <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>ATMIST</p>
          <div className="border border-border rounded-lg bg-card p-3">
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

        {/* Disposition selector */}
        <div className="mb-4">
          <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: col }}>DISPOSITION</p>
          <div className="flex flex-col gap-1.5">
            {(Object.entries(DISPOSITION_LABELS) as [DispositionType, string][]).map(([key, label]) => (
              <button key={key}
                onClick={() => setDisposition(key)}
                className="text-left text-lg px-3 py-2.5 rounded-lg border transition-colors"
                style={{
                  borderColor: disposition === key ? col : 'hsl(var(--border))',
                  background: disposition === key ? `${col}1A` : 'transparent',
                  color: disposition === key ? col : 'hsl(var(--foreground))',
                  fontWeight: disposition === key ? 700 : 400,
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Disposition-specific fields */}
          {disposition === 'see_and_refer' && (
            <div className="mt-3">
              <p className="text-lg font-bold mb-1 text-foreground">Referred to:</p>
              <input
                type="text"
                value={referTo}
                onChange={e => setReferTo(e.target.value)}
                placeholder="GP, mental health team, etc."
                className="w-full text-lg px-3 py-2 rounded-lg border border-border bg-card text-foreground"
              />
            </div>
          )}
          {disposition === 'refused_transport' && (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => setCapacityAssessed(!capacityAssessed)}
                className="flex items-center gap-2 text-lg px-3 py-2 rounded-lg border transition-colors"
                style={{
                  borderColor: capacityAssessed ? '#34C759' : 'hsl(var(--border))',
                  background: capacityAssessed ? 'rgba(52,199,89,0.1)' : 'transparent',
                }}>
                <span className="text-lg" style={{ color: capacityAssessed ? '#34C759' : 'hsl(var(--foreground))' }}>
                  {capacityAssessed ? '✓' : '○'}
                </span>
                <span className="text-lg text-foreground">Capacity assessment completed</span>
              </button>
            </div>
          )}
          {disposition === 'role' && (
            <div className="mt-3 rounded-lg p-3" style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }}>
              <p className="text-lg" style={{ color: '#FF3B30' }}>
                Recognition of Life Extinct — ensure all documentation is complete before handover.
              </p>
            </div>
          )}
        </div>

        {/* 3. Receiving Hospital — only for conveyed */}
        {showHospital && (
          <div className="mb-4">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: col }}>RECEIVING HOSPITAL</p>
            {cas.receivingHospital ? (
              <div className="border border-border rounded-lg p-3" style={{ background: `${col}0D` }}>
                <p className="text-xl text-foreground font-bold break-words">{cas.receivingHospital}</p>
              </div>
            ) : (
              <div className="rounded-lg p-3" style={{ color: '#FF9500', background: 'rgba(255,149,0,0.06)', border: '1px dashed rgba(255,149,0,0.3)' }}>
                <p className="text-lg">No receiving hospital confirmed — contact Control</p>
              </div>
            )}
          </div>
        )}

        {/* 4. Active action items */}
        {cas.actionItems.length > 0 && (
          <div className="mb-4">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#FF9500' }}>⚠ ACTION ITEMS</p>
            <div className="flex flex-col gap-1.5">
              {cas.actionItems.map((item, i) => {
                const text = typeof item === 'object' ? (item as ActionItem).text : item;
                const openedAt = typeof item === 'object' ? (item as ActionItem).opened_at : inc.timestamp;
                return (
                  <div key={i} className="rounded-lg p-2.5 flex gap-2 items-start"
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
        {cas.resolvedItems.length > 0 && <ResolvedActions items={cas.resolvedItems} />}

        {/* 5. ePRF button */}
        <div className="mb-4">
          <button
            onClick={() => setShowEprf(!showEprf)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-lg font-bold tracking-[0.15em] border cursor-pointer transition-colors"
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
                <CopyBtn text={buildCasualtyEprf(cas, inc, disposition, referTo)} label="COPY ePRF" />
              </div>
              <div className="border border-border rounded-lg bg-card p-3">
                <div className="text-lg text-foreground leading-7 whitespace-pre-wrap break-words">
                  {buildCasualtyEprf(cas, inc, disposition, referTo)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed bottom: Handover button */}
      <div className="px-3 py-3 border-t border-border" style={{ background: '#1A1E24' }}>
        {confirming ? (
          <div className="p-3 rounded-lg" style={{ border: '2px solid #FF9500', background: 'rgba(255,149,0,0.08)' }}>
            <p className="text-lg font-bold mb-2" style={{ color: '#FF9500' }}>
              Hand over this patient?
            </p>
            <p className="text-lg text-foreground opacity-70 mb-3">
              {DISPOSITION_LABELS[disposition]}
              {disposition === 'see_and_refer' && referTo ? ` — ${referTo}` : ''}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 text-lg font-bold border border-border rounded-lg bg-transparent text-foreground">
                CANCEL
              </button>
              <button onClick={doHandover}
                className="flex-1 py-2.5 text-lg font-bold rounded-lg"
                style={{ background: `${col}22`, border: `2px solid ${col}`, color: col }}>
                CONFIRM HANDOVER
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)}
            className="w-full py-3 text-lg font-bold rounded-lg tracking-wide"
            style={{ background: `${col}15`, border: `2px solid ${col}`, color: col }}>
            HANDOVER PATIENT
          </button>
        )}
      </div>
    </div>
  );
}

function ResolvedActions({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-lg font-bold tracking-[0.15em] bg-transparent border-none cursor-pointer"
        style={{ color: '#888' }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
        RESOLVED ({items.length})
      </button>
      {open && (
        <div className="flex flex-col gap-1 mt-1">
          {items.map((item, i) => (
            <div key={i} className="rounded-lg p-2 flex gap-2 items-start"
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

// ── Main component ──

export function IncidentsTab({ session, onCasualtyClosed, refreshKey }: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [nav, setNav] = useState<NavState>({ view: 'list' });
  const navRef = useRef<NavState>(nav);
  navRef.current = nav;

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
      .eq('status', 'active')
      .order('latest_transmission_at', { ascending: false, nullsFirst: false });

    if (session.shift_id) {
      query = supabase
        .from('herald_reports')
        .select('*')
        .or(`shift_id.eq.${session.shift_id},and(session_callsign.eq.${session.callsign},created_at.gte.${todayStart})`)
        .eq('status', 'active')
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

    // Update current nav state with fresh data (using ref to avoid dependency loop)
    const currentNav = navRef.current;
    if (currentNav.view === 'incident' || currentNav.view === 'casualty') {
      const incId = currentNav.incident.id;
      const fresh = sorted.find(i => i.id === incId);
      if (fresh) {
        if (currentNav.view === 'incident') {
          setNav({ view: 'incident', incident: fresh });
        } else {
          const freshCas = extractCasualties(fresh).find(c => c.key === currentNav.casualty.key);
          if (freshCas) {
            setNav({ view: 'casualty', incident: fresh, casualty: freshCas });
          }
        }
      }
    }
  }, [session.callsign, session.session_date, session.shift_id]);

  useEffect(() => { fetchIncidents(); }, [fetchIncidents, refreshKey]);

  useEffect(() => {
    const id = window.setInterval(fetchIncidents, 5000);
    return () => window.clearInterval(id);
  }, [fetchIncidents]);

  const handleCasualtyClosed = useCallback((d: CasualtyDisposition) => {
    onCasualtyClosed(d);
    const currentNav = navRef.current;
    if (currentNav.view === 'casualty') {
      const remaining = extractCasualties(currentNav.incident).filter(c => !isCasualtyClosed(currentNav.incident.id, c.key) && c.key !== d.casualty_key);
      if (remaining.length === 0) {
        supabase.from('herald_reports')
          .update({ status: 'closed', confirmed_at: new Date().toISOString() })
          .eq('id', currentNav.incident.id)
          .then(() => {
            updateReport(currentNav.incident.id, { status: 'closed', confirmed_at: new Date().toISOString() } as any);
            fetchIncidents();
          });
        setNav({ view: 'list' });
      } else {
        setNav({ view: 'incident', incident: currentNav.incident });
      }
    }
    fetchIncidents();
  }, [onCasualtyClosed, fetchIncidents]);

  // Filter to only show incidents with open casualties
  const activeWithCasualties = incidents.filter(inc => {
    const cas = extractCasualties(inc);
    return cas.some(c => !isCasualtyClosed(inc.id, c.key));
  });

  // ── Render based on nav state ──

  if (nav.view === 'casualty') {
    return (
      <CasualtyReportView
        cas={nav.casualty}
        inc={nav.incident}
        onBack={() => {
          const casualties = extractCasualties(nav.incident).filter(c => !isCasualtyClosed(nav.incident.id, c.key));
          if (casualties.length <= 1) setNav({ view: 'list' });
          else setNav({ view: 'incident', incident: nav.incident });
        }}
        onHandover={handleCasualtyClosed}
      />
    );
  }

  if (nav.view === 'incident') {
    return (
      <IncidentDetailView
        inc={nav.incident}
        onBack={() => setNav({ view: 'list' })}
        onSelectCasualty={(cas) => setNav({ view: 'casualty', incident: nav.incident, casualty: cas })}
      />
    );
  }

  // List view
  return (
    <div className="flex-1 overflow-auto px-3 py-3">
      <p className="text-lg font-bold tracking-[0.2em] mb-3" style={{ color: '#FF9500' }}>
        ACTIVE INCIDENTS ({activeWithCasualties.length})
      </p>
      {activeWithCasualties.length === 0 ? (
        <p className="text-lg text-foreground opacity-50">No active incidents</p>
      ) : (
        activeWithCasualties.map(inc => {
          const casualties = extractCasualties(inc).filter(c => !isCasualtyClosed(inc.id, c.key));
          // Single casualty — go straight to casualty report
          if (casualties.length === 1) {
            return (
              <IncidentListItem
                key={inc.id}
                inc={inc}
                casualtyCount={1}
                onTap={() => setNav({ view: 'casualty', incident: inc, casualty: casualties[0] })}
              />
            );
          }
          return (
            <IncidentListItem
              key={inc.id}
              inc={inc}
              casualtyCount={casualties.length}
              onTap={() => setNav({ view: 'incident', incident: inc })}
            />
          );
        })
      )}
    </div>
  );
}
