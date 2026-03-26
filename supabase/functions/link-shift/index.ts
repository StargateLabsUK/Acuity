import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function handleCrewLink(supabase: any, codeRow: any, operator_id: string | null, corsHeaders: Record<string, string>) {
  const opId = operator_id ?? null;

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
        .update({ left_at: null, used_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      // New crew member: insert a tracking row
      await supabase.from("shift_link_codes").insert({
        shift_id: codeRow.shift_id,
        code: codeRow.code,
        trust_id: codeRow.trust_id,
        session_data: codeRow.session_data,
        expires_at: codeRow.expires_at,
        used_at: new Date().toISOString(),
        operator_id: opId,
      });
    }
  }

  return new Response(
    JSON.stringify({ session_data: codeRow.session_data }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { action, shift_id, session_data, trust_id, code, operator_id } = await req.json();

    if (action === "generate") {
      if (!shift_id || !session_data) {
        return new Response(
          JSON.stringify({ error: "shift_id and session_data required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
          trust_id: trust_id ?? null,
          session_data,
          expires_at: expiresAt,
        });

        if (!error) {
          return new Response(
            JSON.stringify({ code: linkCode, expires_at: expiresAt }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Unique constraint violation — retry with new code
        if (error.code === "23505") continue;

        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Could not generate unique code" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "redeem") {
      if (!code) {
        return new Response(
          JSON.stringify({ error: "code required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
          return new Response(
            JSON.stringify({ error: "Invalid or expired code" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Use this row's session_data for the response, then handle crew tracking below
        return await handleCrewLink(supabase, anyRow, operator_id, corsHeaders);
      }

      // Mark master as used
      if (!data.used_at) {
        await supabase
          .from("shift_link_codes")
          .update({ used_at: new Date().toISOString() })
          .eq("id", data.id);
      }

      return await handleCrewLink(supabase, data, operator_id, corsHeaders);
    }

    if (action === "leave") {
      if (!shift_id || !operator_id) {
        return new Response(
          JSON.stringify({ error: "shift_id and operator_id required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase
        .from("shift_link_codes")
        .update({ left_at: new Date().toISOString() })
        .eq("shift_id", shift_id)
        .eq("operator_id", operator_id)
        .not("used_at", "is", null)
        .is("left_at", null);

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
