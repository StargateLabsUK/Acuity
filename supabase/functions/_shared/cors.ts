/**
 * Shared CORS configuration for all edge functions.
 * Frameworks: CE+ (Firewall/Boundary), ISO 27001 (A.13), NCSC (P11)
 *
 * Only allows requests from known Herald origins.
 */

const ALLOWED_ORIGINS = [
  "https://herald.network",
  "https://www.herald.network",
  "https://heraldcomms.vercel.app",
  "https://heraldcomms-etnm7t0sj-ayra1.vercel.app",
  "https://heraldcomms.lovable.app",
];

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Vary": "Origin",
  };
}

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }
  return null;
}
