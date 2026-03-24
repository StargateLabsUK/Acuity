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
  { pattern: /\bat\s+mist\b/gi, replacement: 'ATMIST', label: 'at-mist→ATMIST' },
  { pattern: /\bat\s+missed\b/gi, replacement: 'ATMIST', label: 'at-missed→ATMIST' },
  { pattern: /\bAT\s+MIST\b/g, replacement: 'ATMIST', label: 'AT-MIST→ATMIST' },
  { pattern: /\bjesip\b/gi, replacement: 'JESIP', label: 'jesip→JESIP' },
  { pattern: /\bjessup\b/gi, replacement: 'JESIP', label: 'jessup→JESIP' },
  { pattern: /\bjessip\b/gi, replacement: 'JESIP', label: 'jessip→JESIP' },
  { pattern: /\bABCD\b(?!\s*E)/g, replacement: 'ABCDE', label: 'ABCD→ABCDE' },

  // 3. Location misreads
  { pattern: /\bWrighton\s+Street\b/gi, replacement: 'Ryton Street', label: 'Wrighton→Ryton' },
  { pattern: /\bWorkstop\b/gi, replacement: 'Worksop', label: 'Workstop→Worksop' },

  // 4. Incident type misreads
  { pattern: /\blandscape\b(?=\s*(?:is|—|:|\.|,|\s+road\s+traffic|\s+rtc|\s+rta|\s+multi))/gi, replacement: 'type', label: 'landscape→type' },

  // 5. Callsign misreads — NATO phonetic truncations
  { pattern: /\balf(?:a)?\s*(\d)\b/gi, replacement: 'Alpha $1', label: 'alf→Alpha' },
  { pattern: /\btang(?:o)?\s*(\d)\b/gi, replacement: 'Tango $1', label: 'tang→Tango' },
  { pattern: /\bdelt(?:a)?\s*(\d)\b/gi, replacement: 'Delta $1', label: 'delt→Delta' },
  { pattern: /\bbrav(?:o)?\s*(\d)\b/gi, replacement: 'Bravo $1', label: 'brav→Bravo' },
  { pattern: /\bchar(?:lie)?\s*(\d)\b/gi, replacement: 'Charlie $1', label: 'char→Charlie' },
  { pattern: /\btroy\s*(\d)\b/gi, replacement: 'Trojan $1', label: 'troy→Trojan' },
  { pattern: /\bDelta\s+far\b/gi, replacement: 'Delta 4', label: 'Delta-far→Delta-4' },
  { pattern: /\bDelta\s+for\b/gi, replacement: 'Delta 4', label: 'Delta-for→Delta-4' },
  { pattern: /\bDelta\s+fore\b/gi, replacement: 'Delta 4', label: 'Delta-fore→Delta-4' },

  // 6. Clinical term misreads
  { pattern: /\brespies\b/gi, replacement: 'resp rate', label: 'respies→resp-rate' },
  { pattern: /\brisp(?:ies|ees)\b/gi, replacement: 'resp rate', label: 'rispies→resp-rate' },
  { pattern: /\bsats?\s+(\d)/gi, replacement: 'SpO2 $1', label: 'sats→SpO2' },
  { pattern: /\bGCS\s+of\s+a\s+(\d+)\b/gi, replacement: 'GCS $1', label: 'GCS-of-a→GCS' },
  { pattern: /\bGlasgow\s+coma\s+scale\b/gi, replacement: 'GCS', label: 'glasgow-coma→GCS' },
  { pattern: /\btourniquet\b/gi, replacement: 'tourniquet', label: 'tourniquet-normalise' },
  { pattern: /\bturn[ai]kit\b/gi, replacement: 'tourniquet', label: 'turnakit→tourniquet' },
  { pattern: /\btournake?\b/gi, replacement: 'tourniquet', label: 'tournake→tourniquet' },
  { pattern: /\bnew\s*mo(?:nia|nea)\b/gi, replacement: 'pneumonia', label: 'neumonia→pneumonia' },
  { pattern: /\bnew\s*mo\s*thorax\b/gi, replacement: 'pneumothorax', label: 'neumo-thorax→pneumothorax' },
  { pattern: /\bhemo(?:rage|rhage|ridge)\b/gi, replacement: 'haemorrhage', label: 'hemorage→haemorrhage' },
  { pattern: /\bhemorrhage\b/gi, replacement: 'haemorrhage', label: 'hemorrhage→haemorrhage' },
  { pattern: /\bfemural\b/gi, replacement: 'femoral', label: 'femural→femoral' },
  { pattern: /\bcervical\s+collar\b/gi, replacement: 'cervical collar', label: 'c-collar-normalise' },
  { pattern: /\bsee\s+collar\b/gi, replacement: 'cervical collar', label: 'see-collar→c-collar' },
  { pattern: /\beye\s+gel\b/gi, replacement: 'iGel', label: 'eye-gel→iGel' },
  { pattern: /\bi\s+gel\b/gi, replacement: 'iGel', label: 'i-gel→iGel' },
  { pattern: /\bigel\b/gi, replacement: 'iGel', label: 'igel→iGel' },
  { pattern: /\bhigh\s+flow\s+(?:oh\s+two|o\s+two|02)\b/gi, replacement: 'high flow oxygen', label: 'o2→oxygen' },
  { pattern: /\b(\d+)\s+lit(?:re|er)s?\s+(?:oh\s+two|o\s+two|02)\b/gi, replacement: '$1 litres oxygen', label: 'litres-o2→oxygen' },
  { pattern: /\bBP\s*(\d+)\s+over\s+(\d+)\b/gi, replacement: 'BP $1/$2', label: 'BP-over→BP-slash' },
  { pattern: /\bbp(\d+)\s+over\s+(\d+)\b/gi, replacement: 'BP $1/$2', label: 'bp-over→BP-slash' },

  // 7. Common radio term misreads
  { pattern: /\breceiving\s+hostel\b/gi, replacement: 'receiving hospital', label: 'hostel→hospital' },
  { pattern: /\bcontrolled?\s*,?\s+this\s+is\b/gi, replacement: 'Control, this is', label: 'controlled→Control' },
  { pattern: /\bto\s+controlled?\b/gi, replacement: 'to Control', label: 'controlled→Control' },
  { pattern: /\bfired\b(?=\s+(not|service|crew|engine|on|are|is|have))/gi, replacement: 'fire', label: 'fired→fire' },
  { pattern: /\becho\s+(\d)\b/gi, replacement: 'Echo $1', label: 'echo-normalise' },
  { pattern: /\bzulu\s+(\d+)\b/gi, replacement: 'Zulu $1', label: 'zulu-normalise' },
  { pattern: /\bsierra\s+(\d)\b/gi, replacement: 'Sierra $1', label: 'sierra-normalise' },
  { pattern: /\bfoxtrot\s+(\d)\b/gi, replacement: 'Foxtrot $1', label: 'foxtrot-normalise' },
  { pattern: /\bgolf\s+(\d)\b/gi, replacement: 'Golf $1', label: 'golf-normalise' },
  { pattern: /\bhotel\s+(\d)\b/gi, replacement: 'Hotel $1', label: 'hotel-normalise' },
  { pattern: /\bindia\s+(\d)\b/gi, replacement: 'India $1', label: 'india-normalise' },
  { pattern: /\bjuliet\s+(\d)\b/gi, replacement: 'Juliet $1', label: 'juliet-normalise' },
  { pattern: /\bkilo\s+(\d)\b/gi, replacement: 'Kilo $1', label: 'kilo-normalise' },
  { pattern: /\blima\s+(\d)\b/gi, replacement: 'Lima $1', label: 'lima-normalise' },
  { pattern: /\bmike\s+(\d)\b/gi, replacement: 'Mike $1', label: 'mike-normalise' },
  { pattern: /\bnovember\s+(\d)\b/gi, replacement: 'November $1', label: 'november-normalise' },
  { pattern: /\boscar\s+(\d)\b/gi, replacement: 'Oscar $1', label: 'oscar-normalise' },
  { pattern: /\bpapa\s+(\d)\b/gi, replacement: 'Papa $1', label: 'papa-normalise' },
  { pattern: /\bromeo\s+(\d)\b/gi, replacement: 'Romeo $1', label: 'romeo-normalise' },
  { pattern: /\bvictor\s+(\d)\b/gi, replacement: 'Victor $1', label: 'victor-normalise' },
  { pattern: /\bwhiskey\s+(\d)\b/gi, replacement: 'Whiskey $1', label: 'whiskey-normalise' },
  { pattern: /\bx-?ray\s+(\d)\b/gi, replacement: 'X-ray $1', label: 'xray-normalise' },
  { pattern: /\byankee\s+(\d)\b/gi, replacement: 'Yankee $1', label: 'yankee-normalise' },

  // 8. HEMS misreads
  { pattern: /\bhems\b/gi, replacement: 'HEMS', label: 'hems→HEMS' },
  { pattern: /\bhemz\b/gi, replacement: 'HEMS', label: 'hemz→HEMS' },
  { pattern: /\bhens\b(?=\s*(request|tasked|on\s*scene|en\s*route|confirmed|dispatched|landed|eta|not))/gi, replacement: 'HEMS', label: 'hens→HEMS' },
  { pattern: /\bdsa\b/gi, replacement: 'DSA', label: 'dsa→DSA' },

  // 9. Priority misreads
  { pattern: /\bpriority\s+one\b/gi, replacement: 'P1', label: 'priority-one→P1' },
  { pattern: /\bpriority\s+two\b/gi, replacement: 'P2', label: 'priority-two→P2' },
  { pattern: /\bpriority\s+three\b/gi, replacement: 'P3', label: 'priority-three→P3' },
  { pattern: /\bpriority\s+four\b/gi, replacement: 'P4', label: 'priority-four→P4' },
  { pattern: /\bhe'?s\s+a\s+P(\d)\b/gi, replacement: "he's a priority $1, P$1", label: 'hes-a-P→priority' },
  { pattern: /\bshe'?s\s+a\s+P(\d)\b/gi, replacement: "she's a priority $1, P$1", label: 'shes-a-P→priority' },
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
