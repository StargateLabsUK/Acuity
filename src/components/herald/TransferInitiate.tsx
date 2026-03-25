import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PRIORITY_COLORS } from '@/lib/herald-types';
import { initiateTransfer } from '@/lib/transfer-types';
import type { HeraldSession } from '@/lib/herald-session';

interface ActiveShift {
  id: string;
  callsign: string;
  service: string | null;
  vehicle_type: string | null;
  can_transport: boolean | null;
}

interface Props {
  session: HeraldSession;
  incident: {
    id: string;
    incident_number: string | null;
    assessment: any;
  };
  casualty: {
    key: string;
    label: string;
    priority: string;
    atmist: Record<string, string>;
    actionItems: any[];
  };
  onBack: () => void;
  onTransferInitiated: () => void;
}

export function TransferInitiate({ session, incident, casualty, onBack, onTransferInitiated }: Props) {
  const [shifts, setShifts] = useState<ActiveShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ActiveShift | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const col = PRIORITY_COLORS[casualty.priority] ?? '#34C759';

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('shifts')
      .select('id, callsign, service, vehicle_type, can_transport')
      .is('ended_at', null)
      .order('created_at', { ascending: false });

    // Filter to same trust if session has one
    if (session.trust_id) {
      query = query.eq('trust_id', session.trust_id);
    }

    const { data } = await query;

    if (data) {
      // Filter out our own callsign
      setShifts(data.filter((s: any) => s.callsign !== session.callsign) as ActiveShift[]);
    }
    setLoading(false);
  }, [session.callsign]);

  useEffect(() => { fetchShifts(); }, [fetchShifts]);

  const handleInitiate = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);

    // Build clinical snapshot from current casualty data
    const snapshot: Record<string, unknown> = {
      casualty_key: casualty.key,
      casualty_label: casualty.label,
      priority: casualty.priority,
      atmist: casualty.atmist,
      action_items: casualty.actionItems.map(i => typeof i === 'object' ? i : { text: i }),
      assessment_snapshot: incident.assessment ?? null,
      snapshot_timestamp: new Date().toISOString(),
    };

    const result = await initiateTransfer({
      report_id: incident.id,
      casualty_key: casualty.key,
      casualty_label: casualty.label,
      priority: casualty.priority,
      from_callsign: session.callsign,
      from_operator_id: session.operator_id,
      from_shift_id: session.shift_id ?? null,
      to_callsign: selected.callsign,
      to_shift_id: selected.id,
      clinical_snapshot: snapshot,
      trust_id: session.trust_id ?? null,
    });

    setSubmitting(false);

    if (result.ok) {
      setSuccess(true);
      setTimeout(() => onTransferInitiated(), 1500);
    } else {
      setError(result.error ?? 'Failed to initiate transfer');
    }
  }, [selected, casualty, incident, session, onTransferInitiated]);

  if (success) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="text-4xl mb-4">✓</div>
        <p className="text-lg font-bold tracking-[0.15em] mb-2" style={{ color: '#1E90FF' }}>
          TRANSFER INITIATED
        </p>
        <p className="text-lg text-foreground opacity-70 text-center">
          Waiting for {selected?.callsign} to accept
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <button onClick={onBack} className="flex items-center gap-2 px-3 py-2 text-lg text-primary bg-transparent border-b border-border">
        <ArrowLeft size={20} /> Back
      </button>

      <div className="flex-1 overflow-auto px-3 py-3">
        {/* Patient being transferred */}
        <div className="rounded-lg p-3 mb-4" style={{ background: `${col}1A`, borderLeft: `4px solid ${col}` }}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold" style={{ color: col }}>{casualty.priority}</span>
          </div>
          <p className="text-lg text-foreground font-medium">{casualty.label}</p>
          <p className="text-lg text-foreground opacity-60 mt-1">
            Transfer from {session.callsign}
          </p>
        </div>

        {/* Active crews */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-lg font-bold tracking-[0.2em]" style={{ color: '#1E90FF' }}>
            SELECT RECEIVING CREW
          </p>
          <button onClick={fetchShifts} className="p-1.5 rounded-lg border border-border text-foreground opacity-60">
            <RefreshCw size={16} />
          </button>
        </div>

        {loading ? (
          <p className="text-lg text-foreground opacity-50 py-4">Loading active shifts...</p>
        ) : shifts.length === 0 ? (
          <div className="rounded-lg border border-border p-4 text-center">
            <p className="text-lg text-foreground opacity-60">No other active crews found</p>
            <p className="text-lg text-foreground opacity-40 mt-1">Other crews must have an active shift to receive transfers</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 mb-4">
            {shifts.map(s => {
              const isSelected = selected?.id === s.id;
              return (
                <button key={s.id} onClick={() => setSelected(s)}
                  className="w-full text-left rounded-lg border p-3 transition-colors"
                  style={{
                    borderColor: isSelected ? '#1E90FF' : 'hsl(var(--border))',
                    background: isSelected ? 'rgba(30,144,255,0.08)' : 'transparent',
                  }}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold" style={{ color: isSelected ? '#1E90FF' : '#3DFF8C' }}>
                      {s.callsign}
                    </span>
                    <span className="text-lg text-foreground opacity-60">{s.service ?? ''}</span>
                    {s.vehicle_type && (
                      <span className="text-lg font-bold rounded-sm px-1.5 py-0.5 ml-auto"
                        style={{
                          color: s.can_transport ? '#3DFF8C' : '#FF9500',
                          border: `1px solid ${s.can_transport ? 'rgba(61,255,140,0.2)' : 'rgba(255,149,0,0.3)'}`,
                        }}>
                        {s.vehicle_type.toUpperCase()}
                      </span>
                    )}
                    {isSelected && (
                      <span className="text-lg" style={{ color: '#1E90FF' }}>✓</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="rounded-lg p-3 mb-4" style={{ background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.3)' }}>
            <p className="text-lg" style={{ color: '#FF3B30' }}>{error}</p>
          </div>
        )}
      </div>

      {/* Bottom action */}
      {selected && (
        <div className="px-3 py-3 border-t border-border" style={{ background: '#1A1E24' }}>
          {confirming ? (
            <div className="p-3 rounded-lg" style={{ border: '2px solid #1E90FF', background: 'rgba(30,144,255,0.08)' }}>
              <p className="text-lg font-bold mb-1" style={{ color: '#1E90FF' }}>Transfer this patient?</p>
              <p className="text-lg text-foreground opacity-70 mb-1">
                {casualty.label}
              </p>
              <p className="text-lg text-foreground opacity-70 mb-3">
                {session.callsign} <ArrowRight size={16} className="inline" /> {selected.callsign}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirming(false)} disabled={submitting}
                  className="flex-1 py-2.5 text-lg font-bold border border-border rounded-lg bg-transparent text-foreground">
                  CANCEL
                </button>
                <button onClick={handleInitiate} disabled={submitting}
                  className="flex-1 py-2.5 text-lg font-bold rounded-lg"
                  style={{ background: 'rgba(30,144,255,0.15)', border: '2px solid #1E90FF', color: '#1E90FF' }}>
                  {submitting ? 'SENDING...' : 'CONFIRM TRANSFER'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)}
              className="w-full py-3 text-lg font-bold rounded-lg tracking-wide"
              style={{ background: 'rgba(30,144,255,0.12)', border: '2px solid #1E90FF', color: '#1E90FF' }}>
              TRANSFER TO {selected.callsign}
            </button>
          )}
        </div>
      )}
    </div>
  );
}