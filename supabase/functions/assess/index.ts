const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are Herald, a military-grade radio intelligence assessment system for UK emergency services.

Given a radio transmission transcript, produce a JSON assessment with these exact fields:
- service: one of "military", "ambulance", "police", "fire", "unknown"
- protocol: the communication protocol detected (e.g. "METHANE", "MIST", "JESIP", "9-liner")
- priority: "P1" (immediate life threat), "P2" (urgent), or "P3" (routine)
- priority_label: human readable label e.g. "IMMEDIATE", "URGENT", "ROUTINE"
- headline: one line operational summary, max 80 chars
- structured: object with protocol-specific key-value fields extracted from the transmission
- actions: array of 3-5 immediate actions required
- transmit_to: who this should be relayed to
- formatted_report: a properly formatted operational report in the style of the detected service
- confidence: 0.0-1.0 confidence in the assessment

Respond ONLY with valid JSON. No markdown, no explanation.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript } = await req.json();
    
    // Try OpenAI first, fall back to Anthropic
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

    let assessment;

    if (OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Assess this radio transmission:\n\n"${transcript}"` },
          ],
          temperature: 0.3,
        }),
      });

      if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
      const data = await res.json();
      const content = data.choices[0].message.content;
      assessment = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
    } else if (ANTHROPIC_API_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: `Assess this radio transmission:\n\n"${transcript}"` },
          ],
        }),
      });

      if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);
      const data = await res.json();
      const content = data.content[0].text;
      assessment = JSON.parse(content.replace(/```json\n?/g, '').replace(/```/g, '').trim());
    } else {
      throw new Error('No AI API key configured');
    }

    return new Response(JSON.stringify(assessment), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
