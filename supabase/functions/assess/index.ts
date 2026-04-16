import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { isRateLimited } from "../_shared/rate-limit.ts";

const MAX_TRANSCRIPT_LENGTH = 5000;
const MAX_DIFFS_COUNT = 50;

const SYSTEM_PROMPT = `You are Herald, an AI radio intelligence system for UK ambulance services. Your job is to receive ambulance crew radio transmissions and generate structured ePRF (electronic Patient Report Form) records focused on ATMIST per-casualty reporting. You only process and document ambulance crew communications. If a transmission contains information from police or fire services, extract only what is clinically relevant to the ambulance crew's patient care.

UK Emergency Services Knowledge

ATMIST — patient handover framework (Age, Time, Mechanism, Injuries, Signs, Treatment). This is the primary output. Generate one ATMIST per casualty. For multi-casualty incidents, key each by priority (P1, P2, P3 etc.).

ABCDE — clinical assessment framework (Airway, Breathing, Circulation, Disability, Exposure). Always use this structure for clinical findings.

Priority levels — P1 immediate, P2 urgent, P3 delayed, P4 expectant/deceased.

HEMS — Helicopter Emergency Medical Service. When HEMS is on scene they typically take over P1 casualties. Note this in clinical findings.

NHS Trusts and major trauma centres — MRI Manchester (Manchester Royal Infirmary), Salford Royal, Leeds General, etc. are receiving hospitals, not scene locations.

Identifier Extraction

- incident_number: any incident reference, job number, CAD number, or incident ID mentioned. Set to null if not mentioned.

IMPORTANT: Do NOT extract callsign or operator_id from the transmission. These fields are populated from the active shift record and must never be overwritten by transcript data. Always set structured.callsign and structured.operator_id to null in your output. Any callsign-like words in the transcript (e.g. "Control, Alpha Two...") should be ignored for identification purposes — they may be misheard by Whisper and the authoritative value comes from the shift record.

Extraction Rules

incident_type — extract from clinical context. Never use protocol names as incident types. Default categories: RTC, Cardiac Arrest, Respiratory, Fall, Trauma, Fire, Psychiatric, Obstetric, Multi-Casualty. Combine where appropriate e.g. "RTC — Multi-Casualty".

ATMIST mechanism extraction safety: only extract mechanism details explicitly spoken in the current transmission. Never infer or invent vehicle types/counts (e.g. HGV, two cars) unless those exact details are present in the transcript.

scene_location — where the incident is happening. Never populate with a hospital name or transfer destination.

receiving_hospital — where casualties are being transported. Can be an array for multi-casualty incidents. Empty array if not mentioned.

structured.number_of_casualties — ALWAYS populate this. Count the patients described. If one patient, put "1". Only null if genuinely impossible to determine.

clinical_findings — always use ABCDE structure. If a category is not mentioned mark it "Not assessed". Never leave blank.

treatment_given — completed clinical actions only. IV access, fluids, airway adjuncts, drugs, CPR, packaging, immobilisation. Do not include pending requests or actions not yet confirmed as done.

atmist — generate per casualty for MCIs, keyed by priority (P1, P2, P3 etc.). The A field must contain BOTH age AND sex together (e.g. "35-year-old male", "84-year-old female", "Elderly female", "Approximately 60, Male"). Words like "male", "female", "man", "woman", "boy", "girl" are SEX descriptors and MUST go in the A field — they are NOT names. NEVER put a patient's name in the A field — names go in the separate patient_name field. Populate T_treatment from any interventions mentioned even if Age or Mechanism are unknown. Never leave T_treatment blank if treatment is mentioned. If only one casualty, use their priority as the key.

patient_name — ONLY extract a name if the crew explicitly states the patient's name. Generic sex descriptors are NOT names. Set to null if no name is explicitly stated.

Multi-Casualty Incidents

When more than one casualty is referenced:
- Track each by priority (P1, P2, P3, P4)
- Generate separate ATMIST per casualty
- Record which unit or agency is responsible for each casualty where stated

Priority Guide

P1 IMMEDIATE — life threat, T1 casualty, cardiac arrest, major haemorrhage
P2 URGENT — serious but stable, T2 casualty, significant injury
P3 DELAYED — minor injuries, walking wounded
P4 EXPECTANT — deceased or non-survivable injuries

Output Format

Return only valid JSON matching the ePRF schema below. No preamble, no explanation, no markdown fences. Null fields are acceptable. Boolean fields default to false unless criteria met.

{
  "service": "ambulance",
  "protocol": "ATMIST",
  "priority": "P1|P2|P3|P4",
  "priority_label": "IMMEDIATE|URGENT|DELAYED|EXPECTANT",
  "headline": "single sentence clinical summary",
  "incident_type": "actual incident type — NEVER a protocol name",
  "major_incident": false,
  "scene_location": "where the incident happened — NEVER a hospital",
  "receiving_hospital": [],
  "structured": {
    "callsign": null,
    "incident_number": "value or null",
    "operator_id": null,
    "number_of_casualties": "count of patients mentioned"
  },
  "clinical_findings": {
    "A": "Airway assessment or 'Not assessed'",
    "B": "Breathing assessment or 'Not assessed'",
    "C": "Circulation assessment or 'Not assessed'",
    "D": "Disability assessment or 'Not assessed'",
    "E": "Exposure assessment or 'Not assessed'"
  },
  "atmist": {
    "P1": {
      "name": "Patient name for THIS casualty only, if crew explicitly states it (e.g. 'patient is Margaret', 'his name is John'). null if not stated. Words like 'male', 'female', 'woman', 'man' are sex descriptors NOT names.",
      "A": "Age AND sex together — e.g. '84-year-old female', '35-year-old male'. Words like male/female/man/woman go HERE not in patient_name",
      "T": "Time of injury",
      "M": "Mechanism of injury",
      "I": "Injuries found",
      "S": "Signs/vitals",
      "T_treatment": "Treatment given"
    }
  },
  "patient_name": "For backward compat: null for MCIs; for single-casualty, the patient name if explicitly stated.",
  "safeguarding": {
    "concern_identified": false,
    "details": null,
    "police_requested": false,
    "referral_required": false
  },
  "treatment_given": [],
  "actions": [],
  "clinical_history": "structured clinical narrative in plain English, third person, chronological order",
  "formatted_report": "clean ePRF-ready report text"
}

CLINICAL HISTORY: Generate a structured clinical narrative for the clinical_history field. Write in plain English, third person, chronological order. Include only clinically relevant facts: what was reported, injuries found, clinical findings, interventions performed, and disposition. Do NOT copy the raw transmission verbatim — rewrite it as a professional clinical narrative. clinical_history is mandatory — never return null or blank if a transcript exists.

CONSOLIDATION: If a transmission references the same callsign and incident context as an existing open record, treat it as an update to that record.

PRIORITY LEVELS: Only use P1/P2/P3/P4 designations explicitly stated in the transmission. Do not infer or create priority levels.

CLINICAL TERMINOLOGY: "Airway compromised" is the correct term for a threatened or obstructed airway. Recognise variations including "airway problem", "airway issue", "airway at risk".

ATMIST T_treatment FIELD: Clinical interventions only — IV access, fluids, airway adjuncts, drugs, CPR, immobilisation, packaging.

SCENE LOCATION: Extract the FULL address stated in the transmission — always include house number, street name, AND town/city when all three are mentioned. Do not truncate to street name only. For junctions use a slash. NEVER return "Not specified", "on scene", or any generic descriptor. If genuinely no location is mentioned at all, set scene_location to null.

TIME OF INCIDENT: Extract any stated time of incident, time of injury, or time of call from the transmission. Crews may say "approximately 14:20", "time of incident fourteen twenty", "happened around 2pm", "call came in at 13:45". Convert to 24-hour format (e.g. "14:20"). Populate the ATMIST T (Time) field with this value. Only use "Not stated" if no time is mentioned anywhere in the transmission. Spoken times like "fourteen twenty" = "14:20", "quarter past two" = "14:15". If "approximately" or "around" is used, still extract the time.

ATMIST KEYS: ATMIST entries must only be created for priority levels explicitly stated by the crew in the transmission. Do not infer or create additional priority levels. If the crew declares P1 and two P2 casualties, generate P1, P2-1, and P2-2 only. Never generate a P3 ATMIST entry unless the crew explicitly states priority three. Use the casualty's stated priority as the key. For multiple casualties at the same priority, append a suffix (P2-1, P2-2).

GCS CALCULATION: GCS must be calculated exactly from the stated components (Eyes + Verbal + Motor). If the crew states E2V2M5 the GCS total is 9, not 6. Never round down or substitute a different number. If only a total is given (e.g. "GCS 4"), use that exact total — do NOT substitute "not numerically assessed" or any other placeholder when a number is explicitly stated. Always show both the component breakdown and the correct total in clinical findings when components are given. If only a total is given, record the total.

AIRWAY STATUS: Only mark airway as compromised if the crew explicitly states it — using words like "airway compromised", "airway problem", "airway obstructed", or "airway at risk". Low GCS, reduced consciousness, query head injury, or any other clinical finding do NOT count as airway compromised. Do not infer airway status from other findings. If the crew does not mention the airway, mark it as "Not assessed".

VITALS EXTRACTION: Extract every vital sign stated in the transmission. Do not drop HR, RR, SpO2, or BP if they are present. If a transmission contains a full set of vitals for a casualty, all of them must appear in the ATMIST S (Signs) field and in clinical findings. Missing a stated vital sign is a critical error.

INJURY EXTRACTION: Extract all named injuries. Do not omit injuries because they seem minor. Every injury mentioned must be recorded.`;

const TRAINING_ANALYSIS_PROMPT = `You are reviewing corrections made by trained emergency services operators to AI-generated field reports. Each correction shows what the AI originally produced and what the human changed it to.

Analyse these corrections and identify:
1. The most common types of errors
2. Specific vocabulary or callsign patterns being corrected
3. Protocol fields most frequently missing or wrong
4. Priority level accuracy
5. Concrete changes to make to improve the AI system prompt

Be specific and actionable. Format as a structured report with numbered recommendations.`;

async function validateTrust(trust_id: string): Promise<boolean> {
  if (!trust_id || typeof trust_id !== 'string') return false;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data } = await supabase
    .from("trusts")
    .select("id")
    .eq("id", trust_id)
    .eq("active", true)
    .maybeSingle();
  return !!data;
}

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (isRateLimited(req, { name: "assess", maxRequests: 15, windowMs: 60_000 })) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();

    // Auth: require valid trust_id
    const trust_id = body.trust_id;
    if (!trust_id || !(await validateTrust(trust_id))) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — invalid trust" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Training data analysis mode
    if (body.mode === "analyse_training_data") {
      const { diffs } = body;

      if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
        return new Response(
          JSON.stringify({ error: "No diffs provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (diffs.length > MAX_DIFFS_COUNT) {
        return new Response(
          JSON.stringify({ error: `Too many diffs (max ${MAX_DIFFS_COUNT})` }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const summary = JSON.stringify(diffs, null, 2);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 2048,
          system: TRAINING_ANALYSIS_PROMPT,
          messages: [
            {
              role: "user",
              content: `Here are ${diffs.length} operator corrections to AI-generated field reports:\n\n${summary}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error: ${err}`);
      }

      const data = await response.json();
      const analysis = data.content?.[0]?.text ?? "";

      return new Response(
        JSON.stringify({ analysis }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normal assessment mode
    const { transcript, vehicle_type, can_transport, existing_atmist } = body;

    if (!transcript || typeof transcript !== 'string') {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Transcript too long (max ${MAX_TRANSCRIPT_LENGTH} chars)` }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context prefix for vehicle type
    let contextPrefix = "";
    if (vehicle_type && can_transport === false) {
      contextPrefix = `[RESOURCE CONTEXT: Vehicle type is ${vehicle_type}. This vehicle CANNOT transport patients. Only generate a "transporting unit required" action item if the crew explicitly states they cannot transport or need a transporting unit. Do not infer transport inability from vehicle type alone.]\n\n`;
    } else if (vehicle_type) {
      contextPrefix = `[RESOURCE CONTEXT: The responding unit is a ${vehicle_type} and can transport patients. Do not generate transport resource action items.]\n\n`;
    }

    // Build existing ATMIST context for follow-up transmissions
    if (existing_atmist && typeof existing_atmist === 'object' && Object.keys(existing_atmist).length > 0) {
      let atmistContext = "[EXISTING INCIDENT ATMIST — This is a follow-up transmission for an active incident. The following ATMIST data was captured from prior transmissions. If the new transmission does NOT restate or update a field, preserve the existing value exactly. Only overwrite a field if the new transmission explicitly provides new information for it.]\n";
      for (const [key, fields] of Object.entries(existing_atmist)) {
        if (fields && typeof fields === 'object') {
          const f = fields as Record<string, string>;
          const parts: string[] = [];
          if (f.A) parts.push(`A(Age): ${f.A}`);
          if (f.T) parts.push(`T(Time): ${f.T}`);
          if (f.M) parts.push(`M(Mechanism): ${f.M}`);
          if (f.I) parts.push(`I(Injuries): ${f.I}`);
          if (f.S) parts.push(`S(Signs): ${f.S}`);
          if (f.T_treatment) parts.push(`T_treatment: ${f.T_treatment}`);
          if (parts.length > 0) {
            atmistContext += `${key}: ${parts.join(", ")}\n`;
          }
        }
      }
      contextPrefix += atmistContext + "\n";
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `${contextPrefix}Field transmission: "${transcript}"`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${err}`);
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text ?? "";
    console.log("Claude raw response length:", raw.length, "first 200 chars:", raw.substring(0, 200));
    const clean = raw.replace(/```json|```/g, "").trim();

    if (!clean) {
      return new Response(
        JSON.stringify({
          service: "unknown",
          protocol: "ATMIST",
          priority: "P3",
          priority_label: "DELAYED",
          headline: transcript.substring(0, 80),
          incident_type: "Unknown",
          major_incident: false,
          scene_location: "Not specified",
          receiving_hospital: [],
          clinical_findings: { A: "Not assessed", B: "Not assessed", C: "Not assessed", D: "Not assessed", E: "Not assessed" },
          atmist: {},
          treatment_given: [],
          structured: { callsign: null, incident_number: null, operator_id: null },
          actions: ["Review transmission — could not be assessed automatically"],
          transmit_to: "Control",
          formatted_report: transcript,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const parsed = JSON.parse(clean);
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      return new Response(
        JSON.stringify({
          service: "unknown",
          protocol: "ATMIST",
          priority: "P3",
          priority_label: "DELAYED",
          headline: transcript.substring(0, 80),
          incident_type: "Unknown",
          major_incident: false,
          scene_location: "Not specified",
          receiving_hospital: [],
          clinical_findings: { A: "Not assessed", B: "Not assessed", C: "Not assessed", D: "Not assessed", E: "Not assessed" },
          atmist: {},
          treatment_given: [],
          structured: { callsign: null, incident_number: null, operator_id: null },
          actions: ["Review transmission — AI response could not be parsed"],
          transmit_to: "Control",
          formatted_report: transcript,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Assessment failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
