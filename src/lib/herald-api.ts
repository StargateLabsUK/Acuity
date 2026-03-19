const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

export async function transcribeAudio(base64Audio: string, mimeType?: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/transcribe`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio: base64Audio, mimeType: mimeType || 'audio/webm' }),
  });
  if (!res.ok) throw new Error('Transcription failed');
  const data = await res.json();
  return data.transcript;
}

export async function assessTranscript(transcript: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/assess`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw new Error('Assessment failed');
  return res.json();
}

export async function syncReport(report: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/herald_reports`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(report),
  });
  return res.status === 201;
}
