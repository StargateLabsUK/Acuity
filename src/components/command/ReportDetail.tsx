import { useState, useCallback, useEffect, useRef } from 'react';
import { Pencil, Check, X, FileText } from 'lucide-react';
import type { CommandReport, CommandDisposition } from '@/hooks/useHeraldCommand';
import { SERVICE_LABELS, PRIORITY_COLORS, DISPOSITION_LABELS } from '@/lib/herald-types';
import type { DispositionType, DispositionFields } from '@/lib/herald-types';
import { getVehicleLabel } from '@/lib/vehicle-types';
import type { IncidentTransmission, ActionItem } from '@/lib/herald-types';
import { renderStructuredValue } from '@/components/StructuredValue';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeAssessment, formatActionAge } from '@/lib/sanitize-assessment';
import type { PatientTransfer } from '@/lib/transfer-types';

interface Props {
  report: CommandReport | null;
  dispositions?: CommandDisposition[];
  transfers?: PatientTransfer[];
}

/* ── Small UI helpers ── */

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

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-lg font-bold tracking-[0.2em] mb-2 md:mb-3" style={{ color: color ?? 'hsl(var(--foreground))' }}>
      {children}
    </div>
  );
}

function DetailCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-border rounded bg-card p-3 md:p-4 min-w-0 ${className}`}>
      {children}
    </div>
  );
}

function ResolvedSection({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-lg font-bold tracking-[0.15em] mb-2 bg-transparent border-none cursor-pointer"
        style={{ color: '#888' }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▶</span>
        RESOLVED ({items.length})
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <div key={i} className="rounded p-2.5 flex gap-3 items-start"
              style={{ background: 'rgba(136,136,136,0.06)', border: '1px solid rgba(136,136,136,0.15)' }}>
              <span className="text-lg flex-shrink-0" style={{ color: '#34C759' }}>✓</span>
              <div className="flex-1 min-w-0">
                <span className="text-lg text-foreground opacity-60 line-through break-words">{item.text}</span>
                {item.resolved_at && (
                  <span className="text-lg ml-2 opacity-40" style={{ color: '#888' }}>
                    resolved {formatActionAge(item.resolved_at).replace('open ', '')} ago
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Inline editable field ── */

function EditableField({
  label,
  value,
  placeholder,
  onSave,
  color,
  prominent,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (val: string) => Promise<void>;
  color: string;
  prominent?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = async () => {
    if (draft.trim() === value) { setEditing(false); return; }
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  };

  const cancel = () => { setDraft(value); setEditing(false); };

  return (
    <div>
      <SectionLabel color={color}>{label}</SectionLabel>
      <DetailCard className={prominent ? 'border-2' : ''}>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
              placeholder={placeholder}
              className="flex-1 bg-transparent text-lg text-foreground border-b border-primary outline-none py-1"
              disabled={saving}
            />
            <button onClick={save} disabled={saving}
              className="p-1.5 rounded hover:bg-accent transition-colors cursor-pointer" style={{ color: '#34C759' }}>
              <Check size={20} />
            </button>
            <button onClick={cancel}
              className="p-1.5 rounded hover:bg-accent transition-colors cursor-pointer" style={{ color: '#FF3B30' }}>
              <X size={20} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {value ? (
              <span className={`text-lg text-foreground break-words ${prominent ? 'font-bold' : ''}`}>{value}</span>
            ) : (
              <span className="text-lg opacity-50" style={{ color: '#FF9500' }}>{placeholder}</span>
            )}
            <button onClick={() => setEditing(true)}
              className="p-1.5 rounded hover:bg-accent transition-colors cursor-pointer flex-shrink-0"
              style={{ color: 'hsl(var(--primary))' }}>
              <Pencil size={18} />
            </button>
          </div>
        )}
      </DetailCard>
    </div>
  );
}

/* ── Disposition status mapping ── */

const DISPOSITION_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  conveyed:          { label: 'CONVEYED',       color: '#34C759', bg: 'rgba(52,199,89,0.10)',  border: 'rgba(52,199,89,0.4)' },
  see_and_treat:     { label: 'DISCHARGED',     color: '#8E8E93', bg: 'rgba(142,142,147,0.10)', border: 'rgba(142,142,147,0.4)' },
  see_and_refer:     { label: 'REFERRED',       color: '#1E90FF', bg: 'rgba(30,144,255,0.10)',  border: 'rgba(30,144,255,0.4)' },
  refused_transport: { label: 'REFUSED',        color: '#FF9500', bg: 'rgba(255,149,0,0.10)',   border: 'rgba(255,149,0,0.4)' },
  role:              { label: 'ROLE CONFIRMED', color: '#CCCCCC', bg: 'rgba(60,60,60,0.30)',    border: 'rgba(200,200,200,0.4)' },
};

function getTimeStr(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.getUTCHours().toString().padStart(2, '0') + ':' + d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
}

/* ── Casualty card with expandable ePRF for handed-over patients ── */

function CasualtyCard({ casualtyKey, val, cCol, disp, reportCallsign, report, transfers = [] }: {
  casualtyKey: string;
  val: any;
  cCol: string;
  disp: CommandDisposition | null;
  reportCallsign: string | null;
  report: CommandReport;
  transfers?: PatientTransfer[];
}) {
  const [showEprf, setShowEprf] = useState(false);
  const eprfText = disp ? buildCommandEprf(casualtyKey, val, disp, report) : '';

  const dispFields = (disp?.fields || {}) as DispositionFields;
  const statusInfo = disp ? (DISPOSITION_STATUS[disp.disposition] ?? { label: 'CLOSED', color: '#34C759', bg: 'rgba(52,199,89,0.10)', border: 'rgba(52,199,89,0.4)' }) : null;

  // Transfer status for this casualty
  const pendingTransfer = transfers.find(t => t.report_id === report.id && t.casualty_key === casualtyKey && t.status === 'pending');
  const acceptedTransfer = transfers.find(t => t.report_id === report.id && t.casualty_key === casualtyKey && t.status === 'accepted');
  // Was this casualty transferred IN to this crew?
  const transferredIn = acceptedTransfer && acceptedTransfer.to_callsign === reportCallsign;
  const transferringOut = pendingTransfer != null;

  // Infer status from treatment text when no disposition
  const treatment = val?.T_treatment ?? '';
  let inferredStatus = 'ON SCENE';
  let inferredColor = cCol;
  if (transferredIn) { inferredStatus = 'TRANSFERRED IN'; inferredColor = '#1E90FF'; }
  else if (transferringOut) { inferredStatus = 'TRANSFERRING'; inferredColor = '#FF9500'; }
  else if (/convey|transport|en route to/i.test(treatment)) { inferredStatus = 'TRANSPORTING'; inferredColor = '#FF9500'; }
  if (/deceased|confirmed dead/i.test(treatment)) { inferredStatus = 'DECEASED'; inferredColor = '#FF3B30'; }

  const isRefused = disp?.disposition === 'refused_transport';

  return (
    <DetailCard className={isRefused ? 'ring-2 ring-amber-500/40' : ''}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: cCol }}>{casualtyKey}</span>
          <span className="text-lg text-foreground">{val?.M ?? '—'}</span>
        </div>
        {statusInfo ? (
          <span className="text-lg font-bold rounded-sm px-2 py-0.5"
            style={{ color: statusInfo.color, background: statusInfo.bg, border: `1px solid ${statusInfo.border}` }}>
            {statusInfo.label}
          </span>
        ) : (
          <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
            style={{ color: inferredColor, border: `1px solid ${inferredColor}66`, background: `${inferredColor}14` }}>
            {inferredStatus}
          </span>
        )}
      </div>

      {/* Transfer context info */}
      {pendingTransfer && (
        <div className="text-lg mt-1 rounded px-2 py-1" style={{ color: '#FF9500', background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.2)' }}>
          ⏳ Transferring to <span className="font-bold">{pendingTransfer.to_callsign}</span> — awaiting acceptance
          <span className="opacity-60 ml-2">{getTimeStr(pendingTransfer.initiated_at)}</span>
        </div>
      )}
      {transferredIn && acceptedTransfer && (
        <div className="text-lg mt-1 rounded px-2 py-1" style={{ color: '#1E90FF', background: 'rgba(30,144,255,0.08)', border: '1px solid rgba(30,144,255,0.2)' }}>
          Received from <span className="font-bold" style={{ color: '#3DFF8C' }}>{acceptedTransfer.from_callsign}</span> at {getTimeStr(acceptedTransfer.accepted_at)}
        </div>
      )}

      {/* Safeguarding alert */}
      {(report.assessment as any)?.safeguarding?.concern_identified && (
        <div className="mt-2 rounded px-2 py-1.5" style={{ background: 'rgba(255,59,48,0.10)', border: '1px solid rgba(255,59,48,0.4)' }}>
          <span className="text-lg font-bold" style={{ color: '#FF3B30' }}>⚠ SAFEGUARDING</span>
          {(report.assessment as any).safeguarding.details && (
            <span className="text-lg ml-2 text-foreground">{(report.assessment as any).safeguarding.details}</span>
          )}
          {(report.assessment as any).safeguarding.police_requested && (
            <span className="text-lg ml-2 font-bold" style={{ color: '#FF9500' }}>· Police requested</span>
          )}
          {(report.assessment as any).safeguarding.referral_required && (
            <span className="text-lg ml-2 font-bold" style={{ color: '#FF3B30' }}>· Referral required</span>
          )}
        </div>
      )}

      {/* Clinical summary only — no PII */}
      <div className="text-lg text-foreground opacity-80 mt-1">
        {val?.I ? `Injuries: ${val.I}` : 'Injuries: —'}
      </div>
      {reportCallsign && (
        <div className="text-lg mt-1" style={{ color: '#3DFF8C' }}>Crew: {reportCallsign}</div>
      )}

      {/* Disposition-specific summary details */}
      {disp && (
        <div className="mt-2 pt-2 border-t border-border">
          {/* CONVEYED */}
          {disp.disposition === 'conveyed' && (
            <div className="flex flex-col gap-0.5">
              {dispFields.receiving_hospital && (
                <div className="text-lg text-foreground"><span className="font-bold" style={{ color: '#34C759' }}>Hospital:</span> {dispFields.receiving_hospital}</div>
              )}
              {dispFields.time_of_handover && (
                <div className="text-lg text-foreground opacity-70">Handover: {dispFields.time_of_handover}</div>
              )}
              {dispFields.handover_given_to && (
                <div className="text-lg text-foreground opacity-70">Given to: {dispFields.handover_given_to}</div>
              )}
            </div>
          )}

          {/* DISCHARGED */}
          {disp.disposition === 'see_and_treat' && (
            <div className="flex flex-col gap-0.5">
              {dispFields.time_of_discharge && (
                <div className="text-lg text-foreground opacity-70">Discharged: {dispFields.time_of_discharge}</div>
              )}
              <div className="text-lg text-foreground opacity-70">
                Advice given: {dispFields.advice_given ? 'Yes' : '—'}
              </div>
            </div>
          )}

          {/* REFERRED */}
          {disp.disposition === 'see_and_refer' && (
            <div className="flex flex-col gap-0.5">
              {dispFields.referral_destination && (
                <div className="text-lg text-foreground"><span className="font-bold" style={{ color: '#1E90FF' }}>Referred to:</span> {dispFields.referral_destination}</div>
              )}
              {dispFields.time_of_discharge && (
                <div className="text-lg text-foreground opacity-70">Time: {dispFields.time_of_discharge}</div>
              )}
            </div>
          )}

          {/* REFUSED — clinical risk flag */}
          {disp.disposition === 'refused_transport' && (
            <div>
              <div className="rounded p-2 mb-1" style={{ background: 'rgba(255,149,0,0.10)', border: '1px solid rgba(255,149,0,0.3)' }}>
                <div className="text-lg font-bold" style={{ color: '#FF9500' }}>⚠ CLINICAL RISK — Patient refused transport</div>
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="text-lg text-foreground opacity-70">
                  Capacity assessed: {dispFields.capacity_assessed ? (dispFields.patient_has_capacity ? 'Has capacity' : 'Lacks capacity') : 'Not assessed'}
                </div>
                {dispFields.time_of_refusal && (
                  <div className="text-lg text-foreground opacity-70">Refusal: {dispFields.time_of_refusal}</div>
                )}
              </div>
            </div>
          )}

          {/* ROLE */}
          {disp.disposition === 'role' && (
            <div className="flex flex-col gap-0.5">
              {dispFields.time_of_recognition && (
                <div className="text-lg text-foreground opacity-70">Recognition: {dispFields.time_of_recognition}</div>
              )}
              <div className="text-lg text-foreground opacity-70">
                GP: {dispFields.gp_notified ? '✓' : '—'} · Police: {dispFields.police_notified ? '✓' : '—'}
              </div>
            </div>
          )}

          {/* Handover timestamp */}
          <div className="text-lg text-foreground opacity-50 mt-1">
            Closed: {getTimeStr(disp.closed_at)}
          </div>

          {/* ePRF access */}
          <button onClick={() => setShowEprf(!showEprf)}
            className="mt-2 flex items-center gap-2 text-lg font-bold tracking-[0.1em] border rounded px-3 py-1.5 cursor-pointer transition-colors"
            style={{
              color: showEprf ? '#1A1E24' : 'hsl(var(--primary))',
              background: showEprf ? 'hsl(var(--primary))' : 'transparent',
              borderColor: 'hsl(var(--primary))',
            }}>
            <FileText size={16} />
            {showEprf ? 'HIDE ePRF' : 'VIEW ePRF'}
          </button>
          {showEprf && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-lg font-bold tracking-[0.15em]" style={{ color: 'hsl(var(--primary))' }}>ePRF — READ ONLY</span>
                <CopyBtn text={eprfText} label="COPY" />
              </div>
              <div className="border border-border rounded bg-card p-3">
                <div className="text-lg text-foreground leading-7 whitespace-pre-wrap break-words">{eprfText}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </DetailCard>
  );
}

function buildCommandEprf(casualtyKey: string, val: any, disp: CommandDisposition, report: CommandReport): string {
  const ts = new Date(report.created_at ?? report.timestamp);
  const dateStr = ts.toISOString().slice(0, 10);
  const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' +
    ts.getUTCMinutes().toString().padStart(2, '0') + ':' +
    ts.getUTCSeconds().toString().padStart(2, '0') + 'Z';
  const a = report.assessment;
  const incidentNum = report.incident_number ?? (a?.structured as any)?.incident_number ?? '—';
  const dispLabel = DISPOSITION_LABELS[disp.disposition as DispositionType];
  const fields = (disp.fields || {}) as DispositionFields;

  let header = `ePRF — PATIENT HANDOVER
═══════════════════════════
INCIDENT: ${incidentNum}
DATE/TIME: ${dateStr} ${timeStr}
CALLSIGN: ${report.session_callsign ?? '—'}

PATIENT: ${disp.casualty_label}
PRIORITY: ${disp.priority}

ATMIST:
  Age/Sex: ${val?.A ?? '—'}
  Time of Injury: ${val?.T ?? '—'}
  Mechanism: ${val?.M ?? '—'}
  Injuries: ${val?.I ?? '—'}${val?.status ? `\n  Status: ${val.status}` : ''}
  Signs/Vitals: ${val?.S ?? '—'}${val?.downtime ? `\n  Downtime: ${val.downtime}` : ''}
  Treatment: ${val?.T_treatment ?? '—'}

DISPOSITION: ${dispLabel}`;

  let dispSection = '';
  if (disp.disposition === 'conveyed') {
    dispSection = `\nRECEIVING HOSPITAL: ${fields.receiving_hospital || '—'}\nTIME OF HANDOVER: ${fields.time_of_handover || '—'}\nHANDOVER GIVEN TO: ${fields.handover_given_to || '—'}\nePRF HANDED OVER: ${fields.eprf_handed_over ? 'Yes' : 'No'}`;
  } else if (disp.disposition === 'see_and_treat') {
    dispSection = `\nCLINICAL JUSTIFICATION: ${fields.clinical_justification || '—'}\nOBSERVATIONS: ${fields.discharge_observations || '—'}\nADVICE GIVEN: ${fields.advice_given || '—'}\nSAFETY NET: ${fields.safety_net_given ? 'Given' : 'Not given'}\nTIME OF DISCHARGE: ${fields.time_of_discharge || '—'}`;
  } else if (disp.disposition === 'see_and_refer') {
    dispSection = `\nREFERRAL DESTINATION: ${fields.referral_destination || '—'}\nREFERRAL PATHWAY: ${fields.referral_pathway || '—'}\nREFERRAL ACCEPTED: ${fields.referral_accepted ? 'Accepted' : 'Advised only'}\nREFERENCE: ${fields.reference_number || '—'}`;
  } else if (disp.disposition === 'refused_transport') {
    dispSection = `\nCAPACITY ASSESSED: ${fields.capacity_assessed ? 'Yes' : 'No'}\nPATIENT HAS CAPACITY: ${fields.patient_has_capacity ? 'Yes' : 'No'}\nRISKS EXPLAINED: ${fields.risks_explained ? 'Yes' : 'No'}\nREFUSAL WITNESSED BY: ${fields.refusal_witnessed_by || '—'}\nTIME OF REFUSAL: ${fields.time_of_refusal || '—'}\nSIGNED FORM: ${fields.signed_refusal_form ? 'Obtained' : 'Not obtained'}`;
  } else if (disp.disposition === 'role') {
    dispSection = `\nTIME OF RECOGNITION: ${fields.time_of_recognition || '—'}\nCRITERIA: ${fields.role_criteria || '—'}\nRESUSCITATION ATTEMPTED: ${fields.resuscitation_attempted ? 'Yes' : 'No'}\nGP NOTIFIED: ${fields.gp_notified ? 'Yes' : 'No'}\nPOLICE NOTIFIED: ${fields.police_notified ? 'Yes' : 'No'}\nCORONER REFERRAL: ${fields.coroner_referral ? 'Yes' : 'No'}\nNOK NOTIFIED: ${fields.nok_notified ? 'Yes' : 'No'}`;
  }

  return `${header}${dispSection}
HANDED OVER: ${new Date(disp.closed_at).toISOString().slice(0, 16).replace('T', ' ')}Z
═══════════════════════════
Generated by Herald Radio Intelligence`;
}

/* ── Main component ── */

export function ReportDetail({ report, dispositions = [], transfers = [] }: Props) {
  const [transmissions, setTransmissions] = useState<IncidentTransmission[]>([]);
  // Local overrides for editable fields
  const [localIncidentNum, setLocalIncidentNum] = useState<string | null>(null);
  const [localHospital, setLocalHospital] = useState<string | null>(null);

  useEffect(() => {
    if (!report?.id) { setTransmissions([]); return; }
    setLocalIncidentNum(null);
    setLocalHospital(null);
    supabase
      .from('incident_transmissions')
      .select('*')
      .eq('report_id', report.id)
      .order('timestamp', { ascending: true })
      .then(({ data }) => {
        setTransmissions((data as unknown as IncidentTransmission[]) ?? []);
      });
  }, [report?.id]);

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <span className="font-heading text-5xl text-foreground tracking-[0.08em]">HERALD</span>
        <span className="text-lg tracking-[0.2em] mt-2" style={{ color: '#4A6058' }}>Select a transmission</span>
      </div>
    );
  }

  const rawA = report.assessment;
  const a = rawA ? sanitizeAssessment(rawA) : null;
  const priority = a?.priority ?? report.priority ?? 'P3';
  const col = PRIORITY_COLORS[priority] ?? '#34C759';
  const service = a?.service ?? report.service ?? 'unknown';
  const serviceLabel = SERVICE_LABELS[service] ?? service.toUpperCase();
  const vtCode = (report as any).vehicle_type;
  const vtLabel = getVehicleLabel(vtCode);
  const headerLabel = vtLabel && report.session_callsign
    ? `${vtLabel} — ${report.session_callsign}`
    : vtLabel || serviceLabel;
  const ts = new Date(report.created_at ?? report.timestamp);
  const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' +
    ts.getUTCMinutes().toString().padStart(2, '0') + ':' +
    ts.getUTCSeconds().toString().padStart(2, '0') + 'Z';
  const dateStr = ts.toISOString().slice(0, 10);

  const structured = a?.structured ?? {};
  const formattedReport = a?.formatted_report ?? '';
  const headline = a?.headline ?? report.headline ?? '';
  const priorityLabel = a?.priority_label ?? '';

  const incidentType = a?.incident_type ?? a?.protocol ?? 'Unknown';
  const majorIncident = a?.major_incident ?? false;
  const sceneLocation = a?.scene_location ?? structured['E'] ?? structured['Location'] ?? structured['grid'] ?? 'Not specified';

  // Editable fields — local override > report column > assessment
  const incidentNumber = localIncidentNum ?? report.incident_number ?? structured['incident_number'] ?? '';
  const hospitalFromAssessment: string[] = a?.receiving_hospital ?? [];
  const hospitalStr = localHospital ?? (report as any).receiving_hospital ?? (hospitalFromAssessment.length > 0 ? hospitalFromAssessment.join(', ') : '');

  const atmist = a?.atmist ?? null;
  const treatmentGiven: string[] = a?.treatment_given ?? [];
  const actionItems: (string | ActionItem)[] = (a as any)?.action_items ?? [];
  const resolvedActionItems: ActionItem[] = (a as any)?.resolved_action_items ?? [];

  const activeActions: (string | ActionItem)[] = [];
  const resolvedFromItems: ActionItem[] = [];
  for (const item of actionItems) {
    if (typeof item === 'object' && (item as ActionItem).resolved_at) {
      resolvedFromItems.push(item as ActionItem);
    } else {
      activeActions.push(item);
    }
  }
  const allResolved = [...resolvedActionItems, ...resolvedFromItems];

  // Extract METHANE fields from formatted_report when not in structured fields
  const extractFromReport = (patterns: RegExp[]): string => {
    if (!formattedReport) return '';
    for (const p of patterns) {
      const m = formattedReport.match(p);
      if (m && m[1]?.trim()) return m[1].trim();
    }
    return '';
  };

  const methaneHazards = structured['hazards'] ?? structured['H'] ??
    (extractFromReport([/[-–]\s*Hazards?:\s*(.+)/i]) || 'None reported');
  const methaneAccess = structured['access'] ?? structured['A'] ?? structured['access_routes'] ??
    (extractFromReport([/[-–]\s*Access:\s*(.+)/i]) || 'Not specified');
  const methaneNumCas = structured['number_of_casualties'] ?? structured['N'] ?? structured['casualties'] ??
    (extractFromReport([/[-–]\s*Number of casualties:\s*(.+)/i, /Casualties:\s*(.+)/i]) || '—');
  const methaneEmergency = structured['emergency_services'] ?? structured['E_services'] ??
    (extractFromReport([/[-–]\s*Emergency services:\s*(.+)/i]) || serviceLabel);

  const methane = {
    M: majorIncident ? 'MAJOR INCIDENT DECLARED' : 'Not declared',
    E: sceneLocation,
    T: incidentType !== 'Unknown' ? incidentType : (structured['incident_type'] ?? headline),
    H: methaneHazards,
    A_access: methaneAccess,
    N: methaneNumCas,
    E_emergency: methaneEmergency,
  };

  /* ── Save handlers ── */

  const saveIncidentNumber = async (val: string) => {
    setLocalIncidentNum(val);
    const updates: Record<string, unknown> = { incident_number: val || null };
    if (val) updates.headline = val;
    await supabase.from('herald_reports').update(updates).eq('id', report.id);
  };

  const saveHospital = async (val: string) => {
    setLocalHospital(val);
    await supabase.from('herald_reports').update({ receiving_hospital: val || null } as any).eq('id', report.id);
  };

  return (
    <div className="overflow-y-auto p-3 md:p-5 flex flex-col gap-4 md:gap-6 min-w-0 bg-card" style={{ scrollbarWidth: 'thin' }}>

      {/* 1. Incident Header */}
      <div className="rounded p-2.5 md:p-4" style={{ background: `${col}1F`, borderBottom: `3px solid ${col}` }}>
        <div className="flex flex-wrap items-start justify-between gap-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="text-lg uppercase font-bold tracking-[0.15em]" style={{ color: '#FFFFFF' }}>{headerLabel}</div>
              {majorIncident && (
                <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
                  style={{ color: '#FF3B30', border: '1px solid rgba(255,59,48,0.4)', background: 'rgba(255,59,48,0.12)' }}>
                  MAJOR INCIDENT
                </span>
              )}
              {(report as any).status === 'closed' ? (
                <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
                  style={{ color: '#888', border: '1px solid rgba(136,136,136,0.3)', background: 'rgba(136,136,136,0.08)' }}>
                  CLOSED
                </span>
              ) : (report as any).status === 'active' && incidentNumber ? (
                <span className="text-lg font-bold rounded-sm px-1.5 py-0.5"
                  style={{ color: '#FF9500', border: '1px solid rgba(255,149,0,0.3)', background: 'rgba(255,149,0,0.08)' }}>
                  ACTIVE
                </span>
              ) : null}
            </div>
            <div className="flex items-baseline gap-1.5 md:gap-3">
              <span className="font-heading text-2xl md:text-5xl leading-none" style={{ color: col }}>{priority}</span>
              <span className="font-heading text-lg md:text-[28px] tracking-wide" style={{ color: col }}>{priorityLabel}</span>
            </div>
            {incidentType && incidentType !== 'Unknown' && (
              <div className="text-lg font-bold mt-1 tracking-wide" style={{ color: col }}>{incidentType}</div>
            )}
            <p className="text-lg text-foreground font-medium mt-2 break-words">{headline}</p>
          </div>
          <div className="text-right">
            <div className="text-lg text-foreground">{dateStr}</div>
            <div className="h-px my-1" style={{ background: 'hsl(var(--border))' }} />
            <div className="text-lg text-foreground">{timeStr}</div>
          </div>
        </div>
      </div>

      {/* ── EDITABLE: Incident Number & Receiving Hospital ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EditableField
          label="INCIDENT NUMBER"
          value={incidentNumber}
          placeholder="Enter CAD incident number"
          onSave={saveIncidentNumber}
          color={col}
        />
        <EditableField
          label="RECEIVING HOSPITAL"
          value={hospitalStr}
          placeholder="Enter receiving hospital"
          onSave={saveHospital}
          color={col}
          prominent
        />
      </div>

      {/* 1. ACTION ITEMS — first so command sees what needs response */}
      {(activeActions.length > 0 || allResolved.length > 0) && (
        <div>
          <SectionLabel color="#FF9500">⚠ ACTION ITEMS</SectionLabel>
          {activeActions.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              {activeActions.map((item, i) => {
                const text = typeof item === 'object' ? (item as ActionItem).text : item;
                const openedAt = typeof item === 'object' ? (item as ActionItem).opened_at : report.created_at || report.timestamp;
                return (
                  <div key={i} className="rounded p-3 flex gap-3 items-start"
                    style={{ background: 'rgba(255,149,0,0.08)', border: '1px solid rgba(255,149,0,0.3)' }}>
                    <span className="text-lg font-bold flex-shrink-0" style={{ color: '#FF9500' }}>⚠</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-lg text-foreground font-medium break-words">{text}</span>
                      <span className="text-lg ml-2 opacity-60" style={{ color: '#FF9500' }}>— {formatActionAge(openedAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {allResolved.length > 0 && <ResolvedSection items={allResolved} />}
        </div>
      )}

      {/* 2. CASUALTIES */}
      {atmist && Object.keys(atmist).length > 0 && (
        <div>
          <SectionLabel color="#1E90FF">CASUALTIES</SectionLabel>
          <div className="flex flex-col gap-2">
            {Object.entries(atmist).map(([casualtyKey, val]: [string, any]) => {
              const cCol = PRIORITY_COLORS[casualtyKey] ?? PRIORITY_COLORS[casualtyKey.replace(/-\d+$/, '')] ?? '#1E90FF';
              const disp = dispositions.find(d => d.report_id === report.id && d.casualty_key === casualtyKey);

              return (
                <CasualtyCard
                  key={casualtyKey}
                  casualtyKey={casualtyKey}
                  val={val}
                  cCol={cCol}
                  disp={disp ?? null}
                  reportCallsign={report.session_callsign}
                  report={report}
                  transfers={transfers}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Resource Status */}
      {(() => {
        const reportDisps = dispositions.filter(d => d.report_id === report.id);
        const reportTransfers = transfers.filter(t => t.report_id === report.id);
        const casualtyKeys = atmist ? Object.keys(atmist) : [];
        // A casualty is "gone" if it's been disposed or transferred out (accepted)
        const allClosed = casualtyKeys.length > 0 && casualtyKeys.every(k =>
          reportDisps.some(d => d.casualty_key === k) ||
          reportTransfers.some(t => t.casualty_key === k && t.status === 'accepted' && t.from_callsign === report.session_callsign)
        );
        const hasPendingTransfer = reportTransfers.some(t => t.status === 'pending');
        const crewStatus = allClosed ? 'AVAILABLE' : hasPendingTransfer ? 'TRANSFERRING' : 'ON SCENE';
        const crewColor = allClosed ? '#1E90FF' : hasPendingTransfer ? '#FF9500' : '#3DFF8C';

        // Find latest disposition time for "available since"
        const latestDisp = allClosed && reportDisps.length > 0
          ? reportDisps.reduce((a, b) => new Date(a.closed_at) > new Date(b.closed_at) ? a : b)
          : null;
        const availableSince = latestDisp ? getTimeStr(latestDisp.closed_at) : null;

        // Incident status
        const incidentClosed = allClosed || report.status === 'closed';

        return (
          <div>
            <SectionLabel color={col}>RESOURCE STATUS</SectionLabel>
            <DetailCard>
              <div className="flex flex-col gap-2">
                {report.session_callsign && (
                  <div className="flex justify-between items-center">
                    <span className="text-lg text-foreground font-bold">{report.session_callsign}</span>
                    <div className="text-right">
                      <span className="text-lg font-bold" style={{ color: crewColor }}>{crewStatus}</span>
                      {availableSince && (
                        <div className="text-lg opacity-60" style={{ color: crewColor }}>since {availableSince}</div>
                      )}
                    </div>
                  </div>
                )}
                {actionItems.some(item => /HEMS/i.test(typeof item === 'string' ? item : (item as ActionItem).text)) && (
                  <div className="flex justify-between">
                    <span className="text-lg text-foreground font-bold">HEMS</span>
                    <span className="text-lg" style={{ color: '#FF9500' }}>
                      {allResolved.some(i => /HEMS/i.test(i.text)) ? 'CONFIRMED' : 'AWAITING'}
                    </span>
                  </div>
                )}
                {hospitalStr && (
                  <div className="flex justify-between">
                    <span className="text-lg text-foreground font-bold">HOSPITAL</span>
                    <span className="text-lg text-foreground">{hospitalStr}</span>
                  </div>
                )}
                {structured['emergency_services'] && (
                  <div className="text-lg text-foreground opacity-80 mt-1">
                    Other services: {structured['emergency_services']}
                  </div>
                )}
                {/* Incident closed indicator */}
                {incidentClosed && (
                  <div className="mt-1 pt-1 border-t border-border flex justify-between items-center">
                    <span className="text-lg font-bold" style={{ color: '#8E8E93' }}>INCIDENT</span>
                    <span className="text-lg font-bold rounded-sm px-2 py-0.5"
                      style={{ color: '#8E8E93', background: 'rgba(142,142,147,0.10)', border: '1px solid rgba(142,142,147,0.3)' }}>
                      CLOSED {availableSince ? `· ${availableSince}` : ''}
                    </span>
                  </div>
                )}
              </div>
            </DetailCard>
          </div>
        );
      })()}

      {/* METHANE */}
      <div>
        <SectionLabel color={col}>METHANE</SectionLabel>
        <DetailCard>
          <div className="flex flex-col gap-3">
            {[
              { key: 'M', label: 'Major incident', value: methane.M },
              { key: 'E', label: 'Exact location', value: methane.E },
              { key: 'T', label: 'Type of incident', value: methane.T },
              { key: 'H', label: 'Hazards', value: methane.H },
              { key: 'A', label: 'Access routes', value: methane.A_access },
              { key: 'N', label: 'Number of casualties', value: methane.N },
              { key: 'E2', label: 'Emergency services', value: methane.E_emergency },
            ].map(({ key, label, value }) => (
              <div key={key}>
                <div className="flex gap-2">
                  <span className="text-lg font-bold min-w-[24px]" style={{ color: col }}>{key === 'E2' ? 'E' : key}</span>
                  <span className="text-lg font-bold" style={{ color: col }}>{label}</span>
                </div>
                <div className="text-lg text-foreground ml-8 break-words">{value || '—'}</div>
              </div>
            ))}
          </div>
        </DetailCard>
      </div>

      {/* TRANSMISSION LOG */}
      {transmissions.length > 0 && (
        <div>
          <SectionLabel color="#1E90FF">TRANSMISSION LOG ({transmissions.length})</SectionLabel>
          <div className="flex flex-col gap-2" style={{ maxHeight: transmissions.length > 10 ? '60rem' : undefined, overflowY: transmissions.length > 10 ? 'auto' : undefined, scrollbarWidth: 'thin' }}>
            {transmissions.map((tx, i) => {
              const isSystemTransfer = tx.headline?.startsWith('PATIENT TRANSFER:') || tx.transcript?.startsWith('[SYSTEM EVENT');
              const txTime = new Date(tx.timestamp);
              const txTimeStr = txTime.getUTCHours().toString().padStart(2, '0') + ':' +
                txTime.getUTCMinutes().toString().padStart(2, '0') + ':' +
                txTime.getUTCSeconds().toString().padStart(2, '0') + 'Z';

              if (isSystemTransfer) {
                return (
                  <div key={tx.id} className="rounded p-3" style={{ background: 'rgba(30,144,255,0.06)', border: '1px solid rgba(30,144,255,0.25)' }}>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-lg font-bold rounded-sm px-2 py-0.5" style={{ color: '#1E90FF', background: 'rgba(30,144,255,0.12)', border: '1px solid rgba(30,144,255,0.3)' }}>
                        SYSTEM
                      </span>
                      <span className="text-lg text-foreground">{txTimeStr}</span>
                    </div>
                    {tx.headline && <p className="text-lg font-bold mb-1 break-words" style={{ color: '#1E90FF' }}>{tx.headline}</p>}
                    {tx.transcript && (
                      <pre className="text-lg text-foreground opacity-80 break-words whitespace-pre-wrap" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                        {tx.transcript}
                      </pre>
                    )}
                  </div>
                );
              }

              const txPriority = tx.priority ?? 'P3';
              const txCol = PRIORITY_COLORS[txPriority] ?? '#34C759';
              const txAssessment = tx.assessment as unknown as Record<string, any> | null;
              const txStructured = txAssessment?.structured as Record<string, string> | undefined;
              return (
                <DetailCard key={tx.id}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg font-bold" style={{ color: '#1E90FF' }}>#{i + 1}</span>
                    <span className="text-lg font-bold rounded-sm px-1.5 py-0.5" style={{ color: txCol, border: `1px solid ${txCol}66` }}>{txPriority}</span>
                    <span className="text-lg text-foreground">{txTimeStr}</span>
                    {tx.session_callsign && (
                      <span className="text-lg font-semibold" style={{ color: '#3DFF8C' }}>{tx.session_callsign}</span>
                    )}
                  </div>
                  {tx.headline && <p className="text-lg text-foreground font-medium mb-1 break-words">{tx.headline}</p>}
                  {tx.transcript && <p className="text-lg text-foreground italic opacity-80 break-words mb-2">&ldquo;{tx.transcript}&rdquo;</p>}
                  {txStructured && Object.keys(txStructured).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="flex flex-col gap-1.5">
                        {Object.entries(txStructured).map(([k, v]) => (
                          <div key={k}>
                            <span className="text-lg font-bold" style={{ color: txCol }}>{k}: </span>
                            <span className="text-lg text-foreground whitespace-pre-wrap">{renderStructuredValue(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </DetailCard>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. Scene Access & Hazards */}
      {(methane.A_access !== 'Not specified' || methane.H !== 'None reported') && (
        <div>
          <SectionLabel color={col}>SCENE ACCESS & HAZARDS</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DetailCard>
              <div className="text-lg font-bold mb-1" style={{ color: col }}>ACCESS ROUTES</div>
              <div className="text-lg text-foreground break-words">{methane.A_access}</div>
            </DetailCard>
            <DetailCard>
              <div className="text-lg font-bold mb-1" style={{ color: col }}>HAZARDS</div>
              <div className="text-lg text-foreground break-words">{methane.H}</div>
            </DetailCard>
          </div>
        </div>
      )}

      {/* Formatted Report */}
      {formattedReport && (
        <div>
          <div className="flex items-center justify-between mb-2 md:mb-3">
            <SectionLabel>FORMATTED REPORT</SectionLabel>
            <CopyBtn text={formattedReport} label="COPY" />
          </div>
          <DetailCard>
            <div className="text-lg text-foreground leading-7 md:leading-8 whitespace-pre-wrap break-words">
              {formattedReport}
            </div>
          </DetailCard>
        </div>
      )}

      {/* Session Info */}
      {(report.session_callsign || report.session_operator_id || report.session_service || report.session_station) && (
        <DetailCard>
          <SectionLabel color="hsl(var(--primary))">SESSION INFO</SectionLabel>
          <div className="flex flex-col gap-1" style={{ fontFamily: "'IBM Plex Mono', monospace", color: '#4A6058', fontSize: 18 }}>
            {report.session_callsign && <div><span className="font-bold">UNIT:</span> {report.session_callsign}</div>}
            {report.session_operator_id && <div><span className="font-bold">OFFICER:</span> {report.session_operator_id}</div>}
            {report.session_service && <div><span className="font-bold">SERVICE:</span> {report.session_service}</div>}
            {report.session_station && <div><span className="font-bold">STATION:</span> {report.session_station}</div>}
          </div>
        </DetailCard>
      )}
    </div>
  );
}
