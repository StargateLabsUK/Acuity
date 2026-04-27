import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PRIORITY_COLORS } from '@/lib/herald-types';
import { acceptTransfer, declineTransfer } from '@/lib/transfer-types';
import type { PatientTransfer } from '@/lib/transfer-types';
import type { HeraldSession } from '@/lib/herald-session';

function getTime(ts: string | null) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getUTCHours().toString().padStart(2, '0') + ':' +
    d.getUTCMinutes().toString().padStart(2, '0') + 'Z';
}

interface Props {
  session: HeraldSession;
  onTransferAccepted: () => void;
}

export function PendingTransfers({ session, onTransferAccepted }: Props) {
  const [transfers, setTransfers] = useState<PatientTransfer[]>([]);
  const [outgoing, setOutgoing] = useState<PatientTransfer[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const fetchTransfers = useCallback(async () => {
    const todayStart = session.session_date + 'T00:00:00.000Z';

    const [inRes, outRes] = await Promise.all([
      supabase
        .from('patient_transfers')
        .select('*')
        .eq('to_callsign', session.callsign)
        .eq('status', 'pending')
        .gte('created_at', todayStart)
        .order('initiated_at', { ascending: false }),
      supabase
        .from('patient_transfers')
        .select('*')
        .eq('from_callsign', session.callsign)
        .eq('status', 'pending')
        .gte('created_at', todayStart)
        .order('initiated_at', { ascending: false }),
    ]);

    if (inRes.data) setTransfers(inRes.data as unknown as PatientTransfer[]);
    if (outRes.data) setOutgoing(outRes.data as unknown as PatientTransfer[]);
  }, [session.callsign, session.session_date]);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  useEffect(() => {
    const id = window.setInterval(fetchTransfers, 3000);
    return () => window.clearInterval(id);
  }, [fetchTransfers]);

  const handleAccept = useCallback(async (t: PatientTransfer) => {
    setProcessing(t.id);
    const result = await acceptTransfer(t.id, session.callsign);
    setProcessing(null);
    if (result.ok) {
      fetchTransfers();
      onTransferAccepted();
    }
  }, [session.callsign, fetchTransfers, onTransferAccepted]);

  const handleDecline = useCallback(async (t: PatientTransfer) => {
    setProcessing(t.id);
    await declineTransfer(t.id, session.callsign, declineReason || undefined);
    setProcessing(null);
    setDeclineId(null);
    setDeclineReason('');
    fetchTransfers();
  }, [session.callsign, declineReason, fetchTransfers]);

  if (transfers.length === 0 && outgoing.length === 0) return null;

  return (
    <div className="mb-4">
      {/* Incoming transfers */}
      {transfers.length > 0 && (
        <>
          <p className="text-lg font-bold tracking-[0.2em] mb-2" style={{ color: '#1E90FF' }}>
            INCOMING TRANSFERS ({transfers.length})
          </p>
          {transfers.map(t => {
            const col = PRIORITY_COLORS[t.priority] ?? '#34C759';
            const isProcessing = processing === t.id;
            const isDeclining = declineId === t.id;

            return (
              <div key={t.id} className="mb-2 rounded-lg border overflow-hidden"
                style={{ borderColor: '#1E90FF', background: 'rgba(30,144,255,0.06)' }}>
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-lg font-bold rounded-sm px-2 py-0.5"
                      style={{ color: col, border: `1px solid ${col}66`, background: `${col}1A` }}>
                      {t.priority}
                    </span>
                    <span className="text-lg text-foreground font-medium flex-1 min-w-0 truncate">
                      {t.casualty_label}
                    </span>
                    {t.patient_id && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        PID {t.patient_id.slice(0, 8)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-lg text-foreground opacity-70 mb-2">
                    <span className="font-bold" style={{ color: '#059669' }}>{t.from_callsign}</span>
                    <ArrowRight size={16} />
                    <span className="font-bold" style={{ color: '#1E90FF' }}>{session.callsign}</span>
                    <span className="ml-auto opacity-50">{getTime(t.initiated_at)}</span>
                  </div>

                  {/* ATMIST preview from snapshot */}
                  {t.clinical_snapshot?.atmist && (
                    <div className="rounded-lg border border-border bg-card p-2 mb-3">
                      {['I', 'M', 'S'].map(k => {
                        const val = (t.clinical_snapshot.atmist as any)?.[k];
                        if (!val || val === '—') return null;
                        return (
                          <p key={k} className="text-lg text-foreground opacity-70 truncate">
                            <span className="font-bold" style={{ color: '#1E90FF' }}>{k}: </span>
                            {val}
                          </p>
                        );
                      })}
                    </div>
                  )}

                  {/* Handover notes from sending crew (optional freetext) */}
                  {t.handover_notes && (
                    <div className="rounded-lg border border-border bg-card p-2 mb-3">
                      <p className="text-lg font-bold tracking-[0.15em] mb-1" style={{ color: '#1E90FF' }}>
                        HANDOVER NOTES
                      </p>
                      <p className="text-lg text-foreground opacity-80 whitespace-pre-wrap break-words">
                        {t.handover_notes}
                      </p>
                    </div>
                  )}

                  {isDeclining ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={declineReason}
                        onChange={e => setDeclineReason(e.target.value)}
                        placeholder="Reason for declining (optional)"
                        rows={2}
                        className="w-full text-lg px-3 py-2 rounded-lg border border-border bg-card text-foreground resize-y"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => { setDeclineId(null); setDeclineReason(''); }}
                          className="flex-1 py-2 text-lg font-bold border border-border rounded-lg bg-transparent text-foreground">
                          CANCEL
                        </button>
                        <button onClick={() => handleDecline(t)} disabled={isProcessing}
                          className="flex-1 py-2 text-lg font-bold rounded-lg"
                          style={{ background: 'rgba(255,59,48,0.1)', border: '2px solid #FF3B30', color: '#FF3B30' }}>
                          {isProcessing ? 'DECLINING...' : 'CONFIRM DECLINE'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setDeclineId(t.id)} disabled={isProcessing}
                        className="flex-1 py-2.5 text-lg font-bold rounded-lg flex items-center justify-center gap-2"
                        style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)', color: '#FF3B30' }}>
                        <X size={18} /> DECLINE
                      </button>
                      <button onClick={() => handleAccept(t)} disabled={isProcessing}
                        className="flex-1 py-2.5 text-lg font-bold rounded-lg flex items-center justify-center gap-2"
                        style={{ background: 'rgba(30,144,255,0.12)', border: '2px solid #1E90FF', color: '#1E90FF' }}>
                        <Check size={18} /> {isProcessing ? 'ACCEPTING...' : 'ACCEPT'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Outgoing pending transfers */}
      {outgoing.length > 0 && (
        <>
          <p className="text-lg font-bold tracking-[0.2em] mb-2 mt-3" style={{ color: '#FF9500' }}>
            AWAITING ACCEPTANCE ({outgoing.length})
          </p>
          {outgoing.map(t => {
            const col = PRIORITY_COLORS[t.priority] ?? '#34C759';
            return (
              <div key={t.id} className="mb-2 rounded-lg border overflow-hidden"
                style={{ borderColor: '#FF9500', background: 'rgba(255,149,0,0.06)' }}>
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-bold rounded-sm px-2 py-0.5"
                      style={{ color: col, border: `1px solid ${col}66`, background: `${col}1A` }}>
                      {t.priority}
                    </span>
                    <span className="text-lg text-foreground font-medium truncate">{t.casualty_label}</span>
                    {t.patient_id && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                        PID {t.patient_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-lg text-foreground opacity-60">
                    <span>Transferring to</span>
                    <span className="font-bold" style={{ color: '#1E90FF' }}>{t.to_callsign}</span>
                    <span className="ml-auto opacity-50">{getTime(t.initiated_at)}</span>
                  </div>
                  <p className="text-lg mt-1" style={{ color: '#FF9500' }}>
                    ⏳ Awaiting acceptance
                  </p>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}