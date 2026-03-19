import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return {
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: token ? `Bearer ${token}` : `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
  };
}

export async function transcribeAudio(base64Audio: string, mimeType?: string): Promise<string> {
  const headers = await getAuthHeaders();
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
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/assess`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw new Error('Assessment failed');
  return res.json();
}

export async function syncReport(report: Record<string, unknown>): Promise<boolean | 'auth_error'> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/herald_reports`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(report),
  });
  if (res.status === 401 || res.status === 403) return 'auth_error';
  return res.status === 201;
}
