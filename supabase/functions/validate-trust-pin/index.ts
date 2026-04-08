import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "herald-salt-2026");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "$sha256$" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Rate limiting: simple in-memory tracker
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  try {
    // Rate limiting
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return new Response(JSON.stringify({ error: "Too many attempts — try again later" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { pin } = await req.json();
    if (!pin || typeof pin !== "string" || pin.length < 4 || pin.length > 20) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: trusts, error } = await supabase
      .from("trusts")
      .select("id, name, slug, active, trust_pin_hash")
      .eq("active", true);

    if (error || !trusts || trusts.length === 0) {
      return new Response(
        JSON.stringify({ error: "Trust code not recognised — check with your station manager" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pinHash = await hashPin(pin);
    let matchedTrust = null;

    for (const trust of trusts) {
      try {
        if (trust.trust_pin_hash.startsWith("$sha256$")) {
          // SHA-256 format (from admin page)
          if (trust.trust_pin_hash === pinHash) {
            matchedTrust = trust;
            break;
          }
        } else if (trust.trust_pin_hash.startsWith("$2")) {
          // Legacy bcrypt format — use pgcrypto via database function
          const { data: match } = await supabase.rpc("verify_bcrypt_pin", {
            plain_pin: pin,
            hashed_pin: trust.trust_pin_hash,
          });
          if (match === true) {
            matchedTrust = trust;
            // Upgrade to SHA-256
            await supabase.from("trusts").update({ trust_pin_hash: pinHash }).eq("id", trust.id);
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (!matchedTrust) {
      return new Response(
        JSON.stringify({ error: "Trust code not recognised — check with your station manager" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        trust_id: matchedTrust.id,
        trust_name: matchedTrust.name,
        trust_slug: matchedTrust.slug,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error: " + (e?.message || String(e)) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
