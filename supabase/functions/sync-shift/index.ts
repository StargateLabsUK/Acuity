import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import {
  getShiftEndBlockingState,
  recomputeCrewStatus,
} from "../_shared/lifecycle.ts";

const MAX_STRING_LENGTH = 200;

function validateString(val: unknown, maxLen = MAX_STRING_LENGTH): boolean {
  return !val || (typeof val === 'string' && val.length <= maxLen);
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (isRateLimited(req, { name: "sync-shift", maxRequests: 20, windowMs: 60_000 })) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { action } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (action === "start") {
      const { callsign, service, station, operator_id, device_id, vehicle_type, can_transport, critical_care, trust_id } = body;
      if (!callsign || !service) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: callsign, service" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate string lengths
      if (!validateString(callsign) || !validateString(service) || !validateString(station) ||
          !validateString(operator_id) || !validateString(device_id) || !validateString(vehicle_type)) {
        return new Response(
          JSON.stringify({ error: "Field value too long" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Auth: verify trust_id exists and is active
      if (trust_id) {
        const { data: trust } = await supabase
          .from("trusts")
          .select("id")
          .eq("id", trust_id)
          .eq("active", true)
          .maybeSingle();
        if (!trust) {
          return new Response(
            JSON.stringify({ error: "Invalid trust" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const { data, error } = await supabase.from("shifts").insert({
        callsign,
        service,
        station: station || null,
        operator_id: operator_id || null,
        device_id: device_id || null,
        vehicle_type: vehicle_type || null,
        can_transport: can_transport ?? true,
        critical_care: critical_care ?? false,
        crew_status: "available",
        active_report_id: null,
        trust_id: trust_id || null,
      }).select("id").single();

      if (error) {
        console.error("Insert shift error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to create shift" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("audit_log").insert({
        action: "shift_started",
        trust_id: trust_id || null,
        details: { shift_id: data.id, callsign },
      });

      return new Response(
        JSON.stringify({ ok: true, shift_id: data.id }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "end") {
      const { shift_id } = body;
      if (!shift_id || typeof shift_id !== 'string') {
        return new Response(
          JSON.stringify({ error: "Missing shift_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify shift exists before ending
      const { data: shift } = await supabase
        .from("shifts")
        .select("id, trust_id")
        .eq("id", shift_id)
        .maybeSingle();

      if (!shift) {
        return new Response(
          JSON.stringify({ error: "Shift not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const blocking = await getShiftEndBlockingState(supabase, shift_id);
      if (blocking.openIncidentIds.length > 0 || blocking.outstandingAcceptedTransferCount > 0) {
        await supabase.from("audit_log").insert({
          action: "shift_end_blocked_open_patients",
          trust_id: shift.trust_id ?? null,
          details: {
            shift_id,
            open_incident_ids: blocking.openIncidentIds,
            outstanding_accepted_transfer_count: blocking.outstandingAcceptedTransferCount,
          },
        });
        return new Response(
          JSON.stringify({
            error: "Cannot end shift while patients are still awaiting final disposition",
            open_incident_ids: blocking.openIncidentIds,
            outstanding_accepted_transfer_count: blocking.outstandingAcceptedTransferCount,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase.from("shifts").update({
        ended_at: new Date().toISOString(),
        active_report_id: null,
        crew_status: "available",
      }).eq("id", shift_id);

      if (error) {
        console.error("End shift error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to end shift" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("audit_log").insert({
        action: "shift_ended",
        trust_id: shift.trust_id ?? null,
        details: { shift_id },
      });

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status") {
      const { shift_id } = body;
      if (!shift_id || typeof shift_id !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing shift_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const status = await recomputeCrewStatus(supabase, shift_id);
      if (!status) {
        return new Response(
          JSON.stringify({ error: "Shift not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, crew_status: status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use 'start', 'end', or 'status'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync-shift error:", error);
    return new Response(
      JSON.stringify({ error: "Shift sync failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
