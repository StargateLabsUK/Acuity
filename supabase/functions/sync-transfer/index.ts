import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import {
  markReceivingShiftHandoverOnlyIfIdle,
  recomputeCrewStatus,
  evaluateAndCloseReportIfFinalized,
} from "../_shared/lifecycle.ts";

function asText(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function jsonSafe(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return JSON.parse(JSON.stringify(v));
}

function normalizeSlugLike(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolveTrustIdForTransfer(
  supabase: ReturnType<typeof createClient>,
  params: {
    reportId?: string | null;
    fromShiftId?: string | null;
    toShiftId?: string | null;
    providedTrustId?: string | null;
  },
): Promise<string | null> {
  if (params.providedTrustId) return params.providedTrustId;

  if (params.reportId) {
    const { data: report } = await supabase
      .from("herald_reports")
      .select("trust_id, session_service")
      .eq("id", params.reportId)
      .maybeSingle();
    if (report?.trust_id) return report.trust_id;

    const sessionService = typeof report?.session_service === "string" ? report.session_service.trim() : "";
    if (sessionService) {
      const normalizedService = normalizeSlugLike(sessionService);
      const { data: trusts } = await supabase
        .from("trusts")
        .select("id, name, slug")
        .eq("active", true);
      const match = (trusts ?? []).find((trust) =>
        trust.name?.toLowerCase().trim() === sessionService.toLowerCase().trim() ||
        normalizeSlugLike(trust.name ?? "") === normalizedService ||
        (trust.slug ?? "").toLowerCase().trim() === normalizedService
      );
      if (match?.id) return match.id;
    }
  }

  const shiftIds = [params.fromShiftId, params.toShiftId].filter(Boolean) as string[];
  for (const shiftId of shiftIds) {
    const { data: shift } = await supabase
      .from("shifts")
      .select("trust_id")
      .eq("id", shiftId)
      .maybeSingle();
    if (shift?.trust_id) return shift.trust_id;
  }

  return null;
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (isRateLimited(req, { name: "sync-transfer", maxRequests: 20, windowMs: 60_000 })) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const action = asText(body?.action, 32);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ── INITIATE ──
    if (action === "initiate") {
      const reportId = asText(body?.report_id, 64);
      const casualtyKey = asText(body?.casualty_key, 120);
      const casualtyLabel = asText(body?.casualty_label, 240);
      const priority = asText(body?.priority, 24);
      const fromCallsign = asText(body?.from_callsign, 120);
      const fromOperatorId = asText(body?.from_operator_id, 120);
      const fromShiftId = asText(body?.from_shift_id, 64);
      const toCallsign = asText(body?.to_callsign, 120);
      const toShiftId = asText(body?.to_shift_id, 64);
      const trustId = asText(body?.trust_id, 64);
      const handoverNotes = asText(body?.handover_notes, 2000);
      const clinicalSnapshot = jsonSafe(body?.clinical_snapshot);

      if (!reportId || !casualtyKey || !casualtyLabel || !priority || !fromCallsign || !toCallsign) {
        return new Response(
          JSON.stringify({ error: "Missing required fields for initiate" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Verify report exists
      const { data: report } = await supabase
        .from("herald_reports")
        .select("id, incident_number")
        .eq("id", reportId)
        .maybeSingle();
      if (!report) {
        return new Response(
          JSON.stringify({ error: "Report not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Check for existing pending transfer for this casualty
      const { data: existing } = await supabase
        .from("patient_transfers")
        .select("id")
        .eq("report_id", reportId)
        .eq("casualty_key", casualtyKey)
        .eq("status", "pending")
        .maybeSingle();
      if (existing) {
        return new Response(
          JSON.stringify({ error: "A pending transfer already exists for this casualty" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const effectiveTrustId = await resolveTrustIdForTransfer(supabase, {
        reportId,
        fromShiftId,
        toShiftId,
        providedTrustId: trustId,
      });

      // Verify trust
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

      const initiatedAt = new Date().toISOString();

      const { data: transfer, error: insertError } = await supabase
        .from("patient_transfers")
        .insert({
          report_id: reportId,
          casualty_key: casualtyKey,
          casualty_label: casualtyLabel,
          priority,
          from_callsign: fromCallsign,
          from_operator_id: fromOperatorId,
          from_shift_id: fromShiftId,
          to_callsign: toCallsign,
          to_shift_id: toShiftId,
          clinical_snapshot: clinicalSnapshot,
          handover_notes: handoverNotes,
          initiated_at: initiatedAt,
          status: "pending",
          trust_id: effectiveTrustId,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("sync-transfer initiate error", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create transfer" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Log to audit_log
      await supabase.from("audit_log").insert({
        action: "transfer_initiated",
        trust_id: effectiveTrustId,
        details: {
          transfer_id: transfer.id,
          report_id: reportId,
          incident_number: report.incident_number ?? null,
          from_shift_id: fromShiftId || null,
          to_shift_id: toShiftId || null,
          casualty_key: casualtyKey,
          casualty_label: casualtyLabel,
          from_callsign: fromCallsign,
          to_callsign: toCallsign,
          initiated_at: initiatedAt,
          handover_notes: handoverNotes || null,
          has_handover_notes: !!handoverNotes,
        },
      });

      return new Response(
        JSON.stringify({ ok: true, transfer_id: transfer.id, initiated_at: initiatedAt }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── ACCEPT ──
    if (action === "accept") {
      const transferId = asText(body?.transfer_id, 64);
      const acceptingCallsign = asText(body?.accepting_callsign, 120);

      if (!transferId || !acceptingCallsign) {
        return new Response(
          JSON.stringify({ error: "Missing transfer_id or accepting_callsign" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Fetch the pending transfer
      const { data: transfer } = await supabase
        .from("patient_transfers")
        .select("*")
        .eq("id", transferId)
        .eq("status", "pending")
        .maybeSingle();

      if (!transfer) {
        return new Response(
          JSON.stringify({ error: "Transfer not found or already resolved" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Verify accepting crew matches to_callsign
      if (transfer.to_callsign !== acceptingCallsign) {
        return new Response(
          JSON.stringify({ error: "Accepting callsign does not match transfer destination" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const acceptedAt = new Date().toISOString();
      const effectiveTrustId = await resolveTrustIdForTransfer(supabase, {
        reportId: transfer.report_id,
        fromShiftId: transfer.from_shift_id,
        toShiftId: transfer.to_shift_id,
        providedTrustId: transfer.trust_id,
      });

      // Update transfer status
      const { error: updateError } = await supabase
        .from("patient_transfers")
        .update({
          status: "accepted",
          accepted_at: acceptedAt,
          ...(effectiveTrustId ? { trust_id: effectiveTrustId } : {}),
        })
        .eq("id", transferId);

      if (updateError) {
        console.error("sync-transfer accept error", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to accept transfer" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Insert a system transmission event on the incident
      await supabase.from("incident_transmissions").insert({
        report_id: transfer.report_id,
        timestamp: acceptedAt,
        transcript: `[SYSTEM EVENT — PATIENT TRANSFER]\n${transfer.casualty_label}\nFrom: ${transfer.from_callsign}${transfer.from_operator_id ? ` (operator ${transfer.from_operator_id})` : ""}\nTo: ${transfer.to_callsign}\nInitiated: ${transfer.initiated_at}\nAccepted: ${acceptedAt}\nClinical record transferred — pre-transfer section locked`,
        headline: `PATIENT TRANSFER: ${transfer.from_callsign} → ${transfer.to_callsign}`,
        priority: transfer.priority,
        session_callsign: transfer.to_callsign,
        operator_id: null,
        assessment: {
          system_event: true,
          event_type: "patient_transfer",
          transfer_id: transferId,
          from_callsign: transfer.from_callsign,
          to_callsign: transfer.to_callsign,
          casualty_key: transfer.casualty_key,
          initiated_at: transfer.initiated_at,
          accepted_at: acceptedAt,
        },
        trust_id: effectiveTrustId,
      });

      // Sender-side auto disposition for transfer lifecycle.
      // This marks custody transfer explicitly and removes this casualty
      // from the sender's open-patient workload.
      await supabase.from("casualty_dispositions").upsert(
        {
          report_id: transfer.report_id,
          casualty_key: transfer.casualty_key,
          casualty_label: transfer.casualty_label,
          priority: transfer.priority,
          disposition: "transferred",
          fields: {
            from_callsign: transfer.from_callsign,
            to_callsign: transfer.to_callsign,
            transfer_id: transfer.id,
            accepted_at: acceptedAt,
            note: `Transferred from ${transfer.from_callsign} to ${transfer.to_callsign}`,
          },
          incident_number: null,
          closed_at: acceptedAt,
          session_callsign: transfer.from_callsign,
          trust_id: effectiveTrustId,
        },
        { onConflict: "report_id,casualty_key" },
      );

      // Receiving crew now has accepted work but no owned incident.
      await markReceivingShiftHandoverOnlyIfIdle(supabase, transfer.to_shift_id);

      // Recompute sender + receiver statuses from strict lifecycle state.
      await recomputeCrewStatus(supabase, transfer.from_shift_id);
      await recomputeCrewStatus(supabase, transfer.to_shift_id);

      // Close report only when all casualties have FINAL outcomes.
      const closeEval = await evaluateAndCloseReportIfFinalized(supabase, transfer.report_id);
      if (closeEval.closed && closeEval.reportShiftId) {
        await recomputeCrewStatus(supabase, closeEval.reportShiftId);
      }

      // NOTE: Do NOT update session_callsign on the report — the original
      // crew retains ownership of the incident. The receiving crew sees
      // only the transferred casualty via the patient_transfers table.

      // Log to audit_log
      await supabase.from("audit_log").insert({
        action: "transfer_accepted",
        trust_id: effectiveTrustId,
        details: {
          transfer_id: transferId,
          report_id: transfer.report_id,
          incident_number: transfer.incident_number ?? null,
          from_shift_id: transfer.from_shift_id ?? null,
          to_shift_id: transfer.to_shift_id ?? null,
          casualty_key: transfer.casualty_key,
          casualty_label: transfer.casualty_label ?? null,
          from_callsign: transfer.from_callsign,
          to_callsign: transfer.to_callsign,
          initiated_at: transfer.initiated_at,
          accepted_at: acceptedAt,
          clinical_snapshot_keys: Object.keys(transfer.clinical_snapshot || {}),
        },
      });

      return new Response(
        JSON.stringify({ ok: true, accepted_at: acceptedAt }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── DECLINE ──
    if (action === "decline") {
      const transferId = asText(body?.transfer_id, 64);
      const decliningCallsign = asText(body?.declining_callsign, 120);
      const reason = asText(body?.reason, 500);

      if (!transferId || !decliningCallsign) {
        return new Response(
          JSON.stringify({ error: "Missing transfer_id or declining_callsign" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: transfer } = await supabase
        .from("patient_transfers")
        .select("*")
        .eq("id", transferId)
        .eq("status", "pending")
        .maybeSingle();

      if (!transfer) {
        return new Response(
          JSON.stringify({ error: "Transfer not found or already resolved" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (transfer.to_callsign !== decliningCallsign) {
        return new Response(
          JSON.stringify({ error: "Declining callsign does not match transfer destination" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const declinedAt = new Date().toISOString();
      const effectiveTrustId = await resolveTrustIdForTransfer(supabase, {
        reportId: transfer.report_id,
        fromShiftId: transfer.from_shift_id,
        toShiftId: transfer.to_shift_id,
        providedTrustId: transfer.trust_id,
      });

      const { error: updateError } = await supabase
        .from("patient_transfers")
        .update({
          status: "declined",
          declined_at: declinedAt,
          declined_reason: reason,
          ...(effectiveTrustId ? { trust_id: effectiveTrustId } : {}),
        })
        .eq("id", transferId);

      if (updateError) {
        console.error("sync-transfer decline error", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to decline transfer" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Log to audit_log
      await supabase.from("audit_log").insert({
        action: "transfer_declined",
        trust_id: effectiveTrustId,
        details: {
          transfer_id: transferId,
          report_id: transfer.report_id,
          incident_number: transfer.incident_number ?? null,
          from_shift_id: transfer.from_shift_id ?? null,
          to_shift_id: transfer.to_shift_id ?? null,
          casualty_key: transfer.casualty_key,
          casualty_label: transfer.casualty_label ?? null,
          from_callsign: transfer.from_callsign,
          to_callsign: transfer.to_callsign,
          declined_by: decliningCallsign,
          declined_at: declinedAt,
          reason,
        },
      });

      return new Response(
        JSON.stringify({ ok: true, declined_at: declinedAt }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use 'initiate', 'accept', or 'decline'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("sync-transfer error", error);
    return new Response(
      JSON.stringify({ error: "Transfer sync failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});