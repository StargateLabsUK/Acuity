export interface HeraldSession {
  service: string;
  service_emoji: string;
  callsign: string;
  operator_id: string | null;
  station: string | null;
  session_date: string;
  shift_started: string;
  shift_id?: string;
  vehicle_type?: string;
  can_transport?: boolean;
  critical_care?: boolean;
  trust_id?: string;
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

export function getTrustId(): string | undefined {
  return getSession()?.trust_id;
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
        vehicle_type: session.vehicle_type ?? null,
        can_transport: session.can_transport ?? true,
        critical_care: session.critical_care ?? false,
        trust_id: session.trust_id ?? null,
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

/** Generate a 6-digit link code for a shift */
export async function generateLinkCode(
  session: HeraldSession,
): Promise<{ code: string; expires_at: string } | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/link-shift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'generate',
        shift_id: session.shift_id,
        trust_id: session.trust_id ?? null,
        session_data: session,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Redeem a 6-digit link code, returns the session data */
export async function redeemLinkCode(
  code: string,
  operator_id?: string,
): Promise<{ session_data: HeraldSession } | { error: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/link-shift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'redeem', code, operator_id: operator_id ?? null }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? 'Invalid code' };
    return data;
  } catch {
    return { error: 'Network error' };
  }
}
