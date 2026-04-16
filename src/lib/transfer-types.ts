/** Types and API helpers for crew-to-crew patient transfers */
import { enqueue } from './offline-queue';

export interface PatientTransfer {
  id: string;
  report_id: string;
  casualty_key: string;
  casualty_label: string;
  priority: string;
  from_callsign: string;
  from_operator_id: string | null;
  from_shift_id: string | null;
  to_callsign: string;
  to_shift_id: string | null;
  initiated_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  declined_reason: string | null;
  clinical_snapshot: Record<string, unknown>;
  handover_notes: string | null;
  status: 'pending' | 'accepted' | 'declined';
  trust_id: string | null;
  created_at: string | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

export async function initiateTransfer(payload: {
  report_id: string;
  casualty_key: string;
  casualty_label: string;
  priority: string;
  from_callsign: string;
  from_operator_id?: string | null;
  from_shift_id?: string | null;
  to_callsign: string;
  to_shift_id?: string | null;
  clinical_snapshot: Record<string, unknown>;
  handover_notes?: string | null;
  trust_id?: string | null;
}): Promise<{ ok: boolean; transfer_id?: string; initiated_at?: string; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-transfer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'initiate', ...payload }),
    });
    return await res.json();
  } catch {
    await enqueue('transfer', { action: 'initiate', ...payload });
    return { ok: false, error: 'Queued for retry — you are offline' };
  }
}

export async function acceptTransfer(
  transferId: string,
  acceptingCallsign: string,
): Promise<{ ok: boolean; accepted_at?: string; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-transfer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'accept', transfer_id: transferId, accepting_callsign: acceptingCallsign }),
    });
    return await res.json();
  } catch {
    await enqueue('transfer', { action: 'accept', transfer_id: transferId, accepting_callsign: acceptingCallsign });
    return { ok: false, error: 'Queued for retry — you are offline' };
  }
}

export async function declineTransfer(
  transferId: string,
  decliningCallsign: string,
  reason?: string,
): Promise<{ ok: boolean; declined_at?: string; error?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-transfer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'decline', transfer_id: transferId, declining_callsign: decliningCallsign, reason }),
    });
    return await res.json();
  } catch {
    await enqueue('transfer', { action: 'decline', transfer_id: transferId, declining_callsign: decliningCallsign, reason });
    return { ok: false, error: 'Queued for retry — you are offline' };
  }
}