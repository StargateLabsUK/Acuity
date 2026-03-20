export interface HeraldSession {
  service: string;
  service_emoji: string;
  callsign: string;
  operator_id: string | null;
  station: string | null;
  session_date: string;
  shift_started: string;
  shift_id?: string;
}

const SESSION_KEY = 'herald_session';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

export function getSession(): HeraldSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: HeraldSession = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (session.session_date !== today) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(session: HeraldSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getShiftId(): string | undefined {
  return getSession()?.shift_id;
}

/** Start a shift in Supabase, returns the shift_id */
export async function startShiftRemote(session: HeraldSession): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-shift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'start',
        callsign: session.callsign,
        service: session.service,
        station: session.station,
        operator_id: session.operator_id,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.shift_id ?? null;
  } catch {
    return null;
  }
}

/** End a shift in Supabase */
export async function endShiftRemote(shiftId: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/sync-shift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'end', shift_id: shiftId }),
    });
  } catch {
    // silent
  }
}
