import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, FileText, ArrowLeft, ArrowRightLeft } from 'lucide-react';
import { SERVICE_LABELS } from '@/lib/herald-types';
import { getVehicleLabel } from '@/lib/vehicle-types';
import { fetchIncidentsRemote } from '@/lib/herald-api';
import { supabase } from '@/integrations/supabase/client';
import { getReports, updateReport, saveCasualtyDisposition, isCasualtyClosed, getCasualtyDispositions } from '@/lib/herald-storage';
import { PRIORITY_COLORS, PRIORITY_LABELS, DISPOSITION_LABELS } from '@/lib/herald-types';
import type { Assessment, ActionItem, DispositionType, CasualtyDisposition, DispositionFields } from '@/lib/herald-types';
import type { HeraldSession } from '@/lib/herald-session';
import { sanitizeAssessment, formatActionAge } from '@/lib/sanitize-assessment';
import { TransferInitiate } from './TransferInitiate';
import { PendingTransfers } from './PendingTransfers';

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
  patientName?: string;
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
  | { view: 'casualty'; incident: Incident; casualty: CasualtyData }
  | { view: 'transfer'; incident: Incident; casualty: CasualtyData };

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
      patientName: a.patient_name ?? undefined,
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

      // Per-casualty name: prefer atmist.name, fall back to parsing patient_name
      let patientName: string | undefined = val?.name ?? undefined;
      if (!patientName && a.patient_name) {
        if (isSingle) {
          // Single casualty — use the whole patient_name (strip any "P1: " prefix)
          patientName = a.patient_name.replace(/^P\d+:\s*/, '');
        } else {
          // Multi-casualty — parse "P1: Name, P2: Name" format
          const re = new RegExp(`${baseP}:\\s*([^,]+)`, 'i');
          const m = a.patient_name.match(re);
          if (m) patientName = m[1].trim();
        }
      }

      return {
        key, priority: baseP, label,
        atmist: {
          A: val?.A ?? '—', T: val?.T ?? '—', M: val?.M ?? '—',
          I: val?.I ?? '—', S: val?.S ?? '—', T_treatment: val?.T_treatment ?? '—',
          ...(val?.downtime ? { downtime: val.downtime } : {}),
          ...(val?.status ? { status: val.status } : {}),
        },
        receivingHospital: hospital,
        actionItems: filterActionItemsForCasualty(a, key, isSingle),
        resolvedItems: filterResolvedForCasualty(a, key, isSingle),
        patientName,
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

function buildCasualtyEprf(cas: CasualtyData, inc: Incident, disposition: DispositionType, fields: import('@/lib/herald-types').DispositionFields): string {
  const ts = new Date(inc.timestamp);
  const dateStr = ts.toISOString().slice(0, 10);
  const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' +
    ts.getUTCMinutes().toString().padStart(2, '0') + ':' +
    ts.getUTCSeconds().toString().padStart(2, '0') + 'Z';
  const a = inc.assessment;
  const incidentNum = inc.incident_number ?? (a?.structured as any)?.incident_number ?? '—';
  const activeItems = cas.actionItems.map(i => typeof i === 'object' ? (i as ActionItem).text : i);
  const dispLabel = DISPOSITION_LABELS[disposition];

  let header = `ePRF — PATIENT HANDOVER
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
  Injuries: ${cas.atmist.I}${cas.atmist.status ? `\n  Status: ${cas.atmist.status}` : ''}
  Signs/Vitals: ${cas.atmist.S}${cas.atmist.downtime ? `\n  Downtime: ${cas.atmist.downtime}` : ''}
  Treatment: ${cas.atmist.T_treatment}

DISPOSITION: ${dispLabel}`;

  let dispSection = '';
  if (disposition === 'conveyed') {
    dispSection = `
RECEIVING HOSPITAL: ${fields.receiving_hospital || cas.receivingHospital || 'Not confirmed'}
TIME OF HANDOVER: ${fields.time_of_handover || '—'}
HANDOVER GIVEN TO: ${fields.handover_given_to || '—'}
ePRF HANDED OVER: ${fields.eprf_handed_over ? 'Yes' : 'No'}`;
  } else if (disposition === 'see_and_treat') {
    dispSection = `
CLINICAL JUSTIFICATION: ${fields.clinical_justification || '—'}
OBSERVATIONS AT DISCHARGE: ${fields.discharge_observations || '—'}
ADVICE GIVEN: ${fields.advice_given || '—'}
SAFETY NET INSTRUCTIONS: ${fields.safety_net_given ? 'Given' : 'Not given'}
PATIENT UNDERSTANDS ADVICE: ${fields.patient_understands ? 'Confirmed' : 'Not confirmed'}
TIME OF DISCHARGE: ${fields.time_of_discharge || '—'}`;
  } else if (disposition === 'see_and_refer') {
    dispSection = `
CLINICAL JUSTIFICATION: ${fields.clinical_justification || '—'}
OBSERVATIONS AT DISCHARGE: ${fields.discharge_observations || '—'}
ADVICE GIVEN: ${fields.advice_given || '—'}
SAFETY NET INSTRUCTIONS: ${fields.safety_net_given ? 'Given' : 'Not given'}
PATIENT UNDERSTANDS ADVICE: ${fields.patient_understands ? 'Confirmed' : 'Not confirmed'}
TIME OF DISCHARGE: ${fields.time_of_discharge || '—'}
REFERRAL DESTINATION: ${fields.referral_destination || '—'}
REFERRAL PATHWAY: ${fields.referral_pathway || '—'}
REFERRAL ACCEPTED: ${fields.referral_accepted ? 'Accepted' : 'Advised only'}
REFERENCE NUMBER: ${fields.reference_number || '—'}`;
  } else if (disposition === 'refused_transport') {
    dispSection = `
CAPACITY ASSESSMENT COMPLETED: ${fields.capacity_assessed ? 'Yes' : 'No'}
PATIENT HAS CAPACITY: ${fields.patient_has_capacity ? 'Yes' : 'No'}
RISKS OF REFUSAL EXPLAINED: ${fields.risks_explained ? 'Yes' : 'No'}
PATIENT UNDERSTANDING CONFIRMED: ${fields.patient_understanding_confirmed ? 'Yes' : 'No'}
REFUSAL WITNESSED BY: ${fields.refusal_witnessed_by || '—'}
TIME OF REFUSAL: ${fields.time_of_refusal || '—'}
SAFEGUARDING CONCERN: ${fields.safeguarding_concern ? 'Yes — flagged' : 'No'}
${!fields.patient_has_capacity ? `BEST INTERESTS DECISION: ${fields.best_interests_decision || '—'}` : ''}
SIGNED REFUSAL FORM: ${fields.signed_refusal_form ? 'Obtained' : 'Not obtained'}`;
  } else if (disposition === 'role') {
    dispSection = `
TIME OF RECOGNITION: ${fields.time_of_recognition || '—'}
CRITERIA: ${fields.role_criteria || '—'}
RESUSCITATION ATTEMPTED: ${fields.resuscitation_attempted ? 'Yes' : 'No'}${fields.resuscitation_attempted ? `\nDURATION/OUTCOME: ${fields.resuscitation_details || '—'}` : ''}
GP NOTIFIED: ${fields.gp_notified ? 'Yes' : 'No'}
POLICE NOTIFIED: ${fields.police_notified ? 'Yes' : 'No'}
CORONER REFERRAL REQUIRED: ${fields.coroner_referral ? 'Yes' : 'No'}
NEXT OF KIN NOTIFIED: ${fields.nok_notified ? 'Yes' : 'No'}`;
  }

  const actionSection = activeItems.length > 0
    ? `\nACTION ITEMS:\n${activeItems.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '';

  return `${header}${dispSection}${actionSection}
═══════════════════════════
Generated by Herald Radio Intelligence`;
}

// ── Level 1: Incident Card with expandable casualty list ──

function IncidentCard({ inc, onSelectCasualty, closedKeys, transferredKeys }: { inc: Incident; onSelectCasualty: (cas: CasualtyData) => void; closedKeys: Set<string>; transferredKeys?: Set<string> }) {
  const [expanded, setExpanded] = useState(false);
  const p = inc.assessment?.priority ?? inc.priority ?? 'P3';
  const col = PRIORITY_COLORS[p] ?? '#34C759';
  let casualties = extractCasualties(inc).filter(c => !closedKeys.has(`${inc.id}:${c.key}`));
  if (transferredKeys?.size) casualties = casualties.filter(c => transferredKeys.has(c.key));

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
            <p className="text-lg text-foreground font-medium">
              {inc.assessment?.headline ?? inc.headline ?? 'Incident'}
            </p>
            <p className="text-lg text-foreground opacity-60">
              {casualties.length} casualt{casualties.length === 1 ? 'y' : 'ies'}
              {(inc.transmission_count ?? 0) > 1 ? ` · x${inc.transmission_count}` : ''}
              {' · '}{getTime(inc.latest_transmission_at ?? inc.created_at)}
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

function IncidentDetailView({ inc, onBack, onSelectCasualty, closedKeys, transferredKeys }: {
  inc: Incident;
  onBack: () => void;
  onSelectCasualty: (cas: CasualtyData) => void;
  closedKeys: Set<string>;
  transferredKeys?: Set<string>;
}) {
  const a = inc.assessment;
  const p = a?.priority ?? inc.priority ?? 'P3';
  const col = PRIORITY_COLORS[p] ?? '#34C759';
  let casualties = extractCasualties(inc).filter(cas => !closedKeys.has(`${inc.id}:${cas.key}`));
  if (transferredKeys?.size) casualties = casualties.filter(c => transferredKeys.has(c.key));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Back bar */}
      <button onClick={onBack} className="flex items-center gap-2 px-3 md:px-6 py-2 text-lg text-primary bg-transparent border-b border-border">
        <ArrowLeft size={20} /> Back to incidents
      </button>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-3 md:py-5">
        <div className="max-w-3xl mx-auto">
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
    </div>
  );
}

// ── Reusable field components ──

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-lg font-bold mb-1 text-foreground">{children}</p>;
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full text-lg px-3 py-2 rounded-lg border border-border bg-card text-foreground" />
  );
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
      className="w-full text-lg px-3 py-2 rounded-lg border border-border bg-card text-foreground resize-y" />
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!value)}
      className="w-full text-left flex items-center gap-3 text-lg px-3 py-2.5 rounded-lg border transition-colors mb-1.5"
      style={{
        borderColor: value ? '#34C759' : 'hsl(var(--border))',
        background: value ? 'rgba(52,199,89,0.08)' : 'transparent',
      }}>
      <span className="text-lg flex-shrink-0" style={{ color: value ? '#34C759' : 'hsl(var(--foreground))' }}>
        {value ? '✓' : '○'}
      </span>
      <span className="text-lg text-foreground">{label}</span>
    </button>
  );
}

function DropdownSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full text-lg px-3 py-2.5 rounded-lg border border-border bg-card text-foreground appearance-none">
      <option value="">{placeholder || 'Select...'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function EditableField2({ value, onSave, color }: { value: string; onSave: (v: string) => void; color?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className="text-lg text-foreground break-words cursor-pointer"
        style={{ borderBottom: '1px dashed transparent' }}
        onClick={() => { setDraft(value); setEditing(true); }}
      >
        {value || '—'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 w-full">
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        autoFocus
        className="flex-1 text-lg px-2 py-1 rounded border border-border bg-card text-foreground"
      />
      <button
        onClick={() => { onSave(draft); setEditing(false); }}
        className="text-lg font-bold px-2 py-1 rounded"
        style={{ color: '#34C759', border: '1px solid rgba(52,199,89,0.4)', background: 'rgba(52,199,89,0.08)' }}
      >SAVE</button>
      <button
        onClick={() => setEditing(false)}
        className="text-lg px-2 py-1 rounded"
        style={{ color: '#888', border: '1px solid rgba(136,136,136,0.3)' }}
      >X</button>
    </span>
  );
}

const REFERRAL_PATHWAYS = ['GP', '111', 'Walk-in', 'Mental health crisis team', 'Other'];
const ROLE_CRITERIA = ['Obvious signs of death', 'JRCALC criteria met', 'Traumatic arrest unsurvivable', 'Other'];

// ── Level 3: Casualty Handover Report ──

function CasualtyReportView({ cas, inc, onBack, onHandover, onTransfer }: {
  cas: CasualtyData;
  inc: Incident;
  onBack: () => void;
  onHandover: (d: CasualtyDisposition) => void;
  onTransfer: () => void;
}) {
  const col = PRIORITY_COLORS[cas.priority] ?? '#34C759';
  const [showEprf, setShowEprf] = useState(false);
  const [disposition, setDisposition] = useState<DispositionType>('conveyed');
  const [fields, setFields] = useState<DispositionFields>({
    receiving_hospital: cas.receivingHospital || '',
  });
  const [confirming, setConfirming] = useState(false);

  // Save an ATMIST field edit back to the report assessment
  const saveAtmistField = useCallback(async (fieldKey: string, newValue: string) => {
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const rawAssessment = inc.assessment as any;
      if (!rawAssessment?.atmist) return;
      const updatedAtmist = { ...rawAssessment.atmist };
      // Update the specific casualty's field
      const casKey = cas.key;
      if (updatedAtmist[casKey]) {
        updatedAtmist[casKey] = { ...updatedAtmist[casKey], [fieldKey]: newValue };
      }
      const updatedAssessment = { ...rawAssessment, atmist: updatedAtmist };
      await supabase.from('herald_reports').update({ assessment: updatedAssessment as any }).eq('id', inc.id);
    } catch { /* silent */ }
  }, [inc, cas.key]);

  const updateField = useCallback(<K extends keyof DispositionFields>(key: K, val: DispositionFields[K]) => {
    setFields(prev => ({ ...prev, [key]: val }));
  }, []);

  const doHandover = useCallback(async () => {
    const conveyedHospital =
      disposition === 'conveyed' && typeof fields.receiving_hospital === 'string' && fields.receiving_hospital.trim()
        ? fields.receiving_hospital.trim()
        : null;

    const d: CasualtyDisposition = {
      disposition,
      closed_at: new Date().toISOString(),
      casualty_key: cas.key,
      casualty_label: cas.label,
      priority: cas.priority,
      incident_id: inc.id,
      incident_number: inc.incident_number,
      session_callsign: inc.session_callsign ?? null,
      fields: conveyedHospital ? { ...fields, receiving_hospital: conveyedHospital } : fields,
    };

    // Save locally first
    await saveCasualtyDisposition(d);
    if (conveyedHospital) {
      await updateReport(inc.id, { receiving_hospital: conveyedHospital } as any);
    }

    // Sync to Supabase BEFORE triggering navigation (onHandover unmounts this component)
    try {
      const { syncDisposition } = await import('@/lib/herald-api');
      const session = await (await import('@/lib/herald-session')).getSession();
      const syncOk = await syncDisposition({
        report_id: inc.id,
        casualty_key: cas.key,
        casualty_label: cas.label,
        priority: cas.priority,
        disposition,
        fields: conveyedHospital ? { ...fields, receiving_hospital: conveyedHospital } : fields,
        incident_number: inc.incident_number,
        closed_at: d.closed_at,
        session_callsign: session?.callsign ?? null,
        trust_id: session?.trust_id ?? null,
      });
      if (!syncOk) {
        console.warn('Disposition sync returned false — will retry on next sync cycle');
      }

      // Check if all casualties are now closed — if so, mark incident as closed
      const allCasualties = extractCasualties(inc);
      const closedChecks = await Promise.all(
        allCasualties.map(async c => c.key === cas.key || await isCasualtyClosed(inc.id, c.key))
      );
      const allClosed = closedChecks.every(Boolean);
      const reportUpdates: Record<string, unknown> = {};
      if (allClosed) {
        reportUpdates.status = 'closed';
        reportUpdates.confirmed_at = d.closed_at;
      }
      if (conveyedHospital) {
        reportUpdates.receiving_hospital = conveyedHospital;
      }

      if (allClosed) {
        const { supabase } = await import('@/integrations/supabase/client');
        await supabase.from('herald_reports').update(reportUpdates).eq('id', inc.id);
      } else if (conveyedHospital) {
        const { supabase } = await import('@/integrations/supabase/client');
        await supabase.from('herald_reports').update({ receiving_hospital: conveyedHospital }).eq('id', inc.id);
      }
    } catch (e) {
      console.error('Failed to sync disposition:', e);
    }

    // Now trigger navigation/unmount AFTER sync is complete
    onHandover(d);
  }, [disposition, fields, cas, inc, onHandover]);

  // Now/current time helper
  const nowTime = () => {
    const d = new Date();
    return d.getUTCHours().toString().padStart(2, '0') + ':' +
      d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <button onClick={onBack} className="flex items-center gap-2 px-3 md:px-6 py-2 text-lg text-primary bg-transparent border-b border-border">
        <ArrowLeft size={20} /> Back
      </button>

      <div className="flex-1 overflow-auto px-3 md:px-6 py-3 md:py-5 pb-32">
        <div className="max-w-3xl mx-auto">
        {/* 1. Priority + headline */}
        <div className="rounded-lg p-3 mb-4" style={{ background: `${col}1A`, borderLeft: `4px solid ${col}` }}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold" style={{ color: col }}>{cas.priority}</span>
            <span className="text-lg font-bold" style={{ color: col }}>{PRIORITY_LABELS[cas.priority] ?? inc.assessment?.priority_label ?? ''}</span>
          </div>
          <p className="text-lg text-foreground font-medium">{cas.label}</p>
        </div>

        {/* Safeguarding alert */}
        {inc.assessment?.safeguarding?.concern_identified && (
          <div className="rounded-lg p-3 mb-4" style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }}>
            <p className="text-lg font-bold" style={{ color: '#FF3B30' }}>⚠ SAFEGUARDING CONCERN</p>
            {inc.assessment.safeguarding.details && (
              <p className="text-lg text-foreground mt-1">{inc.assessment.safeguarding.details}</p>
            )}
            <div className="flex gap-3 mt-1 flex-wrap">
              {inc.assessment.safeguarding.police_requested && (
                <span className="text-lg font-bold" style={{ color: '#FF9500' }}>Police requested</span>
              )}
              {inc.assessment.safeguarding.referral_required && (
                <span className="text-lg font-bold" style={{ color: '#FF3B30' }}>Referral required</span>
              )}
            </div>
          </div>
        )}

        {/* 2. ATMIST */}
        <div className="mb-4">
          <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>ATMIST</p>
          <div className="border border-border rounded-lg bg-card p-3">
            {[
              { k: 'A', label: 'Age / Sex' }, { k: 'T', label: 'Time of Injury' },
              { k: 'M', label: 'Mechanism' }, { k: 'I', label: 'Injuries' },
            ].map(({ k, label }) => (
              <div key={k} className="mb-2">
                <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>{label}: </span>
                <EditableField2 value={cas.atmist[k] ?? ''} onSave={v => saveAtmistField(k, v)} />
              </div>
            ))}
            {cas.atmist.status && (
              <div className="mb-2">
                <span className="text-lg font-bold" style={{ color: '#34C759' }}>Status: </span>
                <EditableField2 value={cas.atmist.status} onSave={v => saveAtmistField('status', v)} />
              </div>
            )}
            <div className="mb-2">
              <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>Signs / Vitals: </span>
              <EditableField2 value={cas.atmist.S ?? ''} onSave={v => saveAtmistField('S', v)} />
            </div>
            {cas.atmist.downtime && (
              <div className="mb-2">
                <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>Downtime: </span>
                <EditableField2 value={cas.atmist.downtime} onSave={v => saveAtmistField('downtime', v)} />
              </div>
            )}
            <div className="mb-2 last:mb-0">
              <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>Treatment Given: </span>
              <EditableField2 value={cas.atmist.T_treatment ?? ''} onSave={v => saveAtmistField('T_treatment', v)} />
            </div>
          </div>
        </div>

        {/* Patient name (if extracted from transmission) */}
        {cas.patientName && (
          <div className="mb-4">
            <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: col }}>PATIENT</p>
            <div className="border border-border rounded-lg bg-card p-3">
              <span className="text-lg font-bold" style={{ color: col }}>Name: </span>
              <span className="text-lg text-foreground">{cas.patientName}</span>
            </div>
          </div>
        )}

        {/* Disposition selector */}
        <div className="mb-4">
          <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: col }}>DISPOSITION</p>
          <div className="flex flex-col gap-1.5 mb-3">
            {(Object.entries(DISPOSITION_LABELS) as [DispositionType, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setDisposition(key)}
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

          {/* ── CONVEYED ── */}
          {disposition === 'conveyed' && (
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <div>
                <FieldLabel>Receiving hospital</FieldLabel>
                <TextInput value={fields.receiving_hospital ?? cas.receivingHospital ?? ''} onChange={v => updateField('receiving_hospital', v)} placeholder="Hospital name" />
              </div>
              <div>
                <FieldLabel>Time of handover</FieldLabel>
                <div className="flex gap-2">
                  <TextInput value={fields.time_of_handover ?? ''} onChange={v => updateField('time_of_handover', v)} placeholder="HH:MMZ" />
                  <button onClick={() => updateField('time_of_handover', nowTime())}
                    className="text-lg px-3 py-2 rounded-lg border border-border text-primary whitespace-nowrap">NOW</button>
                </div>
              </div>
              <div>
                <FieldLabel>Handover given to</FieldLabel>
                <TextInput value={fields.handover_given_to ?? ''} onChange={v => updateField('handover_given_to', v)} placeholder="Name / role of receiving clinician" />
              </div>
              <Toggle value={fields.eprf_handed_over ?? false} onChange={v => updateField('eprf_handed_over', v)} label="ePRF generated and handed over" />
            </div>
          )}

          {/* ── SEE AND TREAT ── */}
          {disposition === 'see_and_treat' && (
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <div>
                <FieldLabel>Clinical justification for discharge</FieldLabel>
                <TextArea value={fields.clinical_justification ?? ''} onChange={v => updateField('clinical_justification', v)} placeholder="Clinical reasoning..." />
              </div>
              <div>
                <FieldLabel>Observations at time of discharge</FieldLabel>
                <TextInput value={fields.discharge_observations ?? ''} onChange={v => updateField('discharge_observations', v)} placeholder="Vitals at discharge" />
              </div>
              <div>
                <FieldLabel>Advice given to patient</FieldLabel>
                <TextArea value={fields.advice_given ?? ''} onChange={v => updateField('advice_given', v)} placeholder="Advice provided..." />
              </div>
              <Toggle value={fields.safety_net_given ?? false} onChange={v => updateField('safety_net_given', v)} label="Safety net instructions given" />
              <Toggle value={fields.patient_understands ?? false} onChange={v => updateField('patient_understands', v)} label="Patient confirmed they understand advice" />
              <div>
                <FieldLabel>Time of discharge</FieldLabel>
                <div className="flex gap-2">
                  <TextInput value={fields.time_of_discharge ?? ''} onChange={v => updateField('time_of_discharge', v)} placeholder="HH:MMZ" />
                  <button onClick={() => updateField('time_of_discharge', nowTime())}
                    className="text-lg px-3 py-2 rounded-lg border border-border text-primary whitespace-nowrap">NOW</button>
                </div>
              </div>
            </div>
          )}

          {/* ── SEE AND REFER ── */}
          {disposition === 'see_and_refer' && (
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <div>
                <FieldLabel>Clinical justification for discharge</FieldLabel>
                <TextArea value={fields.clinical_justification ?? ''} onChange={v => updateField('clinical_justification', v)} placeholder="Clinical reasoning..." />
              </div>
              <div>
                <FieldLabel>Observations at time of discharge</FieldLabel>
                <TextInput value={fields.discharge_observations ?? ''} onChange={v => updateField('discharge_observations', v)} placeholder="Vitals at discharge" />
              </div>
              <div>
                <FieldLabel>Advice given to patient</FieldLabel>
                <TextArea value={fields.advice_given ?? ''} onChange={v => updateField('advice_given', v)} placeholder="Advice provided..." />
              </div>
              <Toggle value={fields.safety_net_given ?? false} onChange={v => updateField('safety_net_given', v)} label="Safety net instructions given" />
              <Toggle value={fields.patient_understands ?? false} onChange={v => updateField('patient_understands', v)} label="Patient confirmed they understand advice" />
              <div>
                <FieldLabel>Time of discharge</FieldLabel>
                <div className="flex gap-2">
                  <TextInput value={fields.time_of_discharge ?? ''} onChange={v => updateField('time_of_discharge', v)} placeholder="HH:MMZ" />
                  <button onClick={() => updateField('time_of_discharge', nowTime())}
                    className="text-lg px-3 py-2 rounded-lg border border-border text-primary whitespace-nowrap">NOW</button>
                </div>
              </div>
              <div>
                <FieldLabel>Referral destination</FieldLabel>
                <TextInput value={fields.referral_destination ?? ''} onChange={v => updateField('referral_destination', v)} placeholder="Service or provider" />
              </div>
              <div>
                <FieldLabel>Referral pathway</FieldLabel>
                <DropdownSelect value={fields.referral_pathway ?? ''} onChange={v => updateField('referral_pathway', v)} options={REFERRAL_PATHWAYS} placeholder="Select pathway..." />
              </div>
              <Toggle value={fields.referral_accepted ?? false} onChange={v => updateField('referral_accepted', v)} label={fields.referral_accepted ? 'Referral accepted' : 'Advised only'} />
              <div>
                <FieldLabel>Reference number (if given)</FieldLabel>
                <TextInput value={fields.reference_number ?? ''} onChange={v => updateField('reference_number', v)} placeholder="Reference #" />
              </div>
            </div>
          )}

          {/* ── REFUSED TRANSPORT ── */}
          {disposition === 'refused_transport' && (
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <Toggle value={fields.capacity_assessed ?? false} onChange={v => updateField('capacity_assessed', v)} label="Mental capacity assessment completed" />
              <Toggle value={fields.patient_has_capacity ?? false} onChange={v => updateField('patient_has_capacity', v)} label="Patient has capacity" />
              <Toggle value={fields.risks_explained ?? false} onChange={v => updateField('risks_explained', v)} label="Risks of refusal explained to patient" />
              <Toggle value={fields.patient_understanding_confirmed ?? false} onChange={v => updateField('patient_understanding_confirmed', v)} label="Patient understanding confirmed" />
              <div>
                <FieldLabel>Refusal witnessed by</FieldLabel>
                <TextInput value={fields.refusal_witnessed_by ?? ''} onChange={v => updateField('refusal_witnessed_by', v)} placeholder="Name of witness" />
              </div>
              <div>
                <FieldLabel>Time of refusal</FieldLabel>
                <div className="flex gap-2">
                  <TextInput value={fields.time_of_refusal ?? ''} onChange={v => updateField('time_of_refusal', v)} placeholder="HH:MMZ" />
                  <button onClick={() => updateField('time_of_refusal', nowTime())}
                    className="text-lg px-3 py-2 rounded-lg border border-border text-primary whitespace-nowrap">NOW</button>
                </div>
              </div>
              <Toggle value={fields.safeguarding_concern ?? false} onChange={v => updateField('safeguarding_concern', v)} label="Safeguarding concern identified" />
              {!fields.patient_has_capacity && (
                <div>
                  <FieldLabel>Best interests decision</FieldLabel>
                  <TextArea value={fields.best_interests_decision ?? ''} onChange={v => updateField('best_interests_decision', v)} placeholder="Document best interests decision..." />
                </div>
              )}
              <Toggle value={fields.signed_refusal_form ?? false} onChange={v => updateField('signed_refusal_form', v)} label="Signed refusal form obtained" />
            </div>
          )}

          {/* ── ROLE ── */}
          {disposition === 'role' && (
            <div className="border-t border-border pt-3 flex flex-col gap-3">
              <div className="rounded-lg p-3 mb-1" style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }}>
                <p className="text-lg" style={{ color: '#FF3B30' }}>
                  Recognition of Life Extinct — ensure all documentation is complete.
                </p>
              </div>
              <div>
                <FieldLabel>Time of recognition</FieldLabel>
                <div className="flex gap-2">
                  <TextInput value={fields.time_of_recognition ?? ''} onChange={v => updateField('time_of_recognition', v)} placeholder="HH:MMZ" />
                  <button onClick={() => updateField('time_of_recognition', nowTime())}
                    className="text-lg px-3 py-2 rounded-lg border border-border text-primary whitespace-nowrap">NOW</button>
                </div>
              </div>
              <div>
                <FieldLabel>Criteria used</FieldLabel>
                <DropdownSelect value={fields.role_criteria ?? ''} onChange={v => updateField('role_criteria', v)} options={ROLE_CRITERIA} placeholder="Select criteria..." />
              </div>
              <Toggle value={fields.resuscitation_attempted ?? false} onChange={v => updateField('resuscitation_attempted', v)} label="Resuscitation attempted" />
              {fields.resuscitation_attempted && (
                <div>
                  <FieldLabel>Duration and outcome</FieldLabel>
                  <TextInput value={fields.resuscitation_details ?? ''} onChange={v => updateField('resuscitation_details', v)} placeholder="Duration, interventions, outcome" />
                </div>
              )}
              <Toggle value={fields.gp_notified ?? false} onChange={v => updateField('gp_notified', v)} label="GP notified" />
              <Toggle value={fields.police_notified ?? false} onChange={v => updateField('police_notified', v)} label="Police notified" />
              <Toggle value={fields.coroner_referral ?? false} onChange={v => updateField('coroner_referral', v)} label="Coroner referral required" />
              <Toggle value={fields.nok_notified ?? false} onChange={v => updateField('nok_notified', v)} label="Next of kin notified" />
            </div>
          )}
        </div>

        {/* Active action items */}
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
                      <span className="text-lg ml-1 opacity-50" style={{ color: '#FF9500' }}>— {formatActionAge(openedAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {cas.resolvedItems.length > 0 && <ResolvedActions items={cas.resolvedItems} />}

        {/* ePRF button */}
        <div className="mb-4">
          <button onClick={() => setShowEprf(!showEprf)}
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
                <p className="text-lg font-bold tracking-[0.2em]" style={{ color: 'hsl(var(--primary))' }}>ePRF — PATIENT HANDOVER</p>
                <CopyBtn text={buildCasualtyEprf(cas, inc, disposition, fields)} label="COPY ePRF" />
              </div>
              <div className="border border-border rounded-lg bg-card p-3">
                <div className="text-lg text-foreground leading-7 whitespace-pre-wrap break-words">
                  {buildCasualtyEprf(cas, inc, disposition, fields)}
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Fixed bottom: Handover button */}
      <div className="px-3 md:px-6 py-3 border-t border-border" style={{ background: '#1A1E24' }}>
        <div className="max-w-3xl mx-auto">
        {confirming ? (
          <div className="p-3 rounded-lg" style={{ border: '2px solid #FF9500', background: 'rgba(255,149,0,0.08)' }}>
            <p className="text-lg font-bold mb-2" style={{ color: '#FF9500' }}>Hand over this patient?</p>
            <p className="text-lg text-foreground opacity-70 mb-3">{DISPOSITION_LABELS[disposition]}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 text-lg font-bold border border-border rounded-lg bg-transparent text-foreground">CANCEL</button>
              <button onClick={doHandover}
                className="flex-1 py-2.5 text-lg font-bold rounded-lg"
                style={{ background: `${col}22`, border: `2px solid ${col}`, color: col }}>CONFIRM HANDOVER</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={onTransfer}
              className="flex-1 py-3 text-lg font-bold rounded-lg tracking-wide flex items-center justify-center gap-2"
              style={{ background: 'rgba(30,144,255,0.12)', border: '2px solid #1E90FF', color: '#1E90FF' }}>
              <ArrowRightLeft size={18} /> TRANSFER
            </button>
            <button onClick={() => setConfirming(true)}
              className="flex-1 py-3 text-lg font-bold rounded-lg tracking-wide"
              style={{ background: `${col}15`, border: `2px solid ${col}`, color: col }}>
              HANDOVER
            </button>
          </div>
        )}
        </div>
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

// Map of report_id -> set of casualty_keys that were transferred TO this crew
type TransferMap = Map<string, Set<string>>;

export function IncidentsTab({ session, onCasualtyClosed, refreshKey }: Props) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [nav, setNav] = useState<NavState>({ view: 'list' });
  const [closedKeys, setClosedKeys] = useState<Set<string>>(new Set());
  const [transferredCasualties, setTransferredCasualties] = useState<TransferMap>(new Map());
  const navRef = useRef<NavState>(nav);
  navRef.current = nav;

  const refreshClosedKeys = useCallback(async () => {
    const disps = await getCasualtyDispositions();
    setClosedKeys(new Set(disps.map(d => `${d.incident_id}:${d.casualty_key}`)));
  }, []);

  const fetchIncidents = useCallback(async () => {
    await refreshClosedKeys();
    const localIncidents: Incident[] = (await getReports())
      .filter((r) => {
        const reportShiftId = (r as { shift_id?: string | null }).shift_id;
        const sameShift = !!session.shift_id && reportShiftId === session.shift_id;
        const sameCallsignToday =
          r.session_callsign === session.callsign &&
          new Date(r.timestamp).toISOString().slice(0, 10) === session.session_date;

        return (sameShift || sameCallsignToday) && (r.status ?? 'active') === 'active';
      })
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

    try {
      const { reports, accepted_transfers } = await fetchIncidentsRemote({
        shift_id: session.shift_id,
        trust_id: session.trust_id,
        callsign: session.callsign,
        session_date: session.session_date,
      });

      if (reports) {
        remoteIncidents = (reports as any[]).map((r: any) => ({
          ...r,
          assessment: r.assessment ? sanitizeAssessment(r.assessment as unknown as Assessment) : null,
        }));
      }

      // Build map of transferred casualties for this crew
      if (accepted_transfers?.length) {
        const tMap: TransferMap = new Map();
        for (const t of accepted_transfers as any[]) {
          const rid = t.report_id as string;
          if (!tMap.has(rid)) tMap.set(rid, new Set());
          tMap.get(rid)!.add(t.casualty_key as string);
        }
        setTransferredCasualties(tMap);
      }
    } catch {
      // fall through with empty remote
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

  // Realtime subscription for instant incident updates
  useEffect(() => {
    const filters: any[] = [
      {
        event: 'INSERT',
        schema: 'public',
        table: 'herald_reports',
      },
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'herald_reports',
      },
    ];

    let channel = supabase.channel(`incidents-${session.shift_id ?? session.callsign}`);
    for (const f of filters) {
      channel = channel.on('postgres_changes', f, () => {
        fetchIncidents();
      });
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchIncidents, session.shift_id, session.callsign]);

  const handleCasualtyClosed = useCallback(async (d: CasualtyDisposition) => {
    onCasualtyClosed(d);
    await refreshClosedKeys();
    const currentNav = navRef.current;
    if (currentNav.view === 'casualty') {
      const allCas = extractCasualties(currentNav.incident);
      const closedChecks = await Promise.all(
        allCas.map(async c => c.key === d.casualty_key || await isCasualtyClosed(currentNav.incident.id, c.key))
      );
      const remaining = allCas.filter((c, i) => !closedChecks[i]);
      if (remaining.length === 0) {
        // doHandover already closed the incident in Supabase — just update localStorage and navigate
        await updateReport(currentNav.incident.id, { status: 'closed', confirmed_at: new Date().toISOString() } as any);
        setNav({ view: 'list' });
      } else {
        setNav({ view: 'incident', incident: currentNav.incident });
      }
    }
    fetchIncidents();
  }, [onCasualtyClosed, fetchIncidents, refreshClosedKeys]);

  // Helper: check if this incident is owned by this crew (not received via transfer)
  const isOwnIncident = useCallback((inc: Incident) => {
    if (!inc.session_callsign) return true;
    if (inc.session_callsign === session.callsign) return true;
    const reportShiftId = (inc as any).shift_id;
    if (session.shift_id && reportShiftId === session.shift_id) return true;
    return false;
  }, [session.callsign, session.shift_id]);

  // Helper: extract casualties, filtering to only transferred ones for transfer-received incidents
  const extractVisibleCasualties = useCallback((inc: Incident): CasualtyData[] => {
    const all = extractCasualties(inc);
    if (isOwnIncident(inc)) return all;
    // This incident was received via transfer — only show transferred casualties.
    // If we have no transfer data for it, show nothing (strict — prevents leaking
    // other patients when transfer sync has failed).
    const transferredKeys = transferredCasualties.get(inc.id);
    if (!transferredKeys || transferredKeys.size === 0) return [];
    return all.filter(c => transferredKeys.has(c.key));
  }, [isOwnIncident, transferredCasualties]);

  // Filter to only show incidents with open casualties
  const activeWithCasualties = incidents.filter(inc => {
    const cas = extractVisibleCasualties(inc);
    return cas.some(c => !closedKeys.has(`${inc.id}:${c.key}`));
  });

  // ── Render based on nav state ──

  if (nav.view === 'transfer') {
    return (
      <TransferInitiate
        session={session}
        incident={nav.incident}
        casualty={nav.casualty}
        onBack={() => setNav({ view: 'casualty', incident: nav.incident, casualty: nav.casualty })}
        onTransferInitiated={() => {
          fetchIncidents();
          setNav({ view: 'list' });
        }}
      />
    );
  }

  if (nav.view === 'casualty') {
    return (
      <CasualtyReportView
        cas={nav.casualty}
        inc={nav.incident}
        onBack={() => {
          const casualties = extractVisibleCasualties(nav.incident).filter(c => !closedKeys.has(`${nav.incident.id}:${c.key}`));
          if (casualties.length <= 1) setNav({ view: 'list' });
          else setNav({ view: 'incident', incident: nav.incident });
        }}
        onHandover={handleCasualtyClosed}
        onTransfer={() => setNav({ view: 'transfer', incident: nav.incident, casualty: nav.casualty })}
      />
    );
  }

  if (nav.view === 'incident') {
    return (
      <IncidentDetailView
        inc={nav.incident}
        onBack={() => setNav({ view: 'list' })}
        onSelectCasualty={(cas) => setNav({ view: 'casualty', incident: nav.incident, casualty: cas })}
        closedKeys={closedKeys}
        transferredKeys={transferredCasualties.get(nav.incident.id)}
      />
    );
  }

  // List view
  return (
    <div className="flex-1 overflow-auto px-3 md:px-6 py-3 md:py-5">
      <div className="max-w-3xl mx-auto">
        <PendingTransfers session={session} onTransferAccepted={fetchIncidents} />

        {/* Shift details */}
        <div className="flex items-center gap-2 flex-wrap mb-3 text-lg">
          <span className="font-bold text-foreground">
            {getVehicleLabel(session.vehicle_type) || (SERVICE_LABELS[session.service] ?? session.service.toUpperCase())}
          </span>
          <span style={{ color: '#C8D0CC' }}>
            {session.callsign}
            {session.operator_id ? ` · ${session.operator_id}` : ''}
          </span>
          {session.can_transport === false && (
            <span style={{ color: '#FF9500' }}>NO TRANSPORT</span>
          )}
          {session.station && (
            <span style={{ color: '#4A6058' }}>{session.station}</span>
          )}
        </div>

        <p className="text-lg font-bold tracking-[0.2em] mb-3" style={{ color: '#FF9500' }}>
          ACTIVE INCIDENTS ({activeWithCasualties.length})
        </p>
        {activeWithCasualties.length === 0 ? (
          <p className="text-lg text-foreground opacity-50">No active incidents</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
            {activeWithCasualties.map(inc => (
              <IncidentCard
                key={inc.id}
                inc={inc}
                onSelectCasualty={(cas) => setNav({ view: 'casualty', incident: inc, casualty: cas })}
                closedKeys={closedKeys}
                transferredKeys={transferredCasualties.get(inc.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
