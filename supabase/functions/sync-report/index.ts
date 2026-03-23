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

    let parentId = report.follow_up_of || null;

    // --- SERVER-SIDE CONSOLIDATION ---
    // If client didn't flag as follow-up, try to find a matching open incident
    if (!parentId) {
      parentId = await findMatchingIncident(supabase, report);
    }

    if (parentId) {
      // --- FOLLOW-UP: append transmission to existing incident ---
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

      // Build update payload — later transmissions take precedence on clinical detail
      // Also auto-resolve action items from the new transmission
      const parentReport = await supabase
        .from("herald_reports")
        .select("assessment")
        .eq("id", parentId)
        .single();

      const parentAssessment = parentReport?.data?.assessment as any;
      const newAssessment = report.assessment as any;
      const newTranscript = (report.transcript as string) || "";

      // Auto-resolve existing action items based on new content
      let mergedActionItems = parentAssessment?.action_items || [];
      const resolvedItems: any[] = parentAssessment?.resolved_action_items || [];
      
      if (Array.isArray(mergedActionItems) && mergedActionItems.length > 0) {
        const nowIso = new Date().toISOString();
        const textLower = newTranscript.toLowerCase();
        const newHospitals = newAssessment?.receiving_hospital || [];
        
        const stillActive: any[] = [];
        for (const item of mergedActionItems) {
          const itemText = typeof item === 'string' ? item : item?.text || '';
          let isResolved = false;

          if (/HEMS not yet confirmed/i.test(itemText) && /\bHEMS\b.*\b(on\s*scene|landed|arrived|taking\s*over)\b/i.test(textLower)) {
            isResolved = true;
          }
          if (/receiving hospital/i.test(itemText) && /contact Control/i.test(itemText) && (newHospitals.length > 0 || /\b(conveying|transporting|en\s*route)\s*(to|—)\s*\w/i.test(textLower))) {
            isResolved = true;
          }
          if (/not yet confirmed/i.test(itemText) && (/additional/i.test(itemText) || /backup/i.test(itemText)) && /\b(on\s*scene|arrived|confirmed)\b/i.test(textLower)) {
            isResolved = true;
          }
          if (/trapped.*extrication/i.test(itemText) && /\b(extricated|extrication\s*(complete|done)|freed|released)\b/i.test(textLower)) {
            isResolved = true;
          }

          if (isResolved) {
            resolvedItems.push(typeof item === 'object' ? { ...item, resolved_at: nowIso } : { text: item, opened_at: nowIso, resolved_at: nowIso });
          } else {
            stillActive.push(item);
          }
        }
        mergedActionItems = stillActive;
      }

      // Add new action items from this transmission
      const newItems = newAssessment?.action_items || [];
      if (Array.isArray(newItems) && newItems.length > 0) {
        mergedActionItems = [...mergedActionItems, ...newItems];
      }

      // Merge into assessment
      const mergedAssessment = {
        ...(parentAssessment || {}),
        ...(newAssessment || {}),
        action_items: mergedActionItems,
        resolved_action_items: resolvedItems,
      };

      // Backfill receiving_hospital if newly confirmed
      const newHospitals2 = newAssessment?.receiving_hospital;
      if (Array.isArray(newHospitals2) && newHospitals2.length > 0) {
        mergedAssessment.receiving_hospital = newHospitals2;
      }

      const updatePayload: Record<string, unknown> = {
        priority: report.priority,
        headline: report.headline,
        assessment: mergedAssessment,
        latest_transmission_at: report.timestamp,
      };

      // Backfill incident_number if it appeared in this transmission but was missing before
      const incomingIncidentNumber = report.incident_number ||
        report.assessment?.structured?.incident_number;
      if (incomingIncidentNumber && incomingIncidentNumber !== "null") {
        updatePayload.incident_number = incomingIncidentNumber;
      }

      const { error: updateError } = await supabase
        .from("herald_reports")
        .update(updatePayload)
        .eq("id", parentId);

      if (updateError) {
        console.error("Update parent error:", updateError);
      }

      // Increment transmission_count
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
        JSON.stringify({ ok: true, follow_up: true, parent_id: parentId }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- NEW REPORT ---
    const { follow_up_of, ...reportData } = report;

    // Set latest_transmission_at and transmission_count for new reports
    reportData.latest_transmission_at = reportData.latest_transmission_at || report.timestamp;
    reportData.transmission_count = reportData.transmission_count || 1;

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

    // Insert first transmission log entry
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

/**
 * Find a matching open incident for consolidation.
 * Rules:
 * 1) Exact incident_number match
 * 2) Same callsign + (same incident_type OR same location) + within 30 minutes
 * 3) Same callsign + only one open incident within 30 minutes
 */
async function findMatchingIncident(
  supabase: ReturnType<typeof createClient>,
  report: Record<string, unknown>
): Promise<string | null> {
  const incidentNumber = (report.incident_number as string) ||
    (report.assessment as any)?.structured?.incident_number;
  const callsign = (report.session_callsign as string) || null;
  const assessment = report.assessment as any;
  const incidentType = assessment?.incident_type || null;
  const sceneLocation = assessment?.scene_location || null;
  const shiftId = (report.shift_id as string) || null;
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // 1) Exact incident_number match
  if (incidentNumber && incidentNumber !== "null" && incidentNumber !== "") {
    const query = supabase
      .from("herald_reports")
      .select("id")
      .eq("incident_number", incidentNumber)
      .eq("status", "active")
      .neq("id", report.id)
      .limit(1);

    if (shiftId) query.eq("shift_id", shiftId);

    const { data } = await query;
    if (data && data.length > 0) {
      return data[0].id;
    }
  }

  // 2-3) Callsign + context/time window match
  if (callsign && callsign !== "null") {
    const query = supabase
      .from("herald_reports")
      .select("id, incident_number, assessment, latest_transmission_at, created_at")
      .eq("status", "active")
      .eq("session_callsign", callsign)
      .neq("id", report.id)
      .gte("latest_transmission_at", thirtyMinAgo)
      .order("latest_transmission_at", { ascending: false })
      .limit(5);

    if (shiftId) query.eq("shift_id", shiftId);

    const { data } = await query;
    if (data && data.length > 0) {
      // Score by context overlap
      for (const candidate of data) {
        const cAssessment = candidate.assessment as any;
        if (!cAssessment) continue;

        const typeMatch = incidentType && cAssessment.incident_type &&
          incidentType.toLowerCase() === cAssessment.incident_type.toLowerCase();
        const locationMatch = sceneLocation && cAssessment.scene_location &&
          sceneLocation.toLowerCase() === cAssessment.scene_location.toLowerCase();

        if (typeMatch || locationMatch) {
          return candidate.id;
        }
      }

      // If only one candidate within window, match it
      if (data.length === 1) {
        return data[0].id;
      }
    }
  }

  return null;
}
