import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import {
  evaluateAndCloseReportIfFinalized,
  recomputeCrewStatus,
} from "../_shared/lifecycle.ts";

const ALLOWED_DISPOSITIONS = new Set([
  "conveyed",
  "see_and_treat",
  "see_and_refer",
  "refused_transport",
  "role",
  "transferred",
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

function normalizeSlugLike(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolveTrustIdForDisposition(
  supabase: ReturnType<typeof createClient>,
  reportId: string,
  providedTrustId: string | null,
): Promise<string | null> {
  if (providedTrustId) return providedTrustId;

  const { data: report } = await supabase
    .from("herald_reports")
    .select("trust_id, session_service")
    .eq("id", reportId)
    .maybeSingle();

  if (report?.trust_id) return report.trust_id;
  const sessionService = typeof report?.session_service === "string" ? report.session_service.trim() : "";
  if (!sessionService) return null;

  const normalizedService = normalizeSlugLike(sessionService);
  const { data: trusts } = await supabase
    .from("trusts")
    .select("id, name, slug")
    .eq("active", true);
  if (!trusts || trusts.length === 0) return null;

  const match = trusts.find((trust) =>
    trust.name?.toLowerCase().trim() === sessionService.toLowerCase().trim() ||
    normalizeSlugLike(trust.name ?? "") === normalizedService ||
    (trust.slug ?? "").toLowerCase().trim() === normalizedService
  );
  return match?.id ?? null;
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (isRateLimited(req, { name: "sync-disposition", maxRequests: 30, windowMs: 60_000 })) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();

    const reportId = asText(body?.report_id, 64);
    const casualtyKey = asText(body?.casualty_key, 120);
    const patientId = asText(body?.patient_id, 64);
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

    const effectiveTrustId = await resolveTrustIdForDisposition(supabase, reportId, trustId);

    if (effectiveTrustId) {
      const { data: trust } = await supabase
        .from("trusts")
        .select("id")
        .eq("id", effectiveTrustId)
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
      .select("id, incident_number, shift_id")
      .eq("id", reportId)
      .maybeSingle();

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let resolvedPatientId = patientId;
    if (!resolvedPatientId) {
      const { data: mappedPatient } = await supabase
        .from("incident_patients")
        .select("id")
        .eq("report_id", reportId)
        .eq("casualty_key", casualtyKey)
        .maybeSingle();
      resolvedPatientId = mappedPatient?.id ?? null;
    }

    const { error: upsertError } = await supabase
      .from("casualty_dispositions")
      .upsert(
        {
          report_id: reportId,
          patient_id: resolvedPatientId,
          casualty_key: casualtyKey,
          casualty_label: casualtyLabel,
          priority,
          disposition,
          fields,
          incident_number: incidentNumber,
          closed_at: closedAt,
          session_callsign: sessionCallsign,
          trust_id: effectiveTrustId,
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

    await supabase.from("audit_log").insert({
      action: "disposition_recorded",
      trust_id: effectiveTrustId || null,
      details: {
        report_id: reportId,
        patient_id: resolvedPatientId || null,
        incident_number: incidentNumber || report?.incident_number || null,
        shift_id: report?.shift_id || null,
        callsign: sessionCallsign || null,
        casualty_key: casualtyKey,
        casualty_label: casualtyLabel,
        disposition,
        receiving_hospital: conveyedHospital || null,
        closed_at: closedAt,
      },
    });

    // Build report update payload
    const reportUpdate: Record<string, unknown> = {};
    if (conveyedHospital) {
      reportUpdate.receiving_hospital = conveyedHospital;
    }

    const closeEval = await evaluateAndCloseReportIfFinalized(supabase, reportId);
    if (closeEval.closed) {
      reportUpdate.status = "closed";
      reportUpdate.confirmed_at = closedAt;
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

    // Any final handover/disposition may free the owning crew for new incidents.
    if (closeEval.reportShiftId) {
      await recomputeCrewStatus(supabase, closeEval.reportShiftId);
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