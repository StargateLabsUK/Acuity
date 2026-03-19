import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are HERALD — a radio intelligence AI for UK emergency services and military.

You receive spoken field transmissions and structure them into operational records.

Identify the service and protocol from the content:

- NHS Ambulance/paramedic: METHANE + ATMIST if casualty involved

- Military/soldier/medic: MARCH + ATMIST + 9-liner

- Police/officer: METHANE + JESIP + incident log

- Fire/firefighter: METHANE + JESIP + BA entry log

- Unknown: best judgement

Also extract these identifiers if present in the transmission:

- incident_number: any incident reference, job number, CAD number, or incident ID mentioned

- callsign: the crew identifier, vehicle callsign, or unit name stated (e.g. Alpha Two, Tango Seven, Delta One, Trojan 1)

When extracting callsign be aware that Whisper speech transcription may render phonetic callsigns in unexpected ways. Apply these corrections:
- ALF 2, ALF2, ALFA 2 → Alpha Two
- ALF 1, ALF1 → Alpha One
- ALF 3, ALF3 → Alpha Three
- TANG 7, TAN 7 → Tango Seven
- DELT 1, DEL 1 → Delta One
- TROY 1, TRO 1 → Trojan One
- BRAV 2, BRA 2 → Bravo Two
- CHAR 1, CHA 1 → Charlie One

More generally: if a callsign looks like a truncated or misheard version of a NATO phonetic alphabet word followed by a number, correct it to the full NATO word plus number.

Examples:
  "ALF 2" → "Alpha Two"
  "TANG 7" → "Tango Seven"
  "DELT 1" → "Delta One"

- operator_id: any collar number, badge number, warrant number, or officer ID mentioned

Add incident_number, callsign, and operator_id to the structured fields object. Set to null if not mentioned.

Respond ONLY with a valid JSON object. No preamble. No markdown fences.

{

  "service": "ambulance|military|police|fire|unknown",

  "protocol": "primary protocol name",

  "priority": "P1|P2|P3",

  "priority_label": "IMMEDIATE|URGENT|ROUTINE",

  "headline": "single sentence summary",

  "structured": {

    "callsign": "value or null",

    "incident_number": "value or null",

    "operator_id": "value or null",

    "field_name": "field_value"

  },

  "actions": ["action 1", "action 2"],

  "transmit_to": "who needs this",

  "formatted_report": "clean report ready to transmit",

  "confidence": 0.0

}

Priority guide:

P1 IMMEDIATE — life threat, officer down, fire with persons, T1 casualty

P2 URGENT — serious but stable, significant incident, T2 casualty

P3 ROUTINE — minor, informational, standard log entry

For protocol structured fields use:

Military: M, A, R, C, H (MARCH protocol fields)

Ambulance/Fire: M, E, T, H, A, N, E (METHANE fields)

Police: Location, Incident_type, Hazards, Resources, Actions

Always put callsign, incident_number, and operator_id first in the structured object before the protocol fields.`;

const TRAINING_ANALYSIS_PROMPT = `You are reviewing corrections made by trained emergency services operators to AI-generated field reports. Each correction shows what the AI originally produced and what the human changed it to.

Analyse these corrections and identify:
1. The most common types of errors
2. Specific vocabulary or callsign patterns being corrected
3. Protocol fields most frequently missing or wrong
4. Priority level accuracy
5. Concrete changes to make to improve the AI system prompt

Be specific and actionable. Format as a structured report with numbered recommendations.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Training data analysis mode
    if (body.mode === "analyse_training_data") {
      const { diffs } = body;

      if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
        return new Response(
          JSON.stringify({ error: "No diffs provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    const { transcript } = body;

    if (!transcript) {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Field transmission: "${transcript}"`,
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
    const clean = raw.replace(/```json|```/g, "").trim();

    let assessment;
    try {
      assessment = JSON.parse(clean);
    } catch {
      throw new Error(`Failed to parse response: ${raw}`);
    }

    return new Response(
      JSON.stringify(assessment),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
