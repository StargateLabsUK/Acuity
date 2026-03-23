import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const report = await req.json();

    if (!report.id || !report.timestamp) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: id, timestamp" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const isFollowUp = !!report.follow_up_of;

    if (isFollowUp) {
      // --- FOLLOW-UP: append transmission to existing incident ---
      const parentId = report.follow_up_of;

      // Insert into incident_transmissions
      const { error: txError } = await supabase.from("incident_transmissions").insert({
        report_id: parentId,
        timestamp: report.timestamp,
        transcript: report.transcript ?? null,
        assessment: report.assessment ?? null,
        priority: report.priority ?? null,
        headline: report.headline ?? null,
        operator_id: report.session_operator_id ?? null,
        session_callsign: report.session_callsign ?? null,
      });

      if (txError) {
        console.error("Insert transmission error:", txError);
        return new Response(
          JSON.stringify({ error: txError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update parent report
      const { error: updateError } = await supabase
        .from("herald_reports")
        .update({
          priority: report.priority,
          headline: report.headline,
          assessment: report.assessment,
          latest_transmission_at: report.timestamp,
          transmission_count: undefined, // handled via increment below
        })
        .eq("id", parentId);

      if (updateError) {
        console.error("Update parent error:", updateError);
      }

      // Increment transmission_count via raw rpc or re-fetch + update
      const { data: parentData } = await supabase
        .from("herald_reports")
        .select("transmission_count")
        .eq("id", parentId)
        .single();

      if (parentData) {
        await supabase
          .from("herald_reports")
          .update({ transmission_count: (parentData.transmission_count ?? 1) + 1 })
          .eq("id", parentId);
      }

      return new Response(
        JSON.stringify({ ok: true, follow_up: true }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- NEW REPORT ---
    // Remove follow_up_of before upserting
    const { follow_up_of, ...reportData } = report;

    const { error } = await supabase.from("herald_reports").upsert(reportData, {
      onConflict: "id",
    });

    if (error) {
      console.error("Insert error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Also insert first transmission log entry
    if (reportData.incident_number) {
      await supabase.from("incident_transmissions").insert({
        report_id: reportData.id,
        timestamp: reportData.timestamp,
        transcript: reportData.transcript ?? null,
        assessment: reportData.assessment ?? null,
        priority: reportData.priority ?? null,
        headline: reportData.headline ?? null,
        operator_id: reportData.session_operator_id ?? null,
        session_callsign: reportData.session_callsign ?? null,
      });
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
