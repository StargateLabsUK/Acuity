import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { shift_id, trust_id, callsign, session_date } = await req.json();

    if (!shift_id && !callsign) {
      return new Response(
        JSON.stringify({ error: "shift_id or callsign required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Build query for reports
    let query = supabase
      .from("herald_reports")
      .select("*")
      .eq("status", "active")
      .order("latest_transmission_at", { ascending: false, nullsFirst: false });

    if (shift_id && callsign && session_date) {
      const todayStart = session_date + "T00:00:00.000Z";
      query = query.or(
        `shift_id.eq.${shift_id},and(session_callsign.eq.${callsign},created_at.gte.${todayStart})`
      );
    } else if (shift_id) {
      query = query.eq("shift_id", shift_id);
    } else {
      const todayStart = (session_date || new Date().toISOString().slice(0, 10)) + "T00:00:00.000Z";
      query = query.eq("session_callsign", callsign).gte("created_at", todayStart);
    }

    if (trust_id) {
      query = query.eq("trust_id", trust_id);
    }

    const { data: reports, error: reportsErr } = await query;

    if (reportsErr) {
      console.error("Reports fetch error:", reportsErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch reports" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch dispositions for same scope
    let dispQuery = supabase
      .from("casualty_dispositions")
      .select("*");

    if (callsign && session_date) {
      const todayStart = session_date + "T00:00:00.000Z";
      dispQuery = dispQuery
        .eq("session_callsign", callsign)
        .gte("created_at", todayStart);
    } else if (callsign) {
      dispQuery = dispQuery.eq("session_callsign", callsign);
    }

    if (trust_id) {
      dispQuery = dispQuery.eq("trust_id", trust_id);
    }

    const { data: dispositions } = await dispQuery;

    return new Response(
      JSON.stringify({ reports: reports ?? [], dispositions: dispositions ?? [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("fetch-incidents error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
