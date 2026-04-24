import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { recomputeCrewStatus } from "../_shared/lifecycle.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (isRateLimited(req, { name: "fetch-incidents", maxRequests: 30, windowMs: 60_000 })) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

    // Resolve lifecycle guard for this shift first.
    if (shift_id) {
      await recomputeCrewStatus(supabase, shift_id);
    }

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

    let { data: reports, error: reportsErr } = await query;

    if (reportsErr) {
      console.error("Reports fetch error:", reportsErr);
      return new Response(
        JSON.stringify({ error: "Failed to fetch reports" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch accepted transfers for this crew (used for filtering + per-casualty scope)
    let acceptedTransfersForCrew: any[] = [];
    if (callsign) {
      const { data: transfers } = await supabase
        .from("patient_transfers")
        .select("id, report_id, casualty_key, casualty_label, priority, from_callsign, to_callsign, clinical_snapshot, handover_notes, accepted_at, status")
        .eq("to_callsign", callsign)
        .eq("status", "accepted");
      acceptedTransfersForCrew = transfers ?? [];
    }

    // Also fetch incidents where this crew has accepted patient transfers
    if (callsign) {
      const { data: acceptedTransfers } = await supabase
        .from("patient_transfers")
        .select("report_id")
        .eq("to_callsign", callsign)
        .eq("status", "accepted");
      if (acceptedTransfers?.length) {
        const ids = [...new Set(acceptedTransfers.map(t => t.report_id))];
        // Fetch any reports not already in results
        const existingIds = new Set((reports ?? []).map(r => r.id));
        const missingIds = ids.filter(id => !existingIds.has(id));
        if (missingIds.length > 0) {
          const { data: transferReports } = await supabase
            .from("herald_reports")
            .select("*")
            .in("id", missingIds)
            .eq("status", "active");
          if (transferReports?.length) {
            (reports ?? []).push(...transferReports);
          }
        }
      }
    }

    // Strict lifecycle: if the shift already owns an active incident, do not
    // leak additional non-owned active incidents into the crew workflow.
    if (shift_id) {
      const { data: shift } = await supabase
        .from("shifts")
        .select("active_report_id")
        .eq("id", shift_id)
        .maybeSingle();

      const ownedReportId = shift?.active_report_id ?? null;
      if (ownedReportId) {
        const ownSet = new Set([ownedReportId]);
        const acceptedSet = new Set(
          (acceptedTransfersForCrew ?? []).map((t: any) => t.report_id).filter(Boolean),
        );
        const allowed = new Set<string>([...ownSet, ...acceptedSet]);
        if ((reports ?? []).length > 0) {
          reports = (reports ?? []).filter((r: any) => allowed.has(r.id));
        }
      }
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
      JSON.stringify({ reports: reports ?? [], dispositions: dispositions ?? [], accepted_transfers: acceptedTransfersForCrew }),
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
