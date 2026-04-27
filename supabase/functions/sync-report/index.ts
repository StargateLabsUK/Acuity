import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";
import { setShiftOnIncident } from "../_shared/lifecycle.ts";

const MAX_TRANSCRIPT_LENGTH = 10000;
const MAX_HEADLINE_LENGTH = 500;

const ALLOWED_REPORT_FIELDS = new Set([
  'id', 'timestamp', 'transcript', 'assessment', 'headline', 'priority',
  'status', 'incident_number', 'service', 'session_callsign', 'session_service',
  'session_station', 'session_operator_id', 'operator_id', 'device_id',
  'vehicle_type', 'can_transport', 'critical_care', 'trust_id', 'shift_id',
  'user_id', 'synced', 'confirmed_at',
  'original_assessment', 'final_assessment', 'diff', 'edited',
  'follow_up_of', 'transmission_count', 'latest_transmission_at',
]);

function sanitizeReport(raw: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (ALLOWED_REPORT_FIELDS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

interface IncidentPatientRow {
  id: string;
  report_id: string;
  casualty_key: string;
  casualty_label: string;
  priority: string | null;
  patient_name: string | null;
  age_sex: string | null;
}

function cleanPatientName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return null;
  return trimmed.slice(0, 240);
}

function extractAgeSexFromCasualty(casualty: Record<string, unknown> | null | undefined): string | null {
  if (!casualty || typeof casualty !== "object") return null;
  const raw = casualty.A;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—") return null;
  return trimmed.slice(0, 240);
}

function basePriorityFromCasualtyKey(casualtyKey: string): string {
  const match = casualtyKey.toUpperCase().match(/^P[1-4]/);
  return match?.[0] ?? casualtyKey.toUpperCase().slice(0, 24);
}

function normalizePatientNameForMatch(name: string | null): string | null {
  if (!name) return null;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function normalizeAgeSexForMatch(value: string | null): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function buildDefaultCasualtyLabel(casualtyKey: string, casualtyData: Record<string, unknown>): string {
  const ageSex = extractAgeSexFromCasualty(casualtyData);
  if (ageSex) return `${casualtyKey} — ${ageSex}`.slice(0, 240);
  return casualtyKey.slice(0, 240);
}

async function ensureIncidentPatientsForAssessment(
  supabase: ReturnType<typeof createClient>,
  reportId: string,
  assessment: Record<string, unknown> | null | undefined,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!assessment || typeof assessment !== "object") return result;

  const atmistRaw = (assessment as any).atmist;
  if (!atmistRaw || typeof atmistRaw !== "object") return result;
  const atmistEntries = Object.entries(atmistRaw as Record<string, unknown>)
    .filter(([_, value]) => value && typeof value === "object") as Array<[string, Record<string, unknown>]>;

  if (atmistEntries.length === 0) return result;

  const { data: existingRows } = await supabase
    .from("incident_patients")
    .select("id, report_id, casualty_key, casualty_label, priority, patient_name, age_sex")
    .eq("report_id", reportId);

  const byCasualtyKey = new Map<string, IncidentPatientRow>();
  const existingForMatch: IncidentPatientRow[] = [];
  for (const row of (existingRows ?? []) as IncidentPatientRow[]) {
    byCasualtyKey.set(row.casualty_key, row);
    existingForMatch.push(row);
  }

  const usedExistingIds = new Set<string>();
  const inserts: Array<{
    report_id: string;
    casualty_key: string;
    casualty_label: string;
    priority: string | null;
    patient_name: string | null;
    age_sex: string | null;
  }> = [];

  for (const [casualtyKey, casualtyData] of atmistEntries) {
    const ageSex = extractAgeSexFromCasualty(casualtyData);
    const patientName =
      cleanPatientName((casualtyData as any).name) ||
      cleanPatientName((assessment as any).patient_name);
    const priority = basePriorityFromCasualtyKey(casualtyKey);

    const existingExact = byCasualtyKey.get(casualtyKey);
    if (existingExact) {
      usedExistingIds.add(existingExact.id);
      result[casualtyKey] = existingExact.id;

      const updates: Record<string, unknown> = {};
      if (patientName && !existingExact.patient_name) updates.patient_name = patientName;
      if (ageSex && !existingExact.age_sex) updates.age_sex = ageSex;
      if (priority && existingExact.priority !== priority) updates.priority = priority;
      const desiredLabel = buildDefaultCasualtyLabel(casualtyKey, casualtyData);
      if (!existingExact.casualty_label || existingExact.casualty_label === existingExact.casualty_key) {
        updates.casualty_label = desiredLabel;
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from("incident_patients").update(updates).eq("id", existingExact.id);
      }
      continue;
    }

    // Fallback match when casualty key changed between transmissions:
    // prefer exact patient_name, else exact age/sex + base priority.
    const normalizedName = normalizePatientNameForMatch(patientName);
    const normalizedAgeSex = normalizeAgeSexForMatch(ageSex);
    let matched: IncidentPatientRow | null = null;
    for (const row of existingForMatch) {
      if (usedExistingIds.has(row.id)) continue;
      const rowName = normalizePatientNameForMatch(row.patient_name);
      const rowAgeSex = normalizeAgeSexForMatch(row.age_sex);
      if (normalizedName && rowName && normalizedName === rowName) {
        matched = row;
        break;
      }
      if (!normalizedName && normalizedAgeSex && rowAgeSex && normalizedAgeSex === rowAgeSex && row.priority === priority) {
        matched = row;
        break;
      }
    }

    if (matched) {
      usedExistingIds.add(matched.id);
      result[casualtyKey] = matched.id;
      await supabase
        .from("incident_patients")
        .update({
          casualty_key: casualtyKey,
          casualty_label: buildDefaultCasualtyLabel(casualtyKey, casualtyData),
          priority,
          patient_name: matched.patient_name ?? patientName,
          age_sex: matched.age_sex ?? ageSex,
        })
        .eq("id", matched.id);
      byCasualtyKey.set(casualtyKey, {
        ...matched,
        casualty_key: casualtyKey,
      });
      continue;
    }

    inserts.push({
      report_id: reportId,
      casualty_key: casualtyKey,
      casualty_label: buildDefaultCasualtyLabel(casualtyKey, casualtyData),
      priority,
      patient_name: patientName,
      age_sex: ageSex,
    });
  }

  if (inserts.length > 0) {
    const { data: insertedRows, error } = await supabase
      .from("incident_patients")
      .insert(inserts)
      .select("id, casualty_key");
    if (error) {
      console.error("incident_patients insert error:", error);
    } else {
      for (const row of insertedRows ?? []) {
        if (row?.casualty_key && row?.id) {
          result[row.casualty_key] = row.id;
        }
      }
    }
  }

  // Ensure existing mappings are present in result even if no insert was needed.
  for (const [casualtyKey, row] of byCasualtyKey.entries()) {
    if (!result[casualtyKey]) result[casualtyKey] = row.id;
  }

  return result;
}

function embedPatientIdsInAssessment(
  assessment: Record<string, unknown> | null | undefined,
  patientIdsByCasualtyKey: Record<string, string>,
): Record<string, unknown> | null | undefined {
  if (!assessment || typeof assessment !== "object") return assessment;
  const atmistRaw = (assessment as any).atmist;
  if (!atmistRaw || typeof atmistRaw !== "object") return assessment;

  const nextAssessment: Record<string, unknown> = { ...assessment };
  const nextAtmist: Record<string, unknown> = { ...(atmistRaw as Record<string, unknown>) };
  let changed = false;

  for (const [casualtyKey, value] of Object.entries(nextAtmist)) {
    if (!value || typeof value !== "object") continue;
    const patientId = patientIdsByCasualtyKey[casualtyKey];
    if (!patientId) continue;
    const casualty = value as Record<string, unknown>;
    if (casualty.patient_id !== patientId) {
      nextAtmist[casualtyKey] = { ...casualty, patient_id: patientId };
      changed = true;
    }
  }

  if (!changed) return assessment;
  nextAssessment.atmist = nextAtmist;
  return nextAssessment;
}

function validateReport(report: Record<string, unknown>): string | null {
  if (!report.id || typeof report.id !== 'string') return 'Missing or invalid id';
  if (!report.timestamp || typeof report.timestamp !== 'string') return 'Missing or invalid timestamp';
  if (report.transcript && typeof report.transcript === 'string' && report.transcript.length > MAX_TRANSCRIPT_LENGTH) {
    return `Transcript too long (max ${MAX_TRANSCRIPT_LENGTH})`;
  }
  if (report.headline && typeof report.headline === 'string' && report.headline.length > MAX_HEADLINE_LENGTH) {
    return `Headline too long (max ${MAX_HEADLINE_LENGTH})`;
  }
  if (report.trust_id && typeof report.trust_id !== 'string') return 'Invalid trust_id';
  return null;
}

function buildAutoIncidentNumber(now = new Date()): string {
  const y = now.getUTCFullYear().toString();
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const h = now.getUTCHours().toString().padStart(2, "0");
  const min = now.getUTCMinutes().toString().padStart(2, "0");
  const s = now.getUTCSeconds().toString().padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INC-${y}${m}${d}-${h}${min}${s}-${rand}`;
}

function normalizeSlugLike(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolveTrustIdForReport(
  supabase: ReturnType<typeof createClient>,
  report: Record<string, unknown>,
): Promise<string | null> {
  const providedTrustId = typeof report.trust_id === "string" ? report.trust_id : null;
  if (providedTrustId) return providedTrustId;

  const shiftId = typeof report.shift_id === "string" ? report.shift_id : null;
  if (shiftId) {
    const { data: shift } = await supabase
      .from("shifts")
      .select("trust_id")
      .eq("id", shiftId)
      .maybeSingle();
    if (shift?.trust_id) return shift.trust_id;
  }

  const service =
    (typeof report.session_service === "string" && report.session_service.trim()) ||
    (typeof report.service === "string" && report.service.trim()) ||
    "";
  if (!service) return null;

  const normalizedService = normalizeSlugLike(service);
  const { data: trusts } = await supabase
    .from("trusts")
    .select("id, name, slug")
    .eq("active", true);
  if (!trusts || trusts.length === 0) return null;

  const match = trusts.find((trust) =>
    trust.name?.toLowerCase().trim() === service.toLowerCase().trim() ||
    normalizeSlugLike(trust.name ?? "") === normalizedService ||
    (trust.slug ?? "").toLowerCase().trim() === normalizedService
  );
  return match?.id ?? null;
}

async function ensureIncidentNumber(
  supabase: ReturnType<typeof createClient>,
  reportData: Record<string, unknown>,
): Promise<void> {
  const fromPayload = typeof reportData.incident_number === "string"
    ? reportData.incident_number.trim()
    : "";
  const fromStructured = typeof (reportData.assessment as any)?.structured?.incident_number === "string"
    ? String((reportData.assessment as any).structured.incident_number).trim()
    : "";
  const chosen = fromPayload || fromStructured;
  if (chosen) {
    reportData.incident_number = chosen;
    return;
  }

  for (let i = 0; i < 4; i += 1) {
    const candidate = buildAutoIncidentNumber();
    const { data: existing } = await supabase
      .from("herald_reports")
      .select("id")
      .eq("incident_number", candidate)
      .limit(1);
    if (!existing || existing.length === 0) {
      reportData.incident_number = candidate;
      return;
    }
  }

  reportData.incident_number = `${buildAutoIncidentNumber()}-${Math.floor(Math.random() * 10)}`;
}

function timestampMs(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NaN : ms;
}

type ExistingTransmission = {
  id: string;
  timestamp: string;
  created_at?: string | null;
};

async function findMatchingTransmission(
  supabase: ReturnType<typeof createClient>,
  reportId: string,
  report: Record<string, unknown>,
): Promise<ExistingTransmission | null> {
  const timestamp = typeof report.timestamp === "string" ? report.timestamp : null;
  if (!timestamp) return null;

  let query = supabase
    .from("incident_transmissions")
    .select("id, timestamp, created_at")
    .eq("report_id", reportId)
    .eq("timestamp", timestamp)
    .eq("transcript", (report.transcript as string) ?? null)
    .limit(1);

  const callsign = typeof report.session_callsign === "string" ? report.session_callsign : null;
  const operatorId = typeof report.session_operator_id === "string" ? report.session_operator_id : null;

  query = callsign ? query.eq("session_callsign", callsign) : query.is("session_callsign", null);
  query = operatorId ? query.eq("operator_id", operatorId) : query.is("operator_id", null);

  const { data, error } = await query;
  if (error) {
    console.error("findMatchingTransmission error:", error);
    return null;
  }

  return ((data ?? [])[0] as ExistingTransmission | undefined) ?? null;
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (isRateLimited(req, { name: "sync-report", maxRequests: 30, windowMs: 60_000 })) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const rawReport = await req.json();
    const report = sanitizeReport(rawReport);

    // Validate required fields and types
    const validationError = validateReport(report);
    if (validationError) {
      return new Response(
        JSON.stringify({ error: validationError }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Resolve trust_id server-side when client context is missing.
    const resolvedTrustId = await resolveTrustIdForReport(supabase, report);
    if (resolvedTrustId) {
      report.trust_id = resolvedTrustId;
    }

    // Auth: verify trust_id exists and is active
    if (report.trust_id) {
      const { data: trust } = await supabase
        .from("trusts")
        .select("id")
        .eq("id", report.trust_id)
        .eq("active", true)
        .maybeSingle();
      if (!trust) {
        return new Response(
          JSON.stringify({ error: "Invalid trust" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let parentId = (report.follow_up_of as string) || null;

    // --- SERVER-SIDE CONSOLIDATION ---
    if (!parentId) {
      parentId = await findMatchingIncident(supabase, report);
    }

    // Enforce one active incident per shift and prevent cross-shift contamination.
    const enforced = await enforceSingleActiveIncidentForShift(supabase, report, parentId);
    if (enforced.error) {
      return new Response(
        JSON.stringify({ error: enforced.error }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    parentId = enforced.parentId;

    if (parentId) {
      // --- FOLLOW-UP: append transmission to existing incident ---
      // Idempotency guard: avoid duplicating timeline rows on queue retries.
      // We treat (report_id + timestamp + transcript + callsign + operator_id) as the
      // logical transmission identity from the field device.
      const normalizedTranscript = typeof report.transcript === "string" ? report.transcript.trim() : "";
      const normalizedCallsign = typeof report.session_callsign === "string" ? report.session_callsign.trim() : "";
      const normalizedOperator = typeof report.session_operator_id === "string" ? report.session_operator_id.trim() : "";

      const { data: existingTx } = await supabase
        .from("incident_transmissions")
        .select("id")
        .eq("report_id", parentId)
        .eq("timestamp", report.timestamp as string)
        .eq("transcript", normalizedTranscript || null)
        .eq("session_callsign", normalizedCallsign || null)
        .eq("operator_id", normalizedOperator || null)
        .maybeSingle();

      let insertedNewTransmission = false;
      if (!existingTx) {
        const { error: txError } = await supabase.from("incident_transmissions").insert({
          report_id: parentId,
          timestamp: report.timestamp,
          transcript: normalizedTranscript || null,
          assessment: report.assessment ?? null,
          priority: report.priority ?? null,
          headline: report.headline ?? null,
          operator_id: normalizedOperator || null,
          session_callsign: normalizedCallsign || null,
          trust_id: report.trust_id ?? null,
        });

        if (txError) {
          console.error("Insert transmission error:", txError);
          return new Response(
            JSON.stringify({ error: "Failed to save transmission" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        insertedNewTransmission = true;
      }

      const parentReport = await supabase
        .from("herald_reports")
        .select("assessment")
        .eq("id", parentId)
        .single();

      const parentAssessment = normalizeAssessmentForMerge((parentReport?.data?.assessment as Record<string, unknown>) || {}) as any;
      const newAssessment = normalizeAssessmentForMerge((report.assessment as Record<string, unknown>) || {}) as any;
      const newTranscript = (report.transcript as string) || "";

      await assignStablePatientIds(supabase, parentId, parentAssessment, newAssessment);

      let mergedActionItems = parentAssessment?.action_items || [];
      const resolvedItems: any[] = parentAssessment?.resolved_action_items || [];
      
      if (Array.isArray(mergedActionItems) && mergedActionItems.length > 0) {
        const nowIso = new Date().toISOString();
        const textLower = newTranscript.toLowerCase();
        const newHospitals = newAssessment?.receiving_hospital || [];
        
        // Only attempt resolution if the transcript has meaningful content
        const hasContent = textLower.trim().length > 0;
        
        const stillActive: any[] = [];
        for (const item of mergedActionItems) {
          const itemText = typeof item === 'string' ? item : item?.text || '';
          let isResolved = false;

          // Only check resolution if transcript explicitly mentions the topic
          if (hasContent) {
            // HEMS: only resolve when explicitly confirmed tasked/en route, on scene, or stood down
            if (/HEMS/i.test(itemText) && /\bHEMS\b/i.test(textLower)) {
              if (/\bHEMS\b.*\b(tasked|en\s*route|on\s*scene|landed|arrived|taking\s*over|stood\s*down|cancelled|canceled|not\s*required)\b/i.test(textLower)) {
                isResolved = true;
              }
            }
            // Hospital: only resolve when crew explicitly states receiving hospital confirmed or conveying to named destination
            if (/receiving hospital/i.test(itemText) && /hospital/i.test(itemText)) {
              if (newHospitals.length > 0 || /\b(conveying|transporting|en\s*route)\s*(to|—)\s*[A-Z]/i.test(textLower)) {
                isResolved = true;
              }
            }
            // Additional units/backup: only resolve when explicitly confirmed on scene or arrived
            if (/not yet confirmed/i.test(itemText) && (/additional/i.test(itemText) || /backup/i.test(itemText))) {
              if (/\b(additional|backup|back-?up)\b.*\b(on\s*scene|arrived|confirmed)\b/i.test(textLower)) {
                isResolved = true;
              }
            }
            // Extrication: only resolve when crew explicitly confirms patient extricated
            if (/trapped.*extrication/i.test(itemText)) {
              if (/\b(extricated|extrication\s*(complete|done)|freed|released)\b/i.test(textLower)) {
                isResolved = true;
              }
            }
            // Triage: only resolve when crew confirms all casualties assessed
            if (/triage|casualties.*assessed/i.test(itemText)) {
              if (/\b(triage\s*(complete|done)|all\s*casualties\s*(assessed|accounted))\b/i.test(textLower)) {
                isResolved = true;
              }
            }
          }

          if (isResolved) {
            resolvedItems.push(typeof item === 'object' ? { ...item, resolved_at: nowIso } : { text: item, opened_at: nowIso, resolved_at: nowIso });
          } else {
            stillActive.push(item);
          }
        }
        mergedActionItems = stillActive;
      }

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
              if (typeof mergedActionItems[i] === 'object') {
                mergedActionItems[i].opened_at = new Date().toISOString();
              }
              isDuplicate = true;
              break;
            }
          }

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

      // Use mergeShallow for top-level so empty/null fields in new assessment
      // don't wipe existing data. "No mention" = "no change".
      const mergedAssessment = mergeShallow(
        parentAssessment || {},
        newAssessment || {},
      ) as Record<string, unknown>;

      const mergedClinicalFindings = mergeClinicalFindings(
        (parentAssessment?.clinical_findings || {}) as Record<string, unknown>,
        (newAssessment?.clinical_findings || {}) as Record<string, unknown>,
      );

      // Explicitly set merged action items (overrides any spread value)
      mergedAssessment.action_items = mergedActionItems;
      mergedAssessment.resolved_action_items = resolvedItems;

      // Deep merge nested structures to preserve per-field casualty data
      if (parentAssessment?.atmist || newAssessment?.atmist) {
        mergedAssessment.atmist = deepMergeCasualtyMap(
          (parentAssessment?.atmist || {}) as Record<string, Record<string, unknown>>,
          (newAssessment?.atmist || {}) as Record<string, Record<string, unknown>>,
          newTranscript,
        );
      }

      const patientIdsByCasualtyKey = await ensureIncidentPatientsForAssessment(
        supabase,
        parentId,
        mergedAssessment,
      );
      mergedAssessment.clinical_findings = mergedClinicalFindings;
      const mergedAssessmentWithPatientIds = embedPatientIdsInAssessment(
        mergedAssessment,
        patientIdsByCasualtyKey,
      ) as Record<string, unknown>;

      if (parentAssessment?.vitals || newAssessment?.vitals) {
        mergedAssessment.vitals = mergeShallow(
          parentAssessment?.vitals || {},
          newAssessment?.vitals || {},
        );
      }

      // Preserve scene_location unless new one is explicitly provided
      if (parentAssessment?.scene_location && !newAssessment?.scene_location) {
        mergedAssessment.scene_location = parentAssessment.scene_location;
      }

      // Receiving hospital: only overwrite if new transmission explicitly provides one
      const newHospitals2 = newAssessment?.receiving_hospital;
      if (Array.isArray(newHospitals2) && newHospitals2.length > 0) {
        mergedAssessment.receiving_hospital = newHospitals2;
      } else if (parentAssessment?.receiving_hospital) {
        mergedAssessment.receiving_hospital = parentAssessment.receiving_hospital;
      }

      // Treatment given: merge arrays, don't replace
      if (parentAssessment?.treatment_given || newAssessment?.treatment_given) {
        const existingTreatments = parentAssessment?.treatment_given || [];
        const newTreatments = newAssessment?.treatment_given || [];
        const allTreatments = [...existingTreatments];
        for (const t of newTreatments) {
          if (!allTreatments.some((e: string) => e.toLowerCase() === t.toLowerCase())) {
            allTreatments.push(t);
          }
        }
        mergedAssessment.treatment_given = allTreatments;
      }

      // Structured fields: merge, don't replace
      if (parentAssessment?.structured || newAssessment?.structured) {
        mergedAssessment.structured = mergeShallow(
          parentAssessment?.structured || {},
          newAssessment?.structured || {},
        );
      }

      const updatePayload: Record<string, unknown> = {
        assessment: mergedAssessmentWithPatientIds,
        latest_transmission_at: report.timestamp,
      };

      // Incident-level priority is deprecated; priority lives per patient (ATMIST).
      if (report.headline && report.headline !== '' && report.headline !== 'null') {
        updatePayload.headline = report.headline;
      }

      const incomingIncidentNumber = report.incident_number ||
        (report.assessment as any)?.structured?.incident_number;
      if (incomingIncidentNumber && incomingIncidentNumber !== "null") {
        updatePayload.incident_number = incomingIncidentNumber;
      }

      const { error: updateError } = await supabase
        .from("herald_reports")
        .update(updatePayload)
        .eq("id", parentId);

      if (updateError) {
        console.error("Update parent error:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update incident state" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: parentData, error: parentDataError } = await supabase
        .from("herald_reports")
        .select("transmission_count")
        .eq("id", parentId)
        .single();

      if (parentDataError) {
        console.error("Read parent transmission_count error:", parentDataError);
        return new Response(
          JSON.stringify({ error: "Failed to read incident counters" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (parentData && insertedNewTransmission) {
        const nextTransmissionCount = Math.max((parentData.transmission_count ?? 0) + 1, 2);
        const { error: countUpdateError } = await supabase
          .from("herald_reports")
          .update({ transmission_count: nextTransmissionCount })
          .eq("id", parentId);
        if (countUpdateError) {
          console.error("Update transmission_count error:", countUpdateError);
          return new Response(
            JSON.stringify({ error: "Failed to update incident counters" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const { data: parentMeta } = await supabase
        .from("herald_reports")
        .select("incident_number")
        .eq("id", parentId)
        .maybeSingle();

      await supabase.from("audit_log").insert({
        action: "incident_updated",
        trust_id: report.trust_id || null,
        details: {
          report_id: parentId,
          incident_number: parentMeta?.incident_number ?? null,
          callsign: report.session_callsign ?? null,
          shift_id: report.shift_id ?? null,
          headline: report.headline ?? null,
          updated_at: report.timestamp ?? new Date().toISOString(),
        },
      });

      if (report.shift_id && typeof report.shift_id === "string") {
        await setShiftOnIncident(supabase, report.shift_id, parentId);
      }

      return new Response(
        JSON.stringify({ ok: true, follow_up: true, parent_id: parentId }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- NEW REPORT ---
    const { follow_up_of, ...reportData } = report;

    if (reportData.assessment && typeof reportData.assessment === 'object') {
      reportData.assessment = normalizeAssessmentForMerge(reportData.assessment as Record<string, unknown>);
    }

    await ensureIncidentNumber(supabase, reportData);
    reportData.status = "active";
    reportData.latest_transmission_at = reportData.latest_transmission_at || report.timestamp;
    reportData.transmission_count = reportData.transmission_count || 1;
    delete (reportData as any).priority;

    if (typeof reportData.id === "string") {
      const patientIdsByCasualtyKey = await ensureIncidentPatientsForAssessment(
        supabase,
        reportData.id,
        reportData.assessment as Record<string, unknown> | null | undefined,
      );
      reportData.assessment = embedPatientIdsInAssessment(
        reportData.assessment as Record<string, unknown> | null | undefined,
        patientIdsByCasualtyKey,
      ) as Record<string, unknown>;
    }

    const { error } = await supabase.from("herald_reports").upsert(reportData, {
      onConflict: "id",
    });

    if (error) {
      console.error("Insert error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to save report" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("incident_transmissions").insert({
      report_id: reportData.id,
      timestamp: reportData.timestamp,
      transcript: reportData.transcript ?? null,
      assessment: reportData.assessment ?? null,
      priority: reportData.priority ?? null,
      headline: reportData.headline ?? null,
      operator_id: reportData.session_operator_id ?? null,
      session_callsign: reportData.session_callsign ?? null,
      trust_id: reportData.trust_id ?? null,
    });

    await supabase.from("audit_log").insert({
      action: "incident_created",
      trust_id: report.trust_id || null,
      details: {
        report_id: report.id,
        incident_number: reportData.incident_number ?? null,
        callsign: report.session_callsign ?? null,
        shift_id: report.shift_id ?? null,
        headline: report.headline ?? null,
        created_at: report.timestamp ?? new Date().toISOString(),
      },
    });

    if (reportData.shift_id && typeof reportData.shift_id === "string" && typeof reportData.id === "string") {
      await setShiftOnIncident(supabase, reportData.shift_id, reportData.id);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ error: "Sync failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

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

      // Intentionally no "single candidate fallback" here.
      // A lone active incident in the time window is not enough signal and can
      // incorrectly merge the next callout into an existing incident.
    }
  }

  return null;
}

async function enforceSingleActiveIncidentForShift(
  supabase: ReturnType<typeof createClient>,
  report: Record<string, unknown>,
  candidateParentId: string | null,
): Promise<{ parentId: string | null; error?: string }> {
  const shiftId = (report.shift_id as string) || null;
  if (!shiftId) {
    return { parentId: candidateParentId };
  }

  const { data: shift } = await supabase
    .from("shifts")
    .select("id, ended_at, active_report_id")
    .eq("id", shiftId)
    .maybeSingle();

  if (!shift || shift.ended_at) {
    return { parentId: null, error: "Shift not found or ended" };
  }

  if (shift.active_report_id) {
    const { data: activeReport } = await supabase
      .from("herald_reports")
      .select("id, status")
      .eq("id", shift.active_report_id)
      .maybeSingle();
    if (activeReport?.status === "active") {
      // Active assignment on the shift is authoritative.
      return { parentId: shift.active_report_id };
    }

    // Shift had stale pointer -> clear and allow fresh incident assignment.
    await supabase
      .from("shifts")
      .update({ active_report_id: null, crew_status: "available" })
      .eq("id", shiftId)
      .is("ended_at", null);
  }

  // No active assignment for this shift, so force a NEW incident.
  // This prevents an old still-open report (e.g. transferred-out patient)
  // from absorbing a new call just because callsign/time matched.
  return { parentId: null };
}

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

function actionItemsMatch(a: string, b: string, catA: string, catB: string): boolean {
  if (catA && catB && catA === catB) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

const NON_CLINICAL_TREATMENT_PATTERNS = [
  /extrication/i,
  /fire\s*(service|crew)/i,
  /police/i,
  /awaiting/i,
  /request(ed|ing)?/i,
  /hems\s*(request|requested|tasking|confirmation|acknowledgement|acknowledgment)/i,
  /not\s+yet\s+confirmed/i,
];

const VITALS_SIGNAL_PATTERN = /(gcs|\bhr\b|heart\s*rate|\brr\b|resp(iratory)?\s*rate|spo2|sats?|\bbp\b|blood\s*pressure|pulse)/i;

const MECHANISM_KEYWORDS = [
  'mechanism', 'moi', 'rtc', 'rta', 'collision', 'impact', 'rollover',
  'head-on', 'intrusion', 'hgv', 'lorry', 'truck', 'car', 'cars', 'vehicle',
  'van', 'motorbike', 'motorcycle', 'bike', 'pedestrian', 'struck',
];

const MECHANISM_CONCRETE_KEYWORDS = [
  'hgv', 'lorry', 'truck', 'car', 'cars', 'van', 'motorbike', 'motorcycle', 'bike', 'pedestrian', 'head-on',
];

function extractFromFormattedReport(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value && !isPlaceholder(value)) return value;
  }
  return undefined;
}

function firstNonPlaceholder(...values: unknown[]): unknown {
  for (const value of values) {
    if (!isPlaceholder(value)) return value;
  }
  return undefined;
}

function normalizeAssessmentForMerge(raw: Record<string, unknown>): any {
  if (!raw || typeof raw !== 'object') return {};

  const normalized: Record<string, unknown> = { ...raw };
  const structuredRaw = normalized.structured;
  const structured: Record<string, unknown> =
    structuredRaw && typeof structuredRaw === 'object' && !Array.isArray(structuredRaw)
      ? { ...(structuredRaw as Record<string, unknown>) }
      : {};

  const formattedReport = typeof normalized.formatted_report === 'string' ? normalized.formatted_report : '';

  const hazards = firstNonPlaceholder(
    structured.hazards,
    structured.H,
    normalized.methane_hazards,
    extractFromFormattedReport(formattedReport, [
      /(?:^|\n)\s*H(?:azards?)?\s*[:?-]\s*(.+)$/im,
      /(?:^|\n)\s*Hazards?\??\s*(.+)$/im,
    ]),
  );

  const access = firstNonPlaceholder(
    structured.access,
    structured.access_routes,
    structured.A,
    normalized.methane_access,
    extractFromFormattedReport(formattedReport, [
      /(?:^|\n)\s*A(?:ccess(?:\s*routes?)?)?\s*[:?-]\s*(.+)$/im,
      /(?:^|\n)\s*Access(?:\s*routes?)?\??\s*(.+)$/im,
    ]),
  );

  const numberOfCasualties = firstNonPlaceholder(
    structured.number_of_casualties,
    structured.num_casualties,
    structured.casualties,
    structured.N,
    normalized.methane_number,
    extractFromFormattedReport(formattedReport, [
      /(?:^|\n)\s*N(?:umber\s*of\s*casualties)?\s*[:?-]\s*(.+)$/im,
      /(?:^|\n)\s*Number\s*of\s*casualties\??\s*(.+)$/im,
      /(?:^|\n)\s*Casualties\??\s*(.+)$/im,
    ]),
  );

  const emergencyServices = firstNonPlaceholder(
    structured.emergency_services,
    structured.e_services,
    structured.E_services,
    structured.E,
    normalized.methane_emergency,
    extractFromFormattedReport(formattedReport, [
      /(?:^|\n)\s*Emergency\s*services\??\s*(.+)$/im,
      /(?:^|\n)\s*E(?:mergency\s*services?)?\s*[:?-]\s*(.+)$/im,
    ]),
  );

  if (hazards !== undefined) structured.hazards = hazards;
  if (access !== undefined) structured.access = access;
  if (numberOfCasualties !== undefined) structured.number_of_casualties = numberOfCasualties;
  if (emergencyServices !== undefined) structured.emergency_services = emergencyServices;

  // Retrospective validity scrub: clear invalid access/emergency_services even from existing data
  if (structured.access && !isValidAccessValue(structured.access)) {
    structured.access = null;
  }
  if (structured.access_routes && !isValidAccessValue(structured.access_routes)) {
    structured.access_routes = null;
  }
  if (structured.emergency_services && !isValidEmergencyServicesValue(structured.emergency_services)) {
    structured.emergency_services = null;
  }

  if (Object.keys(structured).length > 0) {
    normalized.structured = structured;
  }

  return normalized;
}

// Fields that, once set to true, must never be downgraded by a follow-up
const STICKY_TRUE_FIELDS = new Set(['major_incident']);

// METHANE fields that must not be overwritten by placeholder/silent follow-up values.
const METHANE_PRESERVE_FIELDS = new Set([
  'methane_major', 'methane_exact', 'methane_type',
  'methane_hazards', 'methane_access', 'methane_number', 'methane_emergency',
  'hazards', 'access', 'access_routes',
  'num_casualties', 'number_of_casualties', 'casualties',
  'emergency_services', 'e_services', 'E_services',
  'H', 'A', 'N', 'E',
]);

// Access field validity: only preserve if it contains actual access-route content
const ACCESS_ROUTE_PATTERN = /\b(east|west|north|south|clear|avoid|rear|front|via|door|entry|entrance|approach|access|driveway|gate|path|lane|road|street|avenue|drive|a\d{1,4}|m\d{1,3}|junction|slip|roundabout|westbound|eastbound|northbound|southbound)\b/i;

function isValidAccessValue(value: unknown): boolean {
  if (typeof value !== 'string' || isPlaceholder(value)) return false;
  return ACCESS_ROUTE_PATTERN.test(value);
}

// Emergency services field validity: must reference services/agencies, not clinical data
const EMERGENCY_SERVICES_PATTERN = /\b(ambulance|police|fire|hems|air\s*ambulance|coast\s*guard|mountain\s*rescue|sar|search\s*and\s*rescue|hazmat|on\s*scene|en\s*route|eta|dispatched|requested|attending|confirmed|arrived|stood\s*down|crew|unit|engine|officer|paramedic|technician|emt)\b/i;
const CLINICAL_DATA_PATTERN = /\b(gcs|spo2|bp\s*\d|pulse\s*\d|resp\s*rate|heart\s*rate|fracture|laceration|wound|bleed|haemorrhage|hemorrhage|tourniquet|splint|cannula|intubat|ventilat|adrenaline|morphine|ketamine|fentanyl|midazolam|saline|fluid|iv\s*access|chest\s*seal|airway|breathing|circulation|disability|exposure|pupils|reactive|consciousness|unconscious|responsive|unresponsive|cpr|defibrillat|rosc|arrest|resuscitat)\b/i;

function isValidEmergencyServicesValue(value: unknown): boolean {
  if (typeof value !== 'string' || isPlaceholder(value)) return false;
  // Contains clinical data but no emergency services keywords → invalid
  if (CLINICAL_DATA_PATTERN.test(value) && !EMERGENCY_SERVICES_PATTERN.test(value)) return false;
  return EMERGENCY_SERVICES_PATTERN.test(value);
}

// Scene location: protect against truncation (losing house number)
const HOUSE_NUMBER_PATTERN = /^\d+[a-zA-Z]?\s/;

function shouldKeepExistingSceneLocation(existing: unknown, incoming: unknown): boolean {
  if (typeof existing !== 'string' || isPlaceholder(existing)) return false;
  if (typeof incoming !== 'string' || isPlaceholder(incoming)) return true;
  // If existing has a house number and incoming doesn't, keep existing
  if (HOUSE_NUMBER_PATTERN.test(existing) && !HOUSE_NUMBER_PATTERN.test(incoming)) return true;
  // If incoming is shorter (less specific), keep existing
  if (incoming.length < existing.length) return true;
  return false;
}

const INCIDENT_TYPE_KEY = 'incident_type';

const PLACEHOLDER_VALUES = new Set([
  'not declared', 'none reported', 'not reported', 'unknown',
  'not stated', 'not mentioned', 'none', 'n/a', 'none stated',
  'none mentioned', 'not specified', 'not provided', 'not available',
  'none known', 'none identified', 'no hazards reported',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[.;:!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function isTrueLike(value: unknown): boolean {
  return value === true || (typeof value === 'string' && normalizeText(value) === 'true');
}

function isPlaceholder(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || value === '—') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    if (/^(not\s+(declared|reported|stated|mentioned|specified|provided|available|known|assessed))(\b|\s*-)/.test(normalized)) return true;
    if (/^none(\s+(reported|stated|mentioned|specified|provided|known|identified))?(\b|\s*-)/.test(normalized)) return true;
    if (PLACEHOLDER_VALUES.has(normalized)) return true;
    if (/^not\s+(declared|reported|stated|mentioned|specified|provided|available|known)$/.test(normalized)) return true;
    if (/^none(\s+(reported|stated|mentioned|specified|provided|known|identified))?$/.test(normalized)) return true;
    if (/^no\s+(hazards?|access|casualt(y|ies)|emergency\s+services?)\s+(reported|stated|declared|specified)$/.test(normalized)) return true;
  }
  return false;
}

function hasMechanismEvidenceInTranscript(transcript: string, value: string): boolean {
  const t = normalizeText(transcript || '');
  const v = normalizeText(value || '');
  if (!t || !v) return false;

  const valueKeywords = MECHANISM_KEYWORDS.filter((k) => v.includes(k));
  if (valueKeywords.length === 0) {
    return /\bmechanism\b|\bmoi\b/.test(t);
  }

  const concrete = valueKeywords.filter((k) => MECHANISM_CONCRETE_KEYWORDS.includes(k));
  if (concrete.length > 0) {
    return concrete.some((k) => t.includes(k));
  }

  return valueKeywords.some((k) => t.includes(k));
}

function shouldKeepExistingAtmistField(
  fieldKey: string,
  existingValue: unknown,
  incomingValue: unknown,
  transcript: string,
): boolean {
  if (isPlaceholder(existingValue)) return false;
  if (isPlaceholder(incomingValue)) return true;

  if (fieldKey === 'M' && typeof incomingValue === 'string') {
    if (!hasMechanismEvidenceInTranscript(transcript, incomingValue)) {
      return true;
    }
  }

  if (fieldKey === 'S' && typeof existingValue === 'string' && typeof incomingValue === 'string') {
    if (VITALS_SIGNAL_PATTERN.test(existingValue) && !VITALS_SIGNAL_PATTERN.test(incomingValue)) {
      return true;
    }
  }

  if (fieldKey === 'T_treatment' && typeof incomingValue === 'string') {
    if (NON_CLINICAL_TREATMENT_PATTERNS.some((p) => p.test(incomingValue))) {
      return true;
    }
  }

  return false;
}

function extractCasualtySegments(value: string): Map<string, string> {
  const segments = new Map<string, string>();
  const regex = /\b(P[1-4](?:-\d+)?)\s*:\s*([\s\S]*?)(?=\s+\bP[1-4](?:-\d+)?\s*:|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    const key = match[1].toUpperCase();
    const text = match[2].trim();
    if (text) segments.set(key, text);
  }

  return segments;
}

function isClinicalNoUpdateSegment(value: string): boolean {
  const text = normalizeText(value);
  return /^(not assessed( in this update)?|not stated|unknown|no update)/.test(text);
}

function mergeClinicalFieldValues(existingValue: unknown, incomingValue: unknown): unknown {
  if (typeof existingValue !== 'string' || typeof incomingValue !== 'string') {
    return incomingValue;
  }

  const existingSegments = extractCasualtySegments(existingValue);
  const incomingSegments = extractCasualtySegments(incomingValue);

  if (existingSegments.size === 0 || incomingSegments.size === 0) {
    if (!isPlaceholder(existingValue) && isPlaceholder(incomingValue)) {
      return existingValue;
    }
    return incomingValue;
  }

  const orderedKeys = Array.from(new Set([...existingSegments.keys(), ...incomingSegments.keys()]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const mergedParts: string[] = [];
  for (const key of orderedKeys) {
    const incomingSegment = incomingSegments.get(key);
    const existingSegment = existingSegments.get(key);

    if (incomingSegment && !isClinicalNoUpdateSegment(incomingSegment)) {
      mergedParts.push(`${key}: ${incomingSegment}`);
      continue;
    }

    if (existingSegment) {
      mergedParts.push(`${key}: ${existingSegment}`);
      continue;
    }

    if (incomingSegment) {
      mergedParts.push(`${key}: ${incomingSegment}`);
    }
  }

  return mergedParts.length > 0 ? mergedParts.join('. ') : incomingValue;
}

function mergeClinicalFindings(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = mergeShallow(existing, incoming);
  for (const key of ['A', 'B', 'C', 'D', 'E']) {
    if (key in existing && key in incoming) {
      merged[key] = mergeClinicalFieldValues(existing[key], incoming[key]);
    }
  }
  return merged;
}

function incidentTypeSeverity(value: string): number {
  const text = normalizeText(value);
  if (/(multi\s*-?\s*casualty|mass\s*-?\s*casualty|major incident|\bmci\b)/.test(text)) return 5;
  if (/(cardiac arrest|traumatic arrest|arrest)/.test(text)) return 4;
  if (/(major trauma|polytrauma|entrap|collapse|explosion|fire)/.test(text)) return 3;
  if (/(rtc|trauma|respiratory|stroke|obstetric|psychiatric|fall)/.test(text)) return 2;
  return 1;
}

function isBroadIncidentType(value: string): boolean {
  const text = normalizeText(value);
  return /(multi\s*-?\s*casualty|mass\s*-?\s*casualty|major incident|\bmci\b)/.test(text);
}

function incidentTypeSpecificity(value: string): number {
  return normalizeText(value)
    .split(/\s*[-–—:]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function shouldKeepExistingIncidentType(existing: unknown, incoming: unknown): boolean {
  if (typeof existing !== 'string' || isPlaceholder(existing)) return false;
  if (typeof incoming !== 'string') return true;
  if (isPlaceholder(incoming)) return true;

  const existingNorm = normalizeText(existing);
  const incomingNorm = normalizeText(incoming);
  if (!existingNorm || existingNorm === incomingNorm) return false;

  const existingBroad = isBroadIncidentType(existingNorm);
  const incomingBroad = isBroadIncidentType(incomingNorm);
  if (existingBroad && !incomingBroad) return true;

  const existingSeverity = incidentTypeSeverity(existingNorm);
  const incomingSeverity = incidentTypeSeverity(incomingNorm);
  if (incomingSeverity < existingSeverity) return true;

  const existingBase = existingNorm.split(/\s*[-–—:]\s*/)[0];
  const incomingBase = incomingNorm.split(/\s*[-–—:]\s*/)[0];
  if (existingBase === incomingBase && incomingSeverity === existingSeverity) {
    if (incidentTypeSpecificity(incomingNorm) > incidentTypeSpecificity(existingNorm)) {
      return true;
    }
  }

  return false;
}

function mergeShallow(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    // Skip null/empty/dash — silence means no change
    if (value === null || value === undefined || value === '' || value === '—') continue;

    // Sticky boolean fields: once true, never revert to false/null/placeholder in follow-ups
    if (STICKY_TRUE_FIELDS.has(key) && result[key] === true && !isTrueLike(value)) continue;

    // patient_name: preserve once set, never overwrite with placeholder
    if (key === 'patient_name') {
      if (!isPlaceholder(result[key]) && isPlaceholder(value)) continue;
    }

    // safeguarding: once concern_identified is true, never revert; merge details additively
    if (key === 'safeguarding') {
      const existing = result[key] as any;
      const incoming = value as any;
      if (existing?.concern_identified === true) {
        if (!incoming || incoming.concern_identified !== true) continue;
        // Merge: keep existing details if incoming is empty, combine flags
        result[key] = {
          concern_identified: true,
          details: incoming.details || existing.details,
          police_requested: existing.police_requested || incoming.police_requested || false,
          referral_required: existing.referral_required || incoming.referral_required || false,
        };
        continue;
      }
    }

    // incident_type can only broaden/escalate, never downgrade/specialize
    if (key === INCIDENT_TYPE_KEY && shouldKeepExistingIncidentType(result[key], value)) continue;

    // scene_location: protect against truncation
    if (key === 'scene_location' && shouldKeepExistingSceneLocation(result[key], value)) continue;

    // METHANE access field: only preserve if existing value is valid access-route content
    if ((key === 'access' || key === 'access_routes') && METHANE_PRESERVE_FIELDS.has(key)) {
      // Retrospectively clear invalid access values
      if (!isValidAccessValue(result[key])) {
        // Existing is invalid — allow overwrite or clear
        if (isPlaceholder(value)) {
          result[key] = null;
          continue;
        }
      } else if (isPlaceholder(value)) {
        continue; // existing is valid, incoming is placeholder — preserve
      }
    // METHANE emergency_services field: only preserve if valid service content
    } else if ((key === 'emergency_services' || key === 'e_services' || key === 'E_services' || key === 'E') && METHANE_PRESERVE_FIELDS.has(key)) {
      if (!isValidEmergencyServicesValue(result[key])) {
        if (isPlaceholder(value)) {
          result[key] = null;
          continue;
        }
      } else if (isPlaceholder(value)) {
        continue;
      }
    } else if (METHANE_PRESERVE_FIELDS.has(key) && !isPlaceholder(result[key]) && isPlaceholder(value)) {
      continue;
    }

    result[key] = value;
  }
  return result;
}

function deepMergeCasualtyMap(
  existing: Record<string, Record<string, unknown>>,
  incoming: Record<string, Record<string, unknown>>,
  transcript: string,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [key, val] of Object.entries(existing)) {
    result[key] = { ...val };
  }

  for (const [key, incomingCasualty] of Object.entries(incoming)) {
    if (!incomingCasualty || typeof incomingCasualty !== 'object') continue;
    if (!result[key]) {
      result[key] = { ...incomingCasualty };
    } else {
      const existingCasualty = result[key];
      const mergedCasualty = mergeShallow(
        existingCasualty,
        incomingCasualty as Record<string, unknown>,
      );

      for (const [fieldKey, incomingValue] of Object.entries(incomingCasualty as Record<string, unknown>)) {
        if (shouldKeepExistingAtmistField(fieldKey, existingCasualty[fieldKey], incomingValue, transcript)) {
          mergedCasualty[fieldKey] = existingCasualty[fieldKey];
        }
      }

      result[key] = mergedCasualty;
    }
  }

  return result;
}


