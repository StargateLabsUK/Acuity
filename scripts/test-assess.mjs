/**
 * Herald ATMIST Assessment Integration Tests
 *
 * Sends realistic ambulance crew transcripts to the live assess edge function
 * and validates the AI response against expected field values.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/test-assess.mjs
 *
 * Or via npm:
 *   npm run test:assess
 *
 * Environment variables (reads from .env if present):
 *   SUPABASE_URL          — e.g. https://xxx.supabase.co
 *   SUPABASE_ANON_KEY     — the anon/publishable key
 *   TEST_TIMEOUT          — per-request timeout in ms (default 30000)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env ──
try {
  const envPath = resolve(__dirname, '..', '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env, rely on env vars */ }

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const TIMEOUT = parseInt(process.env.TEST_TIMEOUT || '30000', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_ equivalents) must be set');
  process.exit(1);
}

const ASSESS_URL = `${SUPABASE_URL}/functions/v1/assess`;

// ── Test scenarios ──

const SCENARIOS = [
  {
    id: 'tx1-single-p1-full-atmist',
    name: 'TX1 — Single P1 casualty with full ATMIST (David Roberts)',
    transcript: `Control, this is Delta Four. We are on scene at 14 Park Lane, Worksop, Nottinghamshire. RTC, two vehicle head-on collision. We have three casualties total. Starting with the most serious. P1 is a male approximately 40 years old, his name is David Roberts. He is trapped in the drivers seat of the first car. Time of injury approximately 14:20. Mechanism is head-on collision, significant front end deformity to both vehicles. Injuries found are suspected pelvic fracture, open fracture to the right femur, and a large laceration to the forehead with active bleeding. Signs are GCS 10, that is E2 V3 M5, heart rate 120, blood pressure 85 over 60, SpO2 92 percent on high flow oxygen, respiratory rate 24. Treatment so far, IV access obtained left antecubital fossa, 250ml bolus of Hartmanns running, pelvic binder applied, wound packed and dressed to the forehead laceration. Requesting HEMS please Control.`,
    vehicle_type: 'DSA',
    checks: [
      // Top-level fields
      ['priority', 'equals', 'P1'],
      ['incident_type', 'contains', 'RTC'],
      ['scene_location', 'contains', '14 Park Lane'],
      ['scene_location', 'contains', 'Worksop'],
      ['structured.number_of_casualties', 'contains', '3'],
      // ATMIST keys
      ['atmist', 'has_key', 'P1'],
      // P1 ATMIST fields
      ['atmist.P1.name', 'contains', 'David Roberts'],
      ['atmist.P1.A', 'contains', '40'],
      ['atmist.P1.A', 'contains_i', 'male'],
      ['atmist.P1.T', 'contains', '14:20'],
      ['atmist.P1.M', 'contains_i', 'head-on'],
      ['atmist.P1.I', 'contains_i', 'pelvic'],
      ['atmist.P1.I', 'contains_i', 'femur'],
      ['atmist.P1.I', 'contains_i', 'laceration'],
      ['atmist.P1.S', 'contains', 'GCS'],
      ['atmist.P1.S', 'contains', '10'],
      ['atmist.P1.S', 'contains', '120'],
      ['atmist.P1.S', 'contains', '85'],
      ['atmist.P1.S', 'contains', '92'],
      ['atmist.P1.S', 'contains', '24'],
      ['atmist.P1.T_treatment', 'contains_i', 'IV'],
      ['atmist.P1.T_treatment', 'contains_i', 'pelvic binder'],
      // Narrative fields exist
      ['clinical_history', 'not_empty'],
      ['formatted_report', 'not_empty'],
      ['headline', 'not_empty'],
    ],
  },
  {
    id: 'tx2-multi-casualty-p2-p3',
    name: 'TX2 — Two casualties: P2 Sarah Thompson + P3 unnamed male',
    transcript: `Control, Delta Four again with an update on the Worksop RTC at 14 Park Lane. Moving on to P2 now. P2 is a female, 35 years old, patients name is Sarah Thompson. She was the front seat passenger in the same vehicle as P1. Time of injury same, 14:20. Mechanism same head-on collision. Injuries are neck pain and right arm pain, query cervical spine injury. Signs are GCS 15, heart rate 88, BP 120 over 78, SpO2 98 percent on air. Vitals stable. Treatment given cervical collar applied, right arm splinted in a broad arm sling. She is ambulant and has been moved to the safe area. P3 is a male approximately 28, no name given. He was the driver of the second vehicle. Self-extricated from the vehicle. Complaining of chest pain and mild shortness of breath. GCS 15, heart rate 95, BP 130 over 82, SpO2 97 percent on air, respiratory rate 20. Treatment given oxygen via nasal cannulae at 4 litres per minute. Minor cuts and abrasions to both hands and forearms, dressed on scene.`,
    vehicle_type: 'DSA',
    checks: [
      // Should have both P2 and P3
      ['atmist', 'has_key', 'P2'],
      ['atmist', 'has_key', 'P3'],
      // P2 fields
      ['atmist.P2.name', 'contains', 'Sarah Thompson'],
      ['atmist.P2.A', 'contains', '35'],
      ['atmist.P2.A', 'contains_i', 'female'],
      ['atmist.P2.T', 'contains', '14:20'],
      ['atmist.P2.M', 'contains_i', 'head-on'],
      ['atmist.P2.I', 'contains_i', 'neck'],
      ['atmist.P2.I', 'contains_i', 'arm'],
      ['atmist.P2.S', 'contains', 'GCS 15'],
      ['atmist.P2.S', 'contains', '88'],
      ['atmist.P2.S', 'contains', '98'],
      ['atmist.P2.T_treatment', 'contains_i', 'cervical collar'],
      ['atmist.P2.T_treatment', 'contains_i', 'splint'],
      // P3 fields
      ['atmist.P3.name', 'is_null'],
      ['atmist.P3.A', 'contains', '28'],
      ['atmist.P3.A', 'contains_i', 'male'],
      ['atmist.P3.I', 'contains_i', 'chest pain'],
      ['atmist.P3.I', 'contains_i', 'cuts'],
      ['atmist.P3.S', 'contains', 'GCS 15'],
      ['atmist.P3.S', 'contains', '95'],
      ['atmist.P3.S', 'contains', '97'],
      ['atmist.P3.S', 'contains', '20'],
      ['atmist.P3.T_treatment', 'contains_i', 'oxygen'],
      ['atmist.P3.T_treatment', 'contains_i', 'nasal'],
      ['clinical_history', 'not_empty'],
      ['formatted_report', 'not_empty'],
    ],
  },
  {
    id: 'tx3-update-deterioration-hospitals',
    name: 'TX3 — P1 deteriorating, hospitals confirmed, P3 named',
    transcript: `Control, Delta Four. Update on the Worksop RTC. HEMS is now on scene and have taken over P1 David Roberts. His GCS has dropped to 6, E1 V1 M4. Airway is now compromised, HEMS have intubated and are ventilating. Heart rate now 135, BP 75 over 50, SpO2 88 percent. He is being extricated by fire service now. HEMS will be conveying P1 direct to Queens Medical Centre Nottingham by air. P2 Sarah Thompson is stable, no change. We will be conveying P2 to Bassetlaw Hospital. P3, his name is actually James Wilson, the 28 year old male. Also stable, minor injuries only. He will be discharged on scene, see and treat.`,
    vehicle_type: 'DSA',
    checks: [
      // All three casualties present
      ['atmist', 'has_key', 'P1'],
      ['atmist', 'has_key', 'P2'],
      ['atmist', 'has_key', 'P3'],
      // P1 updated vitals
      ['atmist.P1.name', 'contains', 'David Roberts'],
      ['atmist.P1.S', 'contains', 'GCS'],
      ['atmist.P1.S', 'contains', '6'],
      ['atmist.P1.S', 'contains', '135'],
      ['atmist.P1.S', 'contains', '88'],
      ['atmist.P1.T_treatment', 'contains_i', 'intubat'],
      // P3 now named
      ['atmist.P3.name', 'contains', 'James Wilson'],
      // Receiving hospitals
      ['receiving_hospital', 'array_contains_i', 'Queens Medical Centre'],
      ['receiving_hospital', 'array_contains_i', 'Bassetlaw'],
      ['clinical_history', 'not_empty'],
    ],
  },
  {
    id: 'tx4-cardiac-arrest-single',
    name: 'TX4 — Single patient cardiac arrest (Margaret Davies)',
    transcript: `Control, Bravo Seven. We are at 27 Ryton Street, Worksop. Called to a 84 year old female, patients name is Margaret Davies. She has gone into cardiac arrest. Bystander CPR was in progress when we arrived, approximately 10 minutes of CPR before our arrival. Time of arrest approximately 09:45. Found in asystole on the monitor. Airway clear, we have commenced advanced life support. IV adrenaline given times two, 1mg each. iGel inserted, ventilating with bag valve mask. Compressions ongoing, currently on third cycle. Past medical history includes atrial fibrillation and type 2 diabetes. Family on scene, daughter is present. No DNACPR in place.`,
    vehicle_type: 'DSA',
    checks: [
      ['priority', 'equals', 'P1'],
      ['incident_type', 'contains_i', 'cardiac'],
      ['scene_location', 'contains', '27 Ryton Street'],
      ['scene_location', 'contains', 'Worksop'],
      ['atmist', 'has_key', 'P1'],
      ['atmist.P1.name', 'contains', 'Margaret Davies'],
      ['atmist.P1.A', 'contains', '84'],
      ['atmist.P1.A', 'contains_i', 'female'],
      ['atmist.P1.T', 'contains', '09:45'],
      ['atmist.P1.M', 'contains_i', 'cardiac arrest'],
      ['atmist.P1.I', 'contains_i', 'asystole'],
      ['atmist.P1.S', 'contains_i', 'asystole'],
      ['atmist.P1.T_treatment', 'contains_i', 'adrenaline'],
      ['atmist.P1.T_treatment', 'contains_i', 'iGel'],
      ['atmist.P1.T_treatment', 'contains_i', 'CPR'],
      ['clinical_history', 'contains_i', 'atrial fibrillation'],
      ['clinical_history', 'contains_i', 'diabetes'],
      ['formatted_report', 'not_empty'],
    ],
  },
  {
    id: 'tx5-fall-elderly-safeguarding',
    name: 'TX5 — Elderly fall with safeguarding concern',
    transcript: `Control, Echo Nine. We are at 4 Meadow Close, Retford. Called to a fall, 78 year old male, his name is Arthur Blackwell. Found on the floor in the living room. He says he tripped on the rug but we have noticed multiple bruises in various stages of healing on both arms and his torso that are not consistent with his explanation. He appears malnourished and unkempt. The house is in very poor condition. We have concerns about potential neglect or non-accidental injury. Requesting police attendance please. Time of fall approximately 11:30. Injuries are pain to the left hip, unable to weight bear, suspected neck of femur fracture. Signs GCS 15, heart rate 78, BP 145 over 90, SpO2 96 percent on air, temperature 35.2 which is low. Treatment given Entonox for pain relief, splinted the left leg. We will be conveying to Doncaster Royal Infirmary.`,
    vehicle_type: 'DSA',
    checks: [
      ['scene_location', 'contains', '4 Meadow Close'],
      ['scene_location', 'contains', 'Retford'],
      ['incident_type', 'contains_i', 'fall'],
      ['atmist', 'has_key', 'P2'],
      ['atmist.P2.name', 'contains', 'Arthur Blackwell'],
      ['atmist.P2.A', 'contains', '78'],
      ['atmist.P2.A', 'contains_i', 'male'],
      ['atmist.P2.T', 'contains', '11:30'],
      ['atmist.P2.M', 'contains_i', 'fall'],
      ['atmist.P2.I', 'contains_i', 'hip'],
      ['atmist.P2.I', 'contains_i', 'femur'],
      ['atmist.P2.S', 'contains', '78'],
      ['atmist.P2.S', 'contains', '145'],
      ['atmist.P2.S', 'contains', '96'],
      ['atmist.P2.S', 'contains', '35.2'],
      ['atmist.P2.T_treatment', 'contains_i', 'Entonox'],
      ['atmist.P2.T_treatment', 'contains_i', 'splint'],
      // Safeguarding
      ['safeguarding.concern_identified', 'equals', true],
      ['safeguarding.police_requested', 'equals', true],
      ['safeguarding.details', 'not_empty'],
      // Receiving hospital
      ['receiving_hospital', 'array_contains_i', 'Doncaster'],
      ['clinical_history', 'not_empty'],
    ],
  },
  {
    id: 'tx6-minimal-info',
    name: 'TX6 — Minimal information transmission',
    transcript: `Control, Alpha Two. We are on scene. Single patient, male, fell off a ladder. Conscious and breathing. Complaining of back pain. Will update shortly.`,
    vehicle_type: 'DSA',
    checks: [
      ['atmist', 'key_count_gte', 1],
      ['headline', 'not_empty'],
      ['incident_type', 'contains_i', 'fall'],
      ['clinical_history', 'not_empty'],
      // Should NOT have null/empty for everything — at minimum back pain should be captured
      ['formatted_report', 'not_empty'],
    ],
  },
];

// ── Assertion helpers ──

function getNestedValue(obj, path) {
  const parts = path.split('.');
  let val = obj;
  for (const p of parts) {
    if (val == null || typeof val !== 'object') return undefined;
    val = val[p];
  }
  return val;
}

function runCheck(data, [path, op, expected]) {
  const val = getNestedValue(data, path);
  const strVal = val == null ? 'null' : typeof val === 'object' ? JSON.stringify(val) : String(val);

  switch (op) {
    case 'equals':
      return { ok: val === expected, detail: `Got ${strVal}, expected ${JSON.stringify(expected)}` };
    case 'contains':
      return { ok: typeof val === 'string' && val.includes(expected), detail: `Got "${strVal}"` };
    case 'contains_i':
      return { ok: typeof val === 'string' && val.toLowerCase().includes(expected.toLowerCase()), detail: `Got "${strVal}"` };
    case 'not_empty':
      return { ok: val != null && String(val).trim().length > 0, detail: `Got ${strVal}` };
    case 'is_null':
      return { ok: val == null || val === '' || val === 'null', detail: `Got ${strVal}` };
    case 'has_key':
      return { ok: val != null && typeof val === 'object' && expected in val, detail: `Keys: [${Object.keys(val || {}).join(', ')}]` };
    case 'key_count_gte':
      return { ok: val != null && typeof val === 'object' && Object.keys(val).length >= expected, detail: `Got ${Object.keys(val || {}).length} keys` };
    case 'array_contains_i':
      const arr = Array.isArray(val) ? val : [];
      return { ok: arr.some(v => String(v).toLowerCase().includes(expected.toLowerCase())), detail: `Got ${JSON.stringify(arr)}` };
    default:
      return { ok: false, detail: `Unknown op: ${op}` };
  }
}

// ── HTTP caller ──

async function callAssess(transcript, vehicleType) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(ASSESS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ transcript, vehicle_type: vehicleType || 'DSA' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Runner ──

async function runScenario(scenario) {
  const start = Date.now();
  let data;
  try {
    data = await callAssess(scenario.transcript, scenario.vehicle_type);
  } catch (err) {
    return { id: scenario.id, name: scenario.name, error: err.message, passed: 0, failed: 0, checks: [], duration: Date.now() - start };
  }
  const duration = Date.now() - start;

  const results = scenario.checks.map(check => {
    const label = `${check[0]} ${check[1]}${check[2] !== undefined ? ` "${check[2]}"` : ''}`;
    const result = runCheck(data, check);
    return { label, ...result };
  });

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  return { id: scenario.id, name: scenario.name, passed, failed, total: results.length, checks: results, duration, data };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  HERALD ATMIST ASSESSMENT INTEGRATION TESTS');
  console.log(`  Endpoint: ${ASSESS_URL}`);
  console.log(`  Scenarios: ${SCENARIOS.length}`);
  console.log('═══════════════════════════════════════════════════════\n');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalErrors = 0;
  const failures = [];

  for (const scenario of SCENARIOS) {
    process.stdout.write(`▸ ${scenario.name} ... `);
    const result = await runScenario(scenario);

    if (result.error) {
      console.log(`ERROR (${result.duration}ms)`);
      console.log(`  ✗ ${result.error}\n`);
      totalErrors++;
      failures.push({ scenario: result.name, error: result.error });
      continue;
    }

    const status = result.failed === 0 ? '✓ PASS' : `✗ ${result.failed} FAILED`;
    console.log(`${status} (${result.passed}/${result.total}) [${result.duration}ms]`);

    totalPassed += result.passed;
    totalFailed += result.failed;

    // Show failures inline
    for (const check of result.checks) {
      if (!check.ok) {
        console.log(`  ✗ ${check.label} — ${check.detail}`);
        failures.push({ scenario: result.name, check: check.label, detail: check.detail });
      }
    }
    if (result.failed > 0) console.log('');
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${totalPassed} passed, ${totalFailed} failed, ${totalErrors} errors`);
  console.log(`  Total checks: ${totalPassed + totalFailed}`);
  console.log('═══════════════════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) {
      if (f.error) console.log(`  • ${f.scenario}: ${f.error}`);
      else console.log(`  • ${f.scenario} → ${f.check}: ${f.detail}`);
    }
  }

  // Exit code for CI
  process.exit(totalFailed > 0 || totalErrors > 0 ? 1 : 0);
}

main();
