import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_AUDIO_BASE64_LENGTH = 8_000_000; // ~6MB base64 ≈ 4.5MB binary

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: verify caller has a valid trust session via trust_id
    const body = await req.json();
    const { audio, mimeType, trust_id } = body;

    if (!trust_id || typeof trust_id !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing trust_id' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate trust exists
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: trust } = await supabase
      .from('trusts')
      .select('id')
      .eq('id', trust_id)
      .eq('active', true)
      .maybeSingle();

    if (!trust) {
      return new Response(JSON.stringify({ error: 'Invalid trust' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Input validation
    if (!audio || typeof audio !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing audio data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (audio.length > MAX_AUDIO_BASE64_LENGTH) {
      return new Response(JSON.stringify({ error: 'Audio payload too large (max ~6MB)' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

    // Decode base64 to binary
    const binaryStr = atob(audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const mime = mimeType || 'audio/wav';
    const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'wav';
    const blob = new Blob([bytes], { type: mime });
    const formData = new FormData();
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error: ${err}`);
    }

    const data = await res.json();
    const raw = data.text as string;
    const { text: sanitised, corrections } = sanitiseTranscript(raw);
    if (corrections.length > 0) {
      console.log(`[sanitiseTranscript] ${corrections.length} correction(s): ${corrections.join('; ')}`);
    }

    return new Response(JSON.stringify({ transcript: sanitised }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Transcription failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── Transcript sanitisation ──────────────────────────────────────────

interface SanitiseResult {
  text: string;
  corrections: string[];
}

type Rule = {
  pattern: RegExp;
  replacement: string;
  label: string;
};

const RULES: Rule[] = [
  // 1. METHANE misreads (order matters — longer phrases first)
  { pattern: /\bstand\s*by\s+for\s+methane\s+methods\b/gi, replacement: 'standby for METHANE', label: 'methane-methods→METHANE' },
  { pattern: /\bstand\s*by\s+for\s+methods\b/gi, replacement: 'standby for METHANE', label: 'methods→METHANE' },
  { pattern: /\bmethane\s+methods\b/gi, replacement: 'METHANE', label: 'methane-methods→METHANE' },
  { pattern: /\bmethods\s+report\b/gi, replacement: 'METHANE report', label: 'methods-report→METHANE-report' },
  // Standalone "methods" when clearly used in a METHANE context
  { pattern: /\b(standby\s+for\s+)methods\b/gi, replacement: '$1METHANE', label: 'methods→METHANE' },

  // 2. Protocol term misreads
  { pattern: /\bat\s+miss(?:ed|t)\b/gi, replacement: 'ATMIST', label: 'at-mist→ATMIST' },

  // 3. Location misreads
  { pattern: /\bWrighton\s+Street\b/gi, replacement: 'Ryton Street', label: 'Wrighton→Ryton' },
  { pattern: /\bWorkstop\b/gi, replacement: 'Worksop', label: 'Workstop→Worksop' },

  // 4. Incident type misreads
  { pattern: /\blandscape\b(?=\s*(?:is|—|:|\.|,|\s+road\s+traffic|\s+rtc|\s+rta|\s+multi))/gi, replacement: 'type', label: 'landscape→type' },
];

// HGV false-positive: only remove if the transcript itself contains
// phrasing suggesting it's a mishear (high speed head-on / high velocity)
const HGV_FALSE_POSITIVE_CONTEXT = /\b(high[\s-]?speed\s+head[\s-]?on|high[\s-]?velocity|head[\s-]?on\s+collision)\b/i;
const HGV_GENUINE_CONTEXT = /\b(heavy\s+goods|lorr(y|ies)|artic(ulated)?|truck|haulage)\b/i;

function sanitiseTranscript(raw: string): SanitiseResult {
  let text = raw;
  const corrections: string[] = [];

  for (const rule of RULES) {
    const before = text;
    text = text.replace(rule.pattern, rule.replacement);
    if (text !== before) {
      corrections.push(rule.label);
    }
  }

  // HGV false detection
  if (/\bHGV\b/.test(text)) {
    const hasGenuine = HGV_GENUINE_CONTEXT.test(text);
    const hasFalsePositiveContext = HGV_FALSE_POSITIVE_CONTEXT.test(text);
    if (!hasGenuine && hasFalsePositiveContext) {
      text = text.replace(/\s*\bHGV\b\s*/g, ' ').replace(/\s{2,}/g, ' ');
      corrections.push('HGV-false-positive-removed');
    }
  }

  return { text: text.trim(), corrections };
}
