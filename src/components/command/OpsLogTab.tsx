import { useState, useMemo, useCallback } from 'react';
import { Search, ChevronDown, ChevronRight, Download, ArrowLeft, FileText, ArrowRightLeft } from 'lucide-react';
import { useOpsLog, type OpsReport, type OpsTransmission, type OpsDisposition, type OpsFilters, type Shift } from '@/hooks/useOpsLog';
import { PRIORITY_COLORS, DISPOSITION_LABELS } from '@/lib/herald-types';
import type { DispositionType, Assessment } from '@/lib/herald-types';
import type { PatientTransfer } from '@/lib/transfer-types';
import { sanitizeAssessment } from '@/lib/sanitize-assessment';

// ── Helpers ──

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.getUTCHours().toString().padStart(2, '0') + ':' + d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  return fmtDate(iso) + ' ' + fmtTime(iso);
}

function getCasualtyCount(report: OpsReport): number {
  const a = report.assessment;
  if (!a?.atmist || typeof a.atmist !== 'object') return 0;
  return Object.keys(a.atmist).length;
}

function getLocation(report: OpsReport): string {
  const s = report.assessment?.structured;
  if (s && typeof s === 'object') {
    const loc = (s as any).location ?? (s as any).scene_location;
    if (loc) return String(loc);
  }
  return '—';
}

function getIncidentType(report: OpsReport): string {
  const a = report.assessment;
  if (a?.headline) return a.headline;
  return report.headline ?? 'Unknown';
}

function matchesSearch(text: string | null | undefined, q: string): boolean {
  if (!text || !q) return !q;
  return text.toLowerCase().includes(q.toLowerCase());
}

// ── Filter logic ──

function applyFilters(reports: OpsReport[], dispositions: OpsDisposition[], filters: OpsFilters): OpsReport[] {
  let filtered = [...reports];
  const q = filters.search.trim().toLowerCase();

  if (q) {
    filtered = filtered.filter(r =>
      matchesSearch(r.session_callsign, q) ||
      matchesSearch(r.headline, q) ||
      matchesSearch(r.assessment?.headline, q) ||
      matchesSearch(r.incident_number, q) ||
      matchesSearch(r.session_operator_id, q) ||
      matchesSearch(getLocation(r), q) ||
      matchesSearch(getIncidentType(r), q) ||
      matchesSearch(r.transcript, q)
    );
  }

  if (filters.callsign) {
    filtered = filtered.filter(r => r.session_callsign === filters.callsign);
  }

  if (filters.operatorId) {
    filtered = filtered.filter(r => r.session_operator_id === filters.operatorId);
  }

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    filtered = filtered.filter(r => new Date(r.created_at ?? r.timestamp).getTime() >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime() + 86400000;
    filtered = filtered.filter(r => new Date(r.created_at ?? r.timestamp).getTime() < to);
  }

  if (filters.outcome) {
    const reportIdsWithOutcome = new Set(
      dispositions.filter(d => d.disposition === filters.outcome).map(d => d.report_id)
    );
    filtered = filtered.filter(r => reportIdsWithOutcome.has(r.id));
  }

  if (filters.incidentType) {
    const typeQ = filters.incidentType.toLowerCase();
    filtered = filtered.filter(r => {
      const type = getIncidentType(r).toLowerCase();
      return type.includes(typeQ);
    });
  }

  return filtered;
}

// ── Styles ──

const inputStyle: React.CSSProperties = {
  background: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
};

const badgeStyle = (color: string) => ({
  color,
  border: `1px solid ${color}44`,
  background: `${color}12`,
  fontSize: 13,
  fontWeight: 700 as const,
  padding: '2px 8px',
  borderRadius: 4,
  whiteSpace: 'nowrap' as const,
});

// ── Expandable Section ──

function Expandable({ label, color, children }: { label: string; color?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-transparent cursor-pointer hover:bg-muted/30 transition-colors">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-sm font-bold tracking-wide" style={{ color: color ?? 'hsl(var(--foreground))' }}>{label}</span>
      </button>
      {open && <div className="px-3 pb-3 border-t border-border">{children}</div>}
    </div>
  );
}

// ── Transfer Event Entry ──

function TransferEventEntry({ tx, index }: { tx: OpsTransmission; index: number }) {
  const a = tx.assessment as any;
  return (
    <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: '#3B82F644', background: '#3B82F608' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold" style={{ color: 'hsl(var(--primary))' }}>#{index + 1}</span>
        <span className="text-sm text-muted-foreground">{fmtTime(tx.timestamp)}</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded" style={badgeStyle('#3B82F6')}>SYSTEM</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded" style={badgeStyle('#8B5CF6')}>TRANSFER</span>
      </div>
      <p className="text-sm text-foreground font-semibold">{tx.headline ?? 'Patient Transfer'}</p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-1">
        {a?.from_callsign && (
          <>
            <span className="text-muted-foreground">From</span>
            <span className="text-foreground font-semibold">{a.from_callsign}</span>
          </>
        )}
        {a?.to_callsign && (
          <>
            <span className="text-muted-foreground">To</span>
            <span className="text-foreground font-semibold">{a.to_callsign}</span>
          </>
        )}
        {a?.initiated_at && (
          <>
            <span className="text-muted-foreground">Initiated</span>
            <span className="text-foreground">{fmtTime(a.initiated_at)}</span>
          </>
        )}
        {a?.accepted_at && (
          <>
            <span className="text-muted-foreground">Accepted</span>
            <span className="text-foreground">{fmtTime(a.accepted_at)}</span>
          </>
        )}
      </div>

      <Expandable label="FULL SYSTEM TRANSCRIPT" color="#3B82F6">
        <pre className="text-sm text-foreground whitespace-pre-wrap break-words mt-2 font-mono leading-relaxed">
          {tx.transcript ?? '—'}
        </pre>
      </Expandable>
    </div>
  );
}

// ── Transmission Entry ──

function TransmissionEntry({ tx, index }: { tx: OpsTransmission; index: number }) {
  // Detect system transfer event
  const isSystemEvent = tx.transcript?.startsWith('[SYSTEM EVENT') || (tx.assessment as any)?.system_event;
  if (isSystemEvent) return <TransferEventEntry tx={tx} index={index} />;

  const p = tx.priority ?? tx.assessment?.priority;
  const col = p ? PRIORITY_COLORS[p] ?? 'hsl(var(--muted-foreground))' : 'hsl(var(--muted-foreground))';

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold" style={{ color: 'hsl(var(--primary))' }}>#{index + 1}</span>
        <span className="text-sm text-muted-foreground">{fmtTime(tx.timestamp)}</span>
        {tx.session_callsign && (
          <span className="text-sm font-semibold" style={badgeStyle('#3DFF8C')}>{tx.session_callsign}</span>
        )}
        {p && <span className="text-sm font-bold" style={badgeStyle(col)}>{p}</span>}
      </div>
      <p className="text-sm text-foreground">{tx.headline ?? tx.assessment?.headline ?? '—'}</p>

      <div className="space-y-1.5">
        <Expandable label="VERBATIM TRANSCRIPT" color="#1E90FF">
          <pre className="text-sm text-foreground whitespace-pre-wrap break-words mt-2 font-mono leading-relaxed">
            {tx.transcript ?? 'No transcript available'}
          </pre>
        </Expandable>

        <Expandable label="RAW WHISPER OUTPUT" color="#FF9500">
          <pre className="text-sm text-foreground whitespace-pre-wrap break-words mt-2 font-mono leading-relaxed">
            {tx.transcript ?? 'No raw output available'}
          </pre>
        </Expandable>

        {tx.assessment && (
          <Expandable label="HERALD ASSESSMENT" color="#34C759">
            <div className="mt-2 flex flex-col gap-3">
              {(() => {
                const a = tx.assessment as unknown as Record<string, unknown>;
                return Object.entries(a).map(([key, val]) => {
                  if (val == null || val === '') return null;
                  const label = key.replace(/_/g, ' ').toUpperCase();

                  // ATMIST object with nested casualty keys
                  if (key === 'atmist' && typeof val === 'object' && !Array.isArray(val)) {
                    return (
                      <div key={key}>
                        <div className="text-sm font-bold tracking-[0.15em] mb-1" style={{ color: '#34C759' }}>{label}</div>
                        {Object.entries(val as Record<string, unknown>).map(([casKey, casVal]) => (
                          <div key={casKey} className="ml-2 mb-2">
                            <div className="text-sm font-bold text-foreground mb-0.5">{casKey}</div>
                            {typeof casVal === 'object' && casVal !== null ? (
                              <div className="ml-2 flex flex-col gap-0.5">
                                {Object.entries(casVal as Record<string, unknown>).map(([field, fv]) => (
                                  <div key={field} className="text-sm">
                                    <span style={{ color: '#4A6058' }}>{field}:</span>{' '}
                                    <span className="text-foreground">{String(fv ?? '—')}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-sm text-foreground ml-2">{String(casVal ?? '—')}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  }

                  // Arrays (actions, action_items, clinical_findings)
                  if (Array.isArray(val)) {
                    return (
                      <div key={key}>
                        <div className="text-sm font-bold tracking-[0.15em] mb-1" style={{ color: '#34C759' }}>{label}</div>
                        <div className="ml-2 flex flex-col gap-0.5">
                          {(val as unknown[]).map((item, i) => (
                            <div key={i} className="text-sm text-foreground">
                              • {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // Nested objects (structured)
                  if (typeof val === 'object') {
                    return (
                      <div key={key}>
                        <div className="text-sm font-bold tracking-[0.15em] mb-1" style={{ color: '#34C759' }}>{label}</div>
                        <div className="ml-2 flex flex-col gap-0.5">
                          {Object.entries(val as Record<string, unknown>).map(([sk, sv]) => (
                            <div key={sk} className="text-sm">
                              <span style={{ color: '#4A6058' }}>{sk.replace(/_/g, ' ')}:</span>{' '}
                              <span className="text-foreground">{String(sv ?? '—')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  // Simple string values
                  return (
                    <div key={key}>
                      <span className="text-sm font-bold tracking-[0.1em]" style={{ color: '#34C759' }}>{label}: </span>
                      <span className="text-sm text-foreground">{String(val)}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </Expandable>
        )}
      </div>
    </div>
  );
}

// ── Expanded Incident View ──

function IncidentDetail({
  report,
  transmissions,
  dispositions,
  transfers,
  onBack,
}: {
  report: OpsReport;
  transmissions: OpsTransmission[];
  dispositions: OpsDisposition[];
  transfers: PatientTransfer[];
  onBack: () => void;
}) {
  const p = report.assessment?.priority ?? report.priority;
  const col = p ? PRIORITY_COLORS[p] ?? '#888' : '#888';
  const a = report.assessment ? sanitizeAssessment(report.assessment) : null;
  const reportDisps = dispositions.filter(d => d.report_id === report.id);
  const reportTransfers = transfers.filter(t => t.report_id === report.id);
  const reportTx = transmissions
    .filter(t => t.report_id === report.id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Split transmissions into pre-transfer and post-transfer sections
  const transferTxIndex = reportTx.findIndex(tx =>
    tx.transcript?.startsWith('[SYSTEM EVENT') || (tx.assessment as any)?.system_event
  );
  const hasTransferEvent = transferTxIndex >= 0;
  const preTransferTx = hasTransferEvent ? reportTx.slice(0, transferTxIndex) : reportTx;
  const transferEventTx = hasTransferEvent ? [reportTx[transferTxIndex]] : [];
  const postTransferTx = hasTransferEvent ? reportTx.slice(transferTxIndex + 1) : [];

  const exportJSON = useCallback(() => {
    const payload = {
      incident: report,
      transmissions: reportTx,
      dispositions: reportDisps,
      transfers: reportTransfers,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `incident-${report.incident_number ?? report.id.slice(0, 8)}-${fmtDate(report.created_at)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [report, reportTx, reportDisps, reportTransfers]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-primary bg-transparent cursor-pointer">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex-1" />
        <button onClick={exportJSON}
          className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded border cursor-pointer"
          style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--primary))' }}>
          <Download size={14} /> EXPORT JSON
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Header */}
        <div className="rounded-lg p-4" style={{ background: `${col}12`, borderLeft: `4px solid ${col}` }}>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <span className="text-xl font-bold" style={{ color: col }}>{p ?? '—'}</span>
            {report.incident_number && (
              <span className="text-sm font-bold px-2 py-0.5 rounded" style={{ border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                #{report.incident_number}
              </span>
            )}
            <span className="text-sm font-bold" style={badgeStyle(report.status === 'closed' ? '#888' : '#FF9500')}>
              {report.status === 'closed' ? 'CLOSED' : 'ACTIVE'}
            </span>
            {reportTransfers.length > 0 && (
              <span className="text-sm font-bold" style={badgeStyle('#8B5CF6')}>
                <ArrowRightLeft size={12} className="inline mr-1" />TRANSFERRED
              </span>
            )}
          </div>
          <p className="text-base text-foreground font-semibold">{getIncidentType(report)}</p>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
            <span>📍 {getLocation(report)}</span>
            {report.session_callsign && <span>🚑 {report.session_callsign}</span>}
            <span>Opened: {fmtTime(report.created_at ?? report.timestamp)}</span>
            {report.confirmed_at && <span>Closed: {fmtTime(report.confirmed_at)}</span>}
          </div>
        </div>

        {/* 1. Incident Summary */}
        <div>
          <h3 className="text-sm font-bold tracking-widest text-muted-foreground mb-2">INCIDENT SUMMARY</h3>
          {a?.formatted_report ? (
            <div className="border border-border rounded-lg p-3 text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {a.formatted_report}
            </div>
          ) : (
            <div className="border border-border rounded-lg p-3 text-sm text-muted-foreground">
              No consolidated report available
            </div>
          )}
        </div>

        {/* 2. Transfer History */}
        {reportTransfers.length > 0 && (
          <div>
            <h3 className="text-sm font-bold tracking-widest text-muted-foreground mb-2">
              <ArrowRightLeft size={14} className="inline mr-1.5" />
              TRANSFER HISTORY ({reportTransfers.length})
            </h3>
            <div className="space-y-2">
              {reportTransfers.map(t => {
                const tc = t.status === 'accepted' ? '#34C759' : t.status === 'declined' ? '#FF3B30' : '#FF9500';
                const statusLabel = t.status === 'accepted' ? 'ACCEPTED' : t.status === 'declined' ? 'DECLINED' : 'PENDING';
                return (
                  <div key={t.id} className="border rounded-lg p-3" style={{ borderColor: `${tc}44`, background: `${tc}08` }}>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold" style={badgeStyle(PRIORITY_COLORS[t.priority] ?? '#888')}>{t.priority}</span>
                      <span className="text-sm text-foreground font-medium">{t.casualty_label}</span>
                      <span className="text-sm font-bold" style={badgeStyle(tc)}>{statusLabel}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm mt-1">
                      <span className="text-muted-foreground">From</span>
                      <span className="text-foreground font-semibold">{t.from_callsign}</span>
                      <span className="text-muted-foreground">To</span>
                      <span className="text-foreground font-semibold">{t.to_callsign}</span>
                      <span className="text-muted-foreground">Initiated</span>
                      <span className="text-foreground">{fmtTime(t.initiated_at)}</span>
                      {t.accepted_at && (
                        <>
                          <span className="text-muted-foreground">Accepted</span>
                          <span className="text-foreground">{fmtTime(t.accepted_at)}</span>
                        </>
                      )}
                      {t.declined_at && (
                        <>
                          <span className="text-muted-foreground">Declined</span>
                          <span className="text-foreground">{fmtTime(t.declined_at)}</span>
                        </>
                      )}
                      {t.declined_reason && (
                        <>
                          <span className="text-muted-foreground">Reason</span>
                          <span className="text-foreground">{t.declined_reason}</span>
                        </>
                      )}
                    </div>
                    {/* Clinical snapshot */}
                    {t.clinical_snapshot && Object.keys(t.clinical_snapshot).length > 0 && (
                      <Expandable label="CLINICAL SNAPSHOT (PRE-TRANSFER)" color="#8B5CF6">
                        <pre className="text-xs text-foreground whitespace-pre-wrap break-words mt-2 font-mono leading-relaxed">
                          {JSON.stringify(t.clinical_snapshot, null, 2)}
                        </pre>
                      </Expandable>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Casualty Outcomes */}
        {(getCasualtyCount(report) > 0 || reportDisps.length > 0) && (
          <div>
            <h3 className="text-sm font-bold tracking-widest text-muted-foreground mb-2">
              CASUALTY OUTCOMES ({Math.max(getCasualtyCount(report), reportDisps.length)})
            </h3>
            <div className="space-y-2">
              {reportDisps.length > 0 ? (
                reportDisps.map(d => {
                  const dc = PRIORITY_COLORS[d.priority] ?? '#888';
                  const label = DISPOSITION_LABELS[d.disposition as DispositionType] ?? d.disposition;
                  // Check if this casualty was transferred
                  const casualtyTransfer = reportTransfers.find(t => t.casualty_key === d.casualty_key && t.status === 'accepted');
                  return (
                    <div key={d.id} className="border border-border rounded-lg p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold" style={badgeStyle(dc)}>{d.priority}</span>
                        <span className="text-sm text-foreground font-medium">{d.casualty_label}</span>
                        <span className="text-sm" style={badgeStyle(d.disposition === 'conveyed' ? '#34C759' : d.disposition === 'refused_transport' ? '#FF9500' : '#888')}>
                          {label}
                        </span>
                        {casualtyTransfer && (
                          <span className="text-xs font-bold" style={badgeStyle('#8B5CF6')}>
                            TRANSFERRED {casualtyTransfer.from_callsign} → {casualtyTransfer.to_callsign}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Closed: {fmtDateTime(d.closed_at)}
                        {d.disposition === 'conveyed' && (d.fields as any)?.receiving_hospital && (
                          <> · Hospital: {(d.fields as any).receiving_hospital}</>
                        )}
                      </p>
                    </div>
                  );
                })
              ) : (
                Object.entries(a?.atmist ?? {}).map(([key, val]) => {
                  const casVal = val as any;
                  const casualtyTransfer = reportTransfers.find(t => t.casualty_key === key);
                  return (
                    <div key={key} className="border border-border rounded-lg p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-foreground font-medium">{key}</span>
                        {casualtyTransfer ? (
                          <span className="text-xs font-bold" style={badgeStyle(
                            casualtyTransfer.status === 'accepted' ? '#8B5CF6' :
                            casualtyTransfer.status === 'pending' ? '#FF9500' : '#888'
                          )}>
                            {casualtyTransfer.status === 'accepted'
                              ? `TRANSFERRED → ${casualtyTransfer.to_callsign}`
                              : casualtyTransfer.status === 'pending'
                                ? `TRANSFERRING → ${casualtyTransfer.to_callsign}`
                                : 'TRANSFER DECLINED'}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">— On scene (no disposition)</span>
                        )}
                      </div>
                      {casVal?.A && <p className="text-xs text-muted-foreground mt-1">Age/Sex: {casVal.A}</p>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 4. Transmission Log — split by transfer event */}
        <div>
          {hasTransferEvent ? (
            <>
              {/* Pre-transfer transmissions */}
              <h3 className="text-sm font-bold tracking-widest text-muted-foreground mb-2">
                PRE-TRANSFER TRANSMISSIONS ({preTransferTx.length})
              </h3>
              {preTransferTx.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {preTransferTx.map((tx, i) => (
                    <TransmissionEntry key={tx.id} tx={tx} index={i} />
                  ))}
                </div>
              ) : (
                <div className="border border-border rounded-lg p-3 text-sm text-muted-foreground mb-4">
                  No pre-transfer transmissions
                </div>
              )}

              {/* Transfer event divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" style={{ borderColor: '#8B5CF644' }} />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 text-xs font-bold tracking-widest" style={{
                    background: 'hsl(var(--background))',
                    color: '#8B5CF6',
                  }}>
                    ← TRANSFER EVENT →
                  </span>
                </div>
              </div>

              {transferEventTx.map((tx, i) => (
                <div key={tx.id} className="mb-4">
                  <TransmissionEntry tx={tx} index={preTransferTx.length + i} />
                </div>
              ))}

              {/* Post-transfer transmissions */}
              {postTransferTx.length > 0 && (
                <>
                  <h3 className="text-sm font-bold tracking-widest text-muted-foreground mb-2">
                    POST-TRANSFER TRANSMISSIONS ({postTransferTx.length})
                  </h3>
                  <div className="space-y-2">
                    {postTransferTx.map((tx, i) => (
                      <TransmissionEntry key={tx.id} tx={tx} index={preTransferTx.length + transferEventTx.length + i} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h3 className="text-sm font-bold tracking-widest text-muted-foreground mb-2">
                TRANSMISSION LOG ({reportTx.length})
              </h3>
              {reportTx.length > 0 ? (
                <div className="space-y-2">
                  {reportTx.map((tx, i) => (
                    <TransmissionEntry key={tx.id} tx={tx} index={i} />
                  ))}
                </div>
              ) : (
                <div className="border border-border rounded-lg p-3 text-sm text-muted-foreground">
                  No individual transmissions recorded — single transmission incident
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Incident Card (list item) ──

function IncidentCard({ report, dispositions, transfers, onClick }: {
  report: OpsReport;
  dispositions: OpsDisposition[];
  transfers: PatientTransfer[];
  onClick: () => void;
}) {
  const p = report.assessment?.priority ?? report.priority;
  const col = p ? PRIORITY_COLORS[p] ?? '#888' : '#888';
  const casCount = Math.max(getCasualtyCount(report), dispositions.filter(d => d.report_id === report.id).length);
  const isClosed = report.status === 'closed';
  const hasTransfer = transfers.some(t => t.report_id === report.id);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card shadow-sm p-3 cursor-pointer hover:bg-muted/30 transition-colors mb-2 block"
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-sm font-bold" style={badgeStyle(col)}>{p ?? '—'}</span>
        {report.incident_number && (
          <span className="text-sm font-semibold px-1.5 py-0.5 rounded"
            style={{ border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
            #{report.incident_number}
          </span>
        )}
        <span className="text-sm" style={badgeStyle(isClosed ? '#888' : '#FF9500')}>
          {isClosed ? 'CLOSED' : 'ACTIVE'}
        </span>
        {(report.transmission_count ?? 1) > 1 && (
          <span className="text-sm" style={badgeStyle('#1E90FF')}>
            {report.transmission_count} TX
          </span>
        )}
        {hasTransfer && (
          <span className="text-sm" style={badgeStyle('#8B5CF6')}>XFER</span>
        )}
      </div>

      <p className="text-sm text-foreground font-semibold truncate mb-1">{getIncidentType(report)}</p>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span>📍 {getLocation(report)}</span>
        <span>{fmtTime(report.created_at ?? report.timestamp)}</span>
        {report.confirmed_at && <span>→ {fmtTime(report.confirmed_at)}</span>}
        {casCount > 0 && <span>{casCount} casualt{casCount === 1 ? 'y' : 'ies'}</span>}
        {report.session_callsign && (
          <span className="font-semibold" style={{ color: '#3DFF8C' }}>{report.session_callsign}</span>
        )}
      </div>
    </button>
  );
}

// ── Incident Type Filter Options ──

const INCIDENT_TYPE_OPTIONS = [
  'cardiac arrest',
  'rtc',
  'trauma',
  'medical',
  'fall',
  'chest pain',
  'breathing',
  'stroke',
  'overdose',
  'maternity',
];

// ── Main Component ──

export function OpsLogTab({ onSelectReport }: { onSelectReport?: (id: string) => void } = {}) {
  const { reports, transmissions, dispositions, transfers, loading, uniqueCallsigns, uniqueOperatorIds } = useOpsLog();
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [filters, setFilters] = useState<OpsFilters>({
    search: '',
    service: '',
    station: '',
    dateFrom: '',
    dateTo: '',
    outcome: '',
    incidentType: '',
    callsign: '',
    operatorId: '',
  });

  const filtered = useMemo(
    () => applyFilters(reports, dispositions, filters),
    [reports, dispositions, filters]
  );

  const updateFilter = (key: keyof OpsFilters, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val }));
  };

  const hasFilters = filters.search || filters.dateFrom || filters.dateTo || filters.outcome || filters.incidentType || filters.callsign || filters.operatorId;

  // If an incident is selected, show the detail view
  const selectedReport = selectedIncident ? reports.find(r => r.id === selectedIncident) : null;

  if (selectedReport) {
    return (
      <IncidentDetail
        report={selectedReport}
        transmissions={transmissions}
        dispositions={dispositions}
        transfers={transfers}
        onBack={() => setSelectedIncident(null)}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-lg tracking-widest">
        LOADING INCIDENT LOG...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + Filters */}
      <div className="flex-shrink-0 p-3 border-b border-border space-y-2">
        <div className="text-sm font-bold tracking-widest text-muted-foreground mb-1">
          INCIDENT LOG
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            placeholder="Search callsign, collar number, incident number, location..."
            style={{ ...inputStyle, paddingLeft: 36 }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filters.callsign}
            onChange={e => updateFilter('callsign', e.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All callsigns</option>
            {uniqueCallsigns.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={filters.operatorId}
            onChange={e => updateFilter('operatorId', e.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All collar numbers</option>
            {uniqueOperatorIds.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            value={filters.outcome}
            onChange={e => updateFilter('outcome', e.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All outcomes</option>
            <option value="conveyed">Conveyed</option>
            <option value="see_and_treat">Discharged</option>
            <option value="see_and_refer">Referred</option>
            <option value="refused_transport">Refused</option>
            <option value="role">ROLE</option>
          </select>
          <select
            value={filters.incidentType}
            onChange={e => updateFilter('incidentType', e.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All types</option>
            {INCIDENT_TYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          <input type="date" value={filters.dateFrom} onChange={e => updateFilter('dateFrom', e.target.value)}
            style={{ ...inputStyle, width: 'auto' }} title="From date" />
          <input type="date" value={filters.dateTo} onChange={e => updateFilter('dateTo', e.target.value)}
            style={{ ...inputStyle, width: 'auto' }} title="To date" />
          {hasFilters && (
            <button
              onClick={() => setFilters({ search: '', service: '', station: '', dateFrom: '', dateTo: '', outcome: '', incidentType: '', callsign: '', operatorId: '' })}
              className="px-3 py-1.5 text-sm rounded border cursor-pointer"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-xs text-muted-foreground tracking-widest mb-2">
          {filtered.length} INCIDENT{filtered.length !== 1 ? 'S' : ''}
        </div>

        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm tracking-widest">
            NO MATCHING INCIDENTS
          </div>
        ) : (
          filtered.map(r => (
            <IncidentCard
              key={r.id}
              report={r}
              dispositions={dispositions}
              transfers={transfers}
              onClick={() => setSelectedIncident(r.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
