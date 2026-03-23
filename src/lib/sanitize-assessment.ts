/**
 * Post-processing sanitization for AI-generated assessments.
 * Applies display corrections before rendering in any UI component.
 */

import type { Assessment } from './herald-types';

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

  // Filter action_items to ambulance-only
  if (sanitized.action_items) {
    sanitized.action_items = sanitized.action_items.filter(
      item => !NON_AMBULANCE_ACTION_PATTERNS.some(p => p.test(item))
    );
    // Add resource requests moved from ATMIST
    if (movedToActions.length > 0) {
      sanitized.action_items = [...sanitized.action_items, ...movedToActions];
    }
  } else if (movedToActions.length > 0) {
    sanitized.action_items = movedToActions;
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

  // Also fix in ATMIST I (injuries) field if present
  if (sanitized.atmist) {
    for (const casualty of Object.values(sanitized.atmist)) {
      if ((casualty as any)?.I) {
        (casualty as any).I = (casualty as any).I.replace(
          /airway\s+compressed/gi,
          'Airway compromised'
        );
      }
    }
  }

  // 5. ATMIST casualty keys — only keep valid explicit priority keys
  if (sanitized.atmist) {
    const validKeyPattern = /^P[1-4](-\d+)?$/;
    const keys = Object.keys(sanitized.atmist);
    for (const key of keys) {
      if (!validKeyPattern.test(key)) {
        delete (sanitized.atmist as any)[key];
      }
    }
  }

  // 6. scene_location — strip generic descriptors, keep only specific addresses/roads
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
