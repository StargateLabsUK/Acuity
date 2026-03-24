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
        trust_id: report.trust_id ?? null,
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

      // Add new action items from this transmission — deduplicated
      const newItems = newAssessment?.action_items || [];
      if (Array.isArray(newItems) && newItems.length > 0) {
        for (const newItem of newItems) {
          const newText = typeof newItem === 'string' ? newItem : newItem?.text || '';
          const newCategory = actionItemCategory(newText);
          let isDuplicate = false;

          for (let i = 0; i < mergedActionItems.length; i++) {
            const existingText = typeof mergedActionItems[i] === 'string'
              ? mergedActionItems[i] : mergedActionItems[i]?.text || '';
            if (actionItemsMatch(existingText, newText, newCategory, actionItemCategory(existingText))) {
              // Update timestamp on existing item but don't add duplicate
              if (typeof mergedActionItems[i] === 'object') {
                mergedActionItems[i].opened_at = new Date().toISOString();
              }
              isDuplicate = true;
              break;
            }
          }

          // Also check resolved items — don't re-add something already resolved
          if (!isDuplicate) {
            for (const resolved of resolvedItems) {
              const resolvedText = typeof resolved === 'string' ? resolved : resolved?.text || '';
              if (actionItemsMatch(resolvedText, newText, newCategory, actionItemCategory(resolvedText))) {
                isDuplicate = true;
                break;
              }
            }
          }

          if (!isDuplicate) {
            mergedActionItems.push(newItem);
          }
        }
      }

      // Merge into assessment — deep-merge clinical data per casualty
      const mergedAssessment = {
        ...(parentAssessment || {}),
        ...(newAssessment || {}),
        action_items: mergedActionItems,
        resolved_action_items: resolvedItems,
      };

      // Deep-merge ATMIST per casualty key (P1, P2, etc.)
      if (parentAssessment?.atmist || newAssessment?.atmist) {
        mergedAssessment.atmist = deepMergeCasualtyMap(
          parentAssessment?.atmist || {},
          newAssessment?.atmist || {},
        );
      }

      // Deep-merge clinical_findings (A, B, C, D, E fields)
      if (parentAssessment?.clinical_findings || newAssessment?.clinical_findings) {
        mergedAssessment.clinical_findings = mergeShallow(
          parentAssessment?.clinical_findings || {},
          newAssessment?.clinical_findings || {},
        );
      }

      // Deep-merge vitals — never clear existing values
      if (parentAssessment?.vitals || newAssessment?.vitals) {
        mergedAssessment.vitals = mergeShallow(
          parentAssessment?.vitals || {},
          newAssessment?.vitals || {},
        );
      }

      // Preserve scene_location — never clear it, only overwrite with a more specific value
      if (parentAssessment?.scene_location && !newAssessment?.scene_location) {
        mergedAssessment.scene_location = parentAssessment.scene_location;
      }

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

/**
 * Categorise an action item into a semantic bucket for deduplication.
 */
function actionItemCategory(text: string): string {
  const t = text.toLowerCase();
  if (/hems/i.test(t)) return 'hems';
  if (/receiv(ing|e)\s*hospital/i.test(t)) return 'hospital';
  if (/transport(ing)?\s*unit/i.test(t) || /cannot\s*convey/i.test(t)) return 'transport';
  if (/additional\s*(unit|ambulance|crew|resource)/i.test(t)) return 'additional_unit';
  if (/back-?up/i.test(t)) return 'backup';
  if (/trapped|extrication/i.test(t)) return 'extrication';
  if (/status\s*(unconfirmed|unknown)/i.test(t)) return 'status_unconfirmed';
  return '';
}

/**
 * Check if two action items are semantically the same.
 * Same category = duplicate. Also does normalised text comparison.
 */
function actionItemsMatch(a: string, b: string, catA: string, catB: string): boolean {
  // Same non-empty category = semantic match
  if (catA && catB && catA === catB) return true;
  // Normalised text match
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

/**
 * Shallow-merge two objects, keeping existing values when the new value is
 * null, undefined, or empty string. Used for clinical_findings and vitals.
 */
function mergeShallow(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== '' && value !== '—') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Deep-merge ATMIST casualty maps. Each key (P1, P2, P1-2, etc.) is merged
 * field-by-field so existing clinical data is preserved when not updated.
 */
function deepMergeCasualtyMap(
  existing: Record<string, Record<string, unknown>>,
  incoming: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  // Copy all existing casualty entries
  for (const [key, val] of Object.entries(existing)) {
    result[key] = { ...val };
  }

  // Merge incoming entries field-by-field
  for (const [key, incomingCasualty] of Object.entries(incoming)) {
    if (!incomingCasualty || typeof incomingCasualty !== 'object') continue;
    if (!result[key]) {
      result[key] = { ...incomingCasualty };
    } else {
      result[key] = mergeShallow(result[key], incomingCasualty as Record<string, unknown>);
    }
  }

  return result;
}
