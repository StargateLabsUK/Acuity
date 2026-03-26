/**
 * Post-processing sanitization for AI-generated assessments.
 * Applies display corrections before rendering in any UI component.
 */

import type { Assessment, ActionItem } from './herald-types';

// ── Field validity checks ────────────────────────────────────────────

/** Access field must contain directional/route content, not clinical data */
const ACCESS_ROUTE_PATTERN = /\b(east|west|north|south|clear|avoid|rear|front|via|door|entry|entrance|approach|access|driveway|gate|path|lane|road|street|avenue|drive|a\d{1,4}|m\d{1,3}|junction|slip|roundabout|westbound|eastbound|northbound|southbound)\b/i;

function isValidAccessField(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const norm = value.toLowerCase().trim();
  // Placeholder check
  if (/^(not\s+(declared|reported|stated|specified|mentioned|provided|available)|none|unknown|n\/a)/.test(norm)) return false;
  return ACCESS_ROUTE_PATTERN.test(value);
}

/** Emergency services field must reference services/agencies, not clinical findings */
const EMERGENCY_SERVICES_PATTERN = /\b(ambulance|police|fire|hems|air\s*ambulance|coast\s*guard|mountain\s*rescue|sar|search\s*and\s*rescue|hazmat|on\s*scene|en\s*route|eta|dispatched|requested|attending|confirmed|arrived|stood\s*down|crew|unit|engine|officer|paramedic|technician|emt)\b/i;
const CLINICAL_DATA_PATTERN = /\b(gcs|spo2|bp\s*\d|pulse\s*\d|resp\s*rate|heart\s*rate|fracture|laceration|wound|bleed|haemorrhage|hemorrhage|tourniquet|splint|cannula|intubat|ventilat|adrenaline|morphine|ketamine|fentanyl|midazolam|saline|fluid|iv\s*access|chest\s*seal|airway|breathing|circulation|disability|exposure|pupils|reactive|consciousness|unconscious|responsive|unresponsive|cpr|defibrillat|rosc|arrest|resuscitat)\b/i;

function isValidEmergencyServicesField(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const norm = value.toLowerCase().trim();
  if (/^(not\s+(declared|reported|stated|specified|mentioned|provided|available)|none|unknown|n\/a)/.test(norm)) return false;
  // If it contains clinical data but no emergency services keywords, it's invalid
  if (CLINICAL_DATA_PATTERN.test(value) && !EMERGENCY_SERVICES_PATTERN.test(value)) return false;
  return EMERGENCY_SERVICES_PATTERN.test(value);
}

// Patterns that indicate non-ambulance action items (fire, police, scene management)
const NON_AMBULANCE_ACTION_PATTERNS = [
  /fuel\s*leak/i,
  /power\s*line/i,
  /scene\s*cordon/i,
  /cordon/i,
  /traffic\s*(management|control|diversion)/i,
  /road\s*closure/i,
  /fire\s*(service|crew|engine|brigade|suppression)/i,
  /police\s*(attendance|unit|officer|cordon|investigation)/i,
  /scene\s*(safety|management|control|security)/i,
  /hazmat\s*(team|unit)/i,
  /utility\s*(company|provider)/i,
  /gas\s*(board|company|leak\s*monitor)/i,
  /electricity\s*(board|provider)/i,
  /structural\s*(engineer|assessment|integrity)/i,
  /forensic/i,
  /crime\s*scene/i,
  /evacuati/i,
];

// Patterns that indicate resource requests (not completed treatments)
const RESOURCE_REQUEST_PATTERNS = [
  /\brequest(ed|ing)?\b/i,
  /\bETA\b/i,
  /\badditional\s+(unit|ambulance|crew|resource)/i,
  /\bHEMS\s+(request|en\s*route|dispatched|activated)/i,
  /\bback-?up\s+(request|needed|required)/i,
  /\bawaiting\b/i,
  /\ben\s*route\b/i,
  /\bdispatched\b/i,
];

// Valid priority designations that can appear
const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

// Patterns to rewrite action items as open loops
const OPEN_LOOP_REWRITES: Array<{ match: RegExp; rewrite: (text: string) => string }> = [
  {
    match: /\bHEMS\b.*\b(request|dispatch|activat|en\s*route)/i,
    rewrite: () => 'HEMS not yet confirmed — chase Control',
  },
  {
    match: /\badditional\s+(unit|ambulance|crew|resource)/i,
    rewrite: (t) => {
      const m = t.match(/additional\s+(unit|ambulance|crew|resource)s?/i);
      const resource = m ? m[0] : 'Additional units';
      return `${resource} not yet confirmed — chase Control`;
    },
  },
  {
    match: /\b(confirm|unconfirmed|no)\b.*\breceiving\s*hospital/i,
    rewrite: () => 'No receiving hospital confirmed — contact Control',
  },
  {
    match: /\breceiving\s*hospital\b.*\b(confirm|contact|check)/i,
    rewrite: () => 'No receiving hospital confirmed — contact Control',
  },
  {
    match: /\b(entrap|trapped|extrication)\b/i,
    rewrite: (t) => {
      const pm = t.match(/P[1-4]/);
      const p = pm ? pm[0] : 'Casualty';
      return `${p} trapped — extrication required before packaging and transport`;
    },
  },
  {
    match: /\bstatus\s*(unconfirmed|unknown|not\s*confirmed)\b/i,
    rewrite: (t) => {
      const pm = t.match(/P[1-4]/);
      const p = pm ? pm[0] : 'Casualty';
      return `${p} status unconfirmed — verify with scene commander`;
    },
  },
  {
    match: /\b(back-?up|backup)\s*(request|needed|required)/i,
    rewrite: () => 'Backup not yet confirmed — chase Control',
  },
  {
    match: /\bblue\s*(call|light)/i,
    rewrite: () => 'Blue call requested — await Control confirmation — chase Control',
  },
];

/**
 * Rewrite an action item as an open-loop crew task.
 */
function rewriteAsOpenLoop(text: string): string {
  for (const { match, rewrite } of OPEN_LOOP_REWRITES) {
    if (match.test(text)) {
      return rewrite(text);
    }
  }
  // If no specific rewrite matched but it contains "requested", make it open-loop
  if (/\brequest(ed|ing)?\b/i.test(text)) {
    const resource = text.replace(/\b(request(ed|ing)?|please|—|control)\b/gi, '').trim();
    if (resource) {
      const rewritten = `${resource} not yet confirmed — chase Control`;
      // Guard against phrase duplication
      return rewritten.replace(/(not yet confirmed\s*—\s*chase\s*){2,}/gi, 'not yet confirmed — chase ');
    }
  }
  // Final dedup guard: catch any doubled phrasing that slipped through
  const deduped = text.replace(/(not yet confirmed\s*—\s*chase\s*){2,}/gi, 'not yet confirmed — chase ');
  return deduped;
}

/**
 * Convert string action items to ActionItem objects with timestamps.
 */
export function toActionItems(items: string[], timestamp?: string): ActionItem[] {
  const ts = timestamp || new Date().toISOString();
  return items.map(text => ({
    text: rewriteAsOpenLoop(text),
    opened_at: ts,
  }));
}

/**
 * Auto-resolve action items based on new transmission content.
 * Returns { active, resolved } split.
 */
export function resolveActionItems(
  existing: ActionItem[],
  newTranscript: string,
  newAssessment?: Assessment | null,
): { active: ActionItem[]; resolved: ActionItem[] } {
  const active: ActionItem[] = [];
  const resolved: ActionItem[] = [];
  const now = new Date().toISOString();
  const text = (newTranscript || '').toLowerCase();
  const newHospitals = newAssessment?.receiving_hospital || [];

  // If transcript is empty/blank, nothing can be resolved — preserve all items
  const hasContent = text.trim().length > 0;

  for (const item of existing) {
    if (item.resolved_at) {
      resolved.push(item);
      continue;
    }

    let isResolved = false;

    // Only attempt resolution if transcript has meaningful content
    if (hasContent) {
      // HEMS: only resolve when explicitly confirmed tasked/en route, on scene, or stood down
      if (/HEMS/i.test(item.text) && /\bHEMS\b/i.test(text)) {
        if (/\bHEMS\b.*\b(tasked|en\s*route|on\s*scene|landed|arrived|taking\s*over|stood\s*down|cancelled|canceled|not\s*required)\b/i.test(text)) {
          isResolved = true;
        }
      }

      // Receiving hospital: only resolve when explicitly confirmed
      if (/receiving hospital/i.test(item.text) && /hospital/i.test(item.text)) {
        if (newHospitals.length > 0 || /\b(conveying|transporting|en\s*route)\s*(to|—)\s*[A-Z]/i.test(text)) {
          isResolved = true;
        }
      }

      // Additional units/backup: only resolve when explicitly confirmed on scene
      if (/additional.*not yet confirmed/i.test(item.text) || /backup.*not yet confirmed/i.test(item.text)) {
        if (/\b(additional|backup|back-?up)\b.*\b(on\s*scene|arrived|confirmed)\b/i.test(text)) {
          isResolved = true;
        }
      }

      // Extrication: only resolve when crew confirms patient extricated
      if (/trapped.*extrication/i.test(item.text)) {
        if (/\b(extricated|extrication\s*(complete|done)|freed|released)\b/i.test(text)) {
          isResolved = true;
        }
      }

      // Status: only resolve when explicitly confirmed
      if (/status unconfirmed/i.test(item.text)) {
        const pm = item.text.match(/P[1-4]/);
        if (pm && new RegExp(`${pm[0]}.*\\b(confirmed|stable|deceased|status)\\b`, 'i').test(text)) {
          isResolved = true;
        }
      }

      // Triage: only resolve when all casualties assessed
      if (/triage|casualties.*assessed/i.test(item.text)) {
        if (/\b(triage\s*(complete|done)|all\s*casualties\s*(assessed|accounted))\b/i.test(text)) {
          isResolved = true;
        }
      }

      // ABCDE / assessment incomplete: resolve when full vitals or ABCDE reported
      if (/\b(abcde|assessment|primary\s*survey)\b/i.test(item.text) && /\b(incomplete|complete|required|needed|outstanding)\b/i.test(item.text)) {
        // Full ABCDE: at least 3 of the 5 segments mentioned, OR explicit "ABCDE complete"
        const abcdeComplete = /\babcde\s*(complete|done|performed|documented)\b/i.test(text);
        const vitalsCount = [
          /\b(airway|a\s*[:=])/i, /\b(breathing|resp|rr\b|respiratory)/i,
          /\b(circulation|pulse|hr\b|heart\s*rate|bp\b|blood\s*pressure)/i,
          /\b(disability|gcs|avpu|pupils?|consciousness)/i,
          /\b(exposure|temperature|temp\b|hypotherm|warm)/i,
        ].filter(p => p.test(text)).length;
        if (abcdeComplete || vitalsCount >= 3) {
          isResolved = true;
        }
      }

      // Analgesia / pain management required: resolve when drug given for pain
      if (/\b(analgesia|pain\s*(management|relief))\b/i.test(item.text) && /\b(required|needed|administer|consider)\b/i.test(item.text)) {
        if (/\b(morphine|fentanyl|ketamine|paracetamol|entonox|methoxyflurane|penthrox|ibuprofen|codeine|tramadol|diclofenac)\b/i.test(text) ||
            /\b(analgesia|pain\s*relief)\s*(given|administered|provided|effective)\b/i.test(text)) {
          isResolved = true;
        }
      }

      // Immobilisation / packaging required: resolve when packaged or splinted
      if (/\b(immobilis|packag|splint|extrication|board|scoop)\b/i.test(item.text) && /\b(required|needed|awaiting|pending)\b/i.test(item.text)) {
        if (/\b(packaged|immobilis(ed|ation\s*complete)|splinted|on\s*(board|scoop|stretcher)|secured|ready\s*(for\s*transport|to\s*convey))\b/i.test(text)) {
          isResolved = true;
        }
      }

      // IV/IO access required: resolve when access established
      if (/\b(iv|io|intravenous|intraosseous|vascular)\s*(access|line)\b/i.test(item.text) && /\b(required|needed|establish|obtain)\b/i.test(item.text)) {
        if (/\b(iv|io)\s*(access|line)?\s*(established|secured|obtained|sited|in\s*situ)\b/i.test(text) || /\b(cannula(ted)?|large\s*bore)\b/i.test(text)) {
          isResolved = true;
        }
      }

      // Airway management required: resolve when airway secured
      if (/\b(airway)\b/i.test(item.text) && /\b(required|needed|manage|secure|consider)\b/i.test(item.text)) {
        if (/\b(airway\s*(secured|managed|patent|maintained)|igel|lma|intubat(ed|ion)|supraglottic|opa|npa)\b/i.test(text)) {
          isResolved = true;
        }
      }

      // Spinal immobilisation: resolve when applied
      if (/\b(spinal|c-?spine|cervical)\b/i.test(item.text) && /\b(immobilis|precaution|required|needed)\b/i.test(item.text)) {
        if (/\b(spinal\s*(immobilis|board)|cervical\s*collar|c-?collar|blocks?\s*(applied|in\s*situ)|manual\s*in-?line)\b/i.test(text)) {
          isResolved = true;
        }
      }

      // Fluids / volume required: resolve when given
      if (/\b(fluid|volume|saline|hartmann)\b/i.test(item.text) && /\b(required|needed|administer|bolus|resuscitat)\b/i.test(item.text)) {
        if (/\b(fluid|saline|hartmann|crystalloid|colloid)\s*(given|administered|running|bolus|infus)\b/i.test(text) || /\b\d+\s*ml\b/i.test(text)) {
          isResolved = true;
        }
      }
    }

    if (isResolved) {
      resolved.push({ ...item, resolved_at: now });
    } else {
      active.push(item);
    }
  }

  return { active, resolved };
}

/**
 * Format how long an action item has been open.
 */
export function formatActionAge(openedAt: string): string {
  const ms = Date.now() - new Date(openedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'open <1 min';
  if (mins < 60) return `open ${mins} min${mins === 1 ? '' : 's'}`;
  const hrs = Math.floor(mins / 60);
  return `open ${hrs}h ${mins % 60}m`;
}

/**
 * Sanitize an assessment for display. Does not mutate the original.
 */
export function sanitizeAssessment(assessment: Assessment): Assessment {
  const sanitized = JSON.parse(JSON.stringify(assessment)) as Assessment;

  // 1. Priority — only keep if it's a valid P1-P4 designation
  if (sanitized.priority && !VALID_PRIORITIES.includes(sanitized.priority)) {
    sanitized.priority = '';
    sanitized.priority_label = '';
  }

  // 2. Action items — filter to ambulance crew responsibilities only
  const movedToActions: string[] = [];

  // 3. ATMIST T_treatment — move resource requests to action items
  if (sanitized.atmist) {
    for (const [key, casualty] of Object.entries(sanitized.atmist)) {
      if (casualty?.T_treatment) {
        const parts = casualty.T_treatment.split(/[;,.]/).map(s => s.trim()).filter(Boolean);
        const clinical: string[] = [];
        for (const part of parts) {
          if (RESOURCE_REQUEST_PATTERNS.some(p => p.test(part))) {
            movedToActions.push(part);
          } else {
            clinical.push(part);
          }
        }
        (sanitized.atmist as any)[key].T_treatment = clinical.length > 0 ? clinical.join('; ') : '—';
      }
    }
  }

  // Filter action_items to ambulance-only, then rewrite as open loops
  if (sanitized.action_items) {
    sanitized.action_items = sanitized.action_items.filter(
      item => !NON_AMBULANCE_ACTION_PATTERNS.some(p => p.test(item))
    );
    if (movedToActions.length > 0) {
      sanitized.action_items = [...sanitized.action_items, ...movedToActions];
    }
    // Rewrite all as open loops
    sanitized.action_items = sanitized.action_items.map(rewriteAsOpenLoop);
  } else if (movedToActions.length > 0) {
    sanitized.action_items = movedToActions.map(rewriteAsOpenLoop);
  }

  // Also filter the legacy `actions` array
  if (sanitized.actions) {
    sanitized.actions = sanitized.actions.filter(
      item => !NON_AMBULANCE_ACTION_PATTERNS.some(p => p.test(item))
    );
  }

  // 4. Airway correction: "compressed" → "compromised"
  if (sanitized.clinical_findings?.A) {
    sanitized.clinical_findings.A = sanitized.clinical_findings.A.replace(
      /airway\s+compressed/gi,
      'Airway compromised'
    );
  }

  // Also fix in ATMIST fields if present
  if (sanitized.atmist) {
    for (const [key, casualty] of Object.entries(sanitized.atmist)) {
      const c = casualty as any;
      if (!c) continue;

      // ATMIST A field: strip patient names, keep only age/sex
      if (c.A && typeof c.A === 'string') {
        // If A contains a name but no age/number, it's likely a name-only value
        const hasAge = /\b\d{1,3}\b/.test(c.A) || /\b(elderly|middle[- ]aged|young|infant|child|adolescent|teenage|adult|neonate|baby|toddler)\b/i.test(c.A);
        const hasSex = /\b(male|female|man|woman|boy|girl)\b/i.test(c.A);
        // Name patterns: starts with capital letter word that's not an age/sex descriptor
        const namePattern = /\b(patient\s*[:=]?\s*)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/;
        const nameMatch = c.A.match(namePattern);
        if (nameMatch && !hasAge && !hasSex) {
          // Entire A field is a name — extract to patient_name and clear A
          if (!sanitized.patient_name) {
            sanitized.patient_name = nameMatch[2] || nameMatch[0];
          }
          c.A = '—';
        } else if (nameMatch && (hasAge || hasSex)) {
          // Mixed: strip the name portion, keep age/sex
          const namePart = nameMatch[0];
          if (!sanitized.patient_name) {
            sanitized.patient_name = nameMatch[2] || nameMatch[0];
          }
          c.A = c.A.replace(namePart, '').replace(/^[\s,;:—-]+|[\s,;:—-]+$/g, '').trim() || '—';
        }
        // Clean up "Patient:" prefix
        c.A = c.A.replace(/^patient\s*[:=]?\s*/i, '').trim();
      }

      // Airway compressed → compromised in I field
      if (c.I) {
        c.I = c.I.replace(/airway\s+compressed/gi, 'Airway compromised');
      }

      // FIX 2: T field — separate clock time from downtime
      if (c.T) {
        const tVal = (c.T as string).trim();
        // Match clock times like "14:23", "1423", "14:23Z", "14:23 hours"
        const clockMatch = tVal.match(/\b(\d{1,2}[:.]\d{2})\s*(Z|hours?|hrs?)?\b/i);
        // Match downtime like "approximately 8 minutes down", "8 mins", "10 minutes"
        const downtimeMatch = tVal.match(/((?:approximately|approx\.?|about|~)?\s*\d+\s*(?:minutes?|mins?|seconds?|secs?)\s*(?:down(?:time)?)?)/i);

        if (clockMatch && downtimeMatch) {
          // Both present — split them
          c.T = clockMatch[1] + (clockMatch[2] ? clockMatch[2] : '');
          c.downtime = downtimeMatch[1].trim();
        } else if (!clockMatch && downtimeMatch) {
          // Only downtime, no clock time
          c.T = 'Not stated';
          c.downtime = downtimeMatch[1].trim();
        } else if (clockMatch) {
          // Only clock time
          c.T = clockMatch[1] + (clockMatch[2] ? clockMatch[2] : '');
        }
        // If neither matches, leave T as-is (might be descriptive text)
      }

      // FIX 3: Cardiac arrest — "Post-cardiac arrest" → "Cardiac arrest" + ROSC status
      if (c.I && /post[- ]cardiac\s*arrest/i.test(c.I)) {
        // Extract rhythm if present
        const rhythmMatch = c.I.match(/\b(VF|VT|PEA|asystole|shockable|non[- ]shockable)\b/i);
        const rhythm = rhythmMatch ? ` (${rhythmMatch[1].toUpperCase()})` : '';
        c.I = c.I.replace(/post[- ]cardiac\s*arrest/gi, 'Cardiac arrest');
        c.status = 'ROSC achieved';
      }
      // Also handle cases where ROSC is mentioned in S (signs) or transcript
      if (c.I && /cardiac\s*arrest/i.test(c.I) && c.S && /\bROSC\b/i.test(c.S)) {
        c.status = 'ROSC achieved';
      }
    }
  }

  // 5. ATMIST casualty keys — only keep keys matching priorities explicitly present
  if (sanitized.atmist) {
    // Collect explicitly declared priorities from the assessment and action items
    const declaredPriorities = new Set<string>();
    // The top-level priority
    if (sanitized.priority && VALID_PRIORITIES.includes(sanitized.priority)) {
      declaredPriorities.add(sanitized.priority);
    }
    // Scan action items and headline for explicit P1-P4 mentions
    const allText = [
      sanitized.headline || '',
      ...(sanitized.action_items || []),
      ...(sanitized.actions || []),
      sanitized.formatted_report || '',
      sanitized.clinical_history || '',
    ].join(' ');
    for (const p of VALID_PRIORITIES) {
      if (allText.includes(p)) declaredPriorities.add(p);
    }
    // Also check ATMIST entries themselves for cross-referenced priorities
    // (e.g. if the AI mentions P2 casualties in a P1 entry's injuries field)
    for (const [key, val] of Object.entries(sanitized.atmist)) {
      const baseP = key.replace(/-\d+$/, '');
      if (VALID_PRIORITIES.includes(baseP)) {
        declaredPriorities.add(baseP);
      }
    }

    // Now strip any ATMIST key whose base priority wasn't declared
    const validKeyPattern = /^P[1-4](-\d+)?$/;
    const keys = Object.keys(sanitized.atmist);
    for (const key of keys) {
      if (!validKeyPattern.test(key)) {
        delete (sanitized.atmist as any)[key];
        continue;
      }
      const baseP = key.replace(/-\d+$/, '');
      if (!declaredPriorities.has(baseP)) {
        delete (sanitized.atmist as any)[key];
      }
    }
  }

  // 6. METHANE access — retrospectively clear if stored value is not valid access content
  if (sanitized.structured?.access && !isValidAccessField(sanitized.structured.access)) {
    sanitized.structured.access = '';
  }
  if (sanitized.structured?.access_routes && !isValidAccessField(sanitized.structured.access_routes)) {
    sanitized.structured.access_routes = '';
  }

  // 7. METHANE emergency_services — retrospectively clear if stored value is clinical data
  if (sanitized.structured?.emergency_services && !isValidEmergencyServicesField(sanitized.structured.emergency_services)) {
    sanitized.structured.emergency_services = '';
  }

  // 8. scene_location — strip generic descriptors, keep only specific addresses/roads
  if (sanitized.scene_location) {
    const genericPatterns = [
      /^(vehicle\s+)?collision\s+scene$/i,
      /^(road\s+)?traffic\s+(collision|accident|incident)\s+scene$/i,
      /^incident\s+scene$/i,
      /^scene\s+of\s+(incident|accident|collision)$/i,
      /^not\s+specified$/i,
      /^unknown$/i,
      /^on\s+scene$/i,
    ];
    if (genericPatterns.some(p => p.test(sanitized.scene_location!.trim()))) {
      sanitized.scene_location = '';
    }
  }

  return sanitized;
}
