import { readEncrypted, writeEncrypted, removeEncrypted } from './crypto';

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

export async function getSession(): Promise<HeraldSession | null> {
  try {
    const session = await readEncrypted<HeraldSession>(SESSION_KEY);
    if (!session) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (session.session_date !== today) {
      removeEncrypted(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function saveSession(session: HeraldSession): Promise<void> {
  await writeEncrypted(SESSION_KEY, session);
}

export function clearSession(): void {
  removeEncrypted(SESSION_KEY);
}

export async function getShiftId(): Promise<string | undefined> {
  return (await getSession())?.shift_id;
}

export async function getTrustId(): Promise<string | undefined> {
  return (await getSession())?.trust_id;
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
    const url = `${SUPABASE_URL}/functions/v1/link-shift`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'redeem', code, operator_id: operator_id ?? null }),
    });
    if (!res.ok) {
      let errMsg = `Server error (${res.status})`;
      try {
        const data = await res.json();
        errMsg = data.error ?? errMsg;
      } catch { /* non-JSON response */ }
      return { error: errMsg };
    }
    const data = await res.json();
    return data;
  } catch (e: any) {
    console.error('redeemLinkCode failed:', e);
    return { error: e?.message ?? 'Network error — check your connection' };
  }
}

/** Leave a shift without ending it (handheld only) */
export async function leaveShiftRemote(
  shiftId: string,
  operatorId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/link-shift`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'leave', shift_id: shiftId, operator_id: operatorId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
