/** Trust PIN cache — stores validated trust info for 30 days */

const TRUST_CACHE_KEY = 'herald_trust';
const TRUST_CACHE_DAYS = 30;

export interface CachedTrust {
  trust_id: string;
  trust_name: string;
  trust_slug: string;
  cached_at: string;
}

export function getCachedTrust(): CachedTrust | null {
  try {
    const raw = localStorage.getItem(TRUST_CACHE_KEY);
    if (!raw) return null;
    const cached: CachedTrust = JSON.parse(raw);
    const cachedDate = new Date(cached.cached_at);
    const now = new Date();
    const diffDays = (now.getTime() - cachedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > TRUST_CACHE_DAYS) {
      localStorage.removeItem(TRUST_CACHE_KEY);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

export function setCachedTrust(trust: Omit<CachedTrust, 'cached_at'>): void {
  const entry: CachedTrust = { ...trust, cached_at: new Date().toISOString() };
  localStorage.setItem(TRUST_CACHE_KEY, JSON.stringify(entry));
}

export function clearCachedTrust(): void {
  localStorage.removeItem(TRUST_CACHE_KEY);
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export async function validateTrustPin(pin: string): Promise<{ trust_id: string; trust_name: string; trust_slug: string } | { error: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-trust-pin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json();
  if (!res.ok) return { error: data.error || 'Validation failed' };
  return data;
}
