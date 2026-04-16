import { getSession } from './herald-session';
import { enqueue } from './offline-queue';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

async function getTrustId(): Promise<string | null> {
  const session = await getSession();
  return session?.trust_id || null;
}

export async function transcribeAudio(base64Audio: string, mimeType?: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio: base64Audio, mimeType: mimeType || 'audio/webm', trust_id: await getTrustId() }),
  });
  if (!res.ok) throw new Error('Transcription failed');
  const data = await res.json();
  return data.transcript;
}

export async function assessTranscript(transcript: string, context?: { vehicle_type?: string; can_transport?: boolean; existing_atmist?: Record<string, any> }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/assess`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transcript, vehicle_type: context?.vehicle_type, can_transport: context?.can_transport, existing_atmist: context?.existing_atmist, trust_id: await getTrustId() }),
  });
  if (!res.ok) throw new Error('Assessment failed');
  return res.json();
}

export async function syncReport(report: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-report`, {
    method: 'POST',
    headers,
    body: JSON.stringify(report),
  });
  return res.status === 201;
}

/** Sync report with automatic offline queueing */
export async function syncReportOrQueue(report: Record<string, unknown>): Promise<boolean> {
  if (!navigator.onLine) {
    await enqueue('sync-report', report);
    return false;
  }
  try {
    const ok = await syncReport(report);
    if (!ok) await enqueue('sync-report', report);
    return ok;
  } catch {
    await enqueue('sync-report', report);
    return false;
  }
}

export async function fetchIncidentsRemote(params: {
  shift_id?: string;
  trust_id?: string;
  callsign: string;
  session_date: string;
}): Promise<{ reports: Record<string, unknown>[]; dispositions: Record<string, unknown>[]; accepted_transfers?: Record<string, unknown>[] }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-incidents`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) return { reports: [], dispositions: [] };
    return res.json();
  } catch {
    return { reports: [], dispositions: [] };
  }
}

export async function syncDisposition(disposition: Record<string, unknown>): Promise<boolean> {
  try {
    const payload = {
      ...disposition,
      trust_id: (disposition as any)?.trust_id ?? await getTrustId(),
    };

    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-disposition`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Sync disposition error:', errText);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Sync disposition failed:', e);
    return false;
  }
}

/** Sync disposition with automatic offline queueing */
export async function syncDispositionOrQueue(disposition: Record<string, unknown>): Promise<boolean> {
  if (!navigator.onLine) {
    const payload = { ...disposition, trust_id: (disposition as any)?.trust_id ?? await getTrustId() };
    await enqueue('sync-disposition', payload);
    return false;
  }
  const ok = await syncDisposition(disposition);
  if (!ok) {
    const payload = { ...disposition, trust_id: (disposition as any)?.trust_id ?? await getTrustId() };
    await enqueue('sync-disposition', payload);
  }
  return ok;
}
