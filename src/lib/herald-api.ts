import { getSession } from './herald-session';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

function getTrustId(): string | null {
  const session = getSession();
  return session?.trust_id || null;
}

export async function transcribeAudio(base64Audio: string, mimeType?: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio: base64Audio, mimeType: mimeType || 'audio/webm', trust_id: getTrustId() }),
  });
  if (!res.ok) throw new Error('Transcription failed');
  const data = await res.json();
  return data.transcript;
}

export async function assessTranscript(transcript: string, context?: { vehicle_type?: string; can_transport?: boolean }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/assess`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transcript, vehicle_type: context?.vehicle_type, can_transport: context?.can_transport, trust_id: getTrustId() }),
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

export async function syncDisposition(disposition: Record<string, unknown>): Promise<boolean> {
  try {
    const payload = {
      ...disposition,
      trust_id: (disposition as any)?.trust_id ?? getTrustId(),
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
