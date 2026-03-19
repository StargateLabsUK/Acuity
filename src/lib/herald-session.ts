export interface HeraldSession {
  service: string;
  service_emoji: string;
  callsign: string;
  operator_id: string | null;
  station: string | null;
  session_date: string;
  shift_started: string;
}

const SESSION_KEY = 'herald_session';

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
