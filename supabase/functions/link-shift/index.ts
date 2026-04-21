import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";

// ── Rate limiting for code redemption (CE+, ISO 27001 A.9.4) ──
const redeemAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_REDEEM_ATTEMPTS = 10;
const REDEEM_WINDOW_MS = 60_000; // 1 minute

function isRedeemRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = redeemAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    redeemAttempts.set(ip, { count: 1, resetAt: now + REDEEM_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_REDEEM_ATTEMPTS;
}

// ── Per-code failed attempt tracking (lockout after 5 failures) ──
const codeFailures = new Map<string, { count: number; lockedUntil: number }>();
const MAX_CODE_FAILURES = 5;
const CODE_LOCKOUT_MS = 15 * 60_000; // 15 minutes

function isCodeLocked(code: string): boolean {
  const entry = codeFailures.get(code);
  if (!entry) return false;
  if (Date.now() > entry.lockedUntil) {
    codeFailures.delete(code);
    return false;
  }
  return true;
}

function recordCodeFailure(code: string): void {
  const entry = codeFailures.get(code) ?? { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_CODE_FAILURES) {
    entry.lockedUntil = Date.now() + CODE_LOCKOUT_MS;
  }
  codeFailures.set(code, entry);
}

function clearCodeFailures(code: string): void {
  codeFailures.delete(code);
}

// ── Cryptographically secure random code (CE+, ISO 27001 A.10) ──
function randomCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  // Generate 6-digit code: 100000–999999
  return String(100000 + (arr[0] % 900000));
}

// ── Input validation ──
const OPERATOR_ID_PATTERN = /^[a-zA-Z0-9\-_ ]{1,30}$/;

function validateOperatorId(opId: string | null): boolean {
  if (!opId) return true; // optional field
  return OPERATOR_ID_PATTERN.test(opId);
}

async function handleCrewLink(
  supabase: any,
  codeRow: any,
  operator_id: string | null,
  corsHeaders: Record<string, string>,
) {
  const opId = operator_id ?? null;
  const now = new Date().toISOString();

  if (opId) {
    // Check if this operator already has a row for this shift
    const { data: existing } = await supabase
      .from("shift_link_codes")
      .select("id")
      .eq("shift_id", codeRow.shift_id)
      .eq("operator_id", opId)
      .limit(1)
      .single();

    if (existing) {
      // Rejoin: clear left_at
      await supabase
        .from("shift_link_codes")
        .update({ left_at: null, used_at: now })
        .eq("id", existing.id);
    } else {
      // New crew member: insert a tracking row
      await supabase.from("shift_link_codes").insert({
        shift_id: codeRow.shift_id,
        code: codeRow.code,
        trust_id: codeRow.trust_id,
        session_data: codeRow.session_data,
        expires_at: codeRow.expires_at,
        used_at: now,
        operator_id: opId,
      });
    }
  }

  await supabase.from("audit_log").insert({
    action: "shift_link_redeemed",
    trust_id: codeRow.trust_id ?? null,
    details: {
      shift_id: codeRow.shift_id,
      operator_id: opId,
      code: codeRow.code,
      redeemed_at: now,
    },
  });

  return new Response(
    JSON.stringify({ session_data: codeRow.session_data }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { action, shift_id, session_data, trust_id, code, operator_id } = await req.json();

    if (action === "generate") {
      if (!shift_id || !session_data) {
        return new Response(
          JSON.stringify({ error: "shift_id and session_data required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: shift, error: shiftError } = await supabase
        .from("shifts")
        .select("id, ended_at, trust_id")
        .eq("id", shift_id)
        .maybeSingle();

      if (shiftError || !shift) {
        return new Response(
          JSON.stringify({ error: "Shift not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (shift.ended_at) {
        return new Response(
          JSON.stringify({ error: "Shift is not active" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Check for existing active code for this shift
      const { data: existing } = await supabase
        .from("shift_link_codes")
        .select("code, expires_at")
        .eq("shift_id", shift_id)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (existing) {
        return new Response(
          JSON.stringify({ code: existing.code, expires_at: existing.expires_at }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Try up to 5 times to generate a unique code
      let linkCode = "";
      for (let i = 0; i < 5; i++) {
        linkCode = randomCode();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const { error } = await supabase.from("shift_link_codes").insert({
          shift_id,
          code: linkCode,
          trust_id: shift.trust_id ?? trust_id ?? null,
          session_data,
          expires_at: expiresAt,
        });

        if (!error) {
          return new Response(
            JSON.stringify({ code: linkCode, expires_at: expiresAt }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Unique constraint violation — retry with new code
        if (error.code === "23505") continue;

        return new Response(
          JSON.stringify({ error: "Failed to generate code" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ error: "Could not generate unique code" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "redeem") {
      if (!code || typeof code !== "string" || code.length !== 6) {
        return new Response(
          JSON.stringify({ error: "Valid 6-digit code required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Validate operator_id format
      if (operator_id && !validateOperatorId(operator_id)) {
        return new Response(
          JSON.stringify({ error: "Invalid operator ID format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Rate limiting by IP
      const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      if (isRedeemRateLimited(clientIp)) {
        return new Response(
          JSON.stringify({ error: "Too many attempts — try again later" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Per-code lockout check
      if (isCodeLocked(code)) {
        return new Response(
          JSON.stringify({ error: "Code temporarily locked — too many failed attempts" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Find the master code row (non-expired, any used_at state)
      const { data, error } = await supabase
        .from("shift_link_codes")
        .select("*")
        .eq("code", code)
        .is("operator_id", null)
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .single();

      if (error || !data) {
        // Also try finding any row with this code (already redeemed master)
        const { data: anyRow, error: anyErr } = await supabase
          .from("shift_link_codes")
          .select("*")
          .eq("code", code)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: true })
          .limit(1)
          .single();

        if (anyErr || !anyRow) {
          recordCodeFailure(code);
          return new Response(
            JSON.stringify({ error: "Invalid or expired code" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        clearCodeFailures(code);
        return await handleCrewLink(supabase, anyRow, operator_id, corsHeaders);
      }

      // Mark master as used
      if (!data.used_at) {
        await supabase
          .from("shift_link_codes")
          .update({ used_at: new Date().toISOString() })
          .eq("id", data.id);
      }

      clearCodeFailures(code);
      return await handleCrewLink(supabase, data, operator_id, corsHeaders);
    }

    if (action === "leave") {
      if (!shift_id || !operator_id) {
        return new Response(
          JSON.stringify({ error: "shift_id and operator_id required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await supabase
        .from("shift_link_codes")
        .update({ left_at: new Date().toISOString() })
        .eq("shift_id", shift_id)
        .eq("operator_id", operator_id)
        .not("used_at", "is", null)
        .is("left_at", null);

      const { data: shift } = await supabase
        .from("shifts")
        .select("trust_id")
        .eq("id", shift_id)
        .maybeSingle();

      await supabase.from("audit_log").insert({
        action: "shift_link_left",
        trust_id: shift?.trust_id ?? null,
        details: {
          shift_id,
          operator_id,
          left_at: new Date().toISOString(),
        },
      });

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Link operation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
