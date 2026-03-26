import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_DISPOSITIONS = new Set([
  "conveyed",
  "see_and_treat",
  "see_and_refer",
  "refused_transport",
  "role",
]);

function asText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function sanitizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const reportId = asText(body?.report_id, 64);
    const casualtyKey = asText(body?.casualty_key, 120);
    const casualtyLabel = asText(body?.casualty_label, 240);
    const priority = asText(body?.priority, 24);
    const disposition = asText(body?.disposition, 64);
    const closedAt = asText(body?.closed_at, 64);
    const incidentNumber = asText(body?.incident_number, 64);
    const sessionCallsign = asText(body?.session_callsign, 120);
    const trustId = asText(body?.trust_id, 64);
    const fields = sanitizeJsonObject(body?.fields);

    if (!reportId || !casualtyKey || !casualtyLabel || !priority || !disposition || !closedAt) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!ALLOWED_DISPOSITIONS.has(disposition)) {
      return new Response(
        JSON.stringify({ error: "Invalid disposition" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (Number.isNaN(Date.parse(closedAt))) {
      return new Response(
        JSON.stringify({ error: "Invalid closed_at timestamp" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (trustId) {
      const { data: trust } = await supabase
        .from("trusts")
        .select("id")
        .eq("id", trustId)
        .eq("active", true)
        .maybeSingle();

      if (!trust) {
        return new Response(
          JSON.stringify({ error: "Invalid trust" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: report } = await supabase
      .from("herald_reports")
      .select("id")
      .eq("id", reportId)
      .maybeSingle();

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: upsertError } = await supabase
      .from("casualty_dispositions")
      .upsert(
        {
          report_id: reportId,
          casualty_key: casualtyKey,
          casualty_label: casualtyLabel,
          priority,
          disposition,
          fields,
          incident_number: incidentNumber,
          closed_at: closedAt,
          session_callsign: sessionCallsign,
          trust_id: trustId,
        },
        { onConflict: "report_id,casualty_key" },
      );

    if (upsertError) {
      console.error("sync-disposition upsert error", upsertError);
      return new Response(
        JSON.stringify({ error: "Failed to save disposition" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const conveyedHospital =
      disposition === "conveyed" && typeof fields.receiving_hospital === "string"
        ? fields.receiving_hospital.trim()
        : "";

    // Build report update payload
    const reportUpdate: Record<string, unknown> = {};
    if (conveyedHospital) {
      reportUpdate.receiving_hospital = conveyedHospital;
    }

    // Check if all casualties for this report now have dispositions
    // by comparing disposed count against the report's casualty count from assessment
    const { data: reportRow } = await supabase
      .from("herald_reports")
      .select("assessment, status")
      .eq("id", reportId)
      .maybeSingle();

    if (reportRow) {
      const assessment = reportRow.assessment as Record<string, unknown> | null;
      const atmist = (assessment?.atmist ?? {}) as Record<string, unknown>;
      const casualtyCount = Math.max(1, Object.keys(atmist).length);

      const { count: disposedCount } = await supabase
        .from("casualty_dispositions")
        .select("id", { count: "exact", head: true })
        .eq("report_id", reportId);

      if (disposedCount != null && disposedCount >= casualtyCount && reportRow.status !== "closed") {
        reportUpdate.status = "closed";
      }
    }

    if (Object.keys(reportUpdate).length > 0) {
      const { error: reportUpdateError } = await supabase
        .from("herald_reports")
        .update(reportUpdate)
        .eq("id", reportId);

      if (reportUpdateError) {
        console.error("sync-disposition report update error", reportUpdateError);
      }
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("sync-disposition error", error);
    return new Response(
      JSON.stringify({ error: "Disposition sync failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});