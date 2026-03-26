export interface HeraldReport {
  id: string;
  timestamp: string;
  transcript: string;
  assessment: Assessment;
  synced: boolean;
  confirmed_at: string;
  headline?: string;
  operator_id?: string;
  device_id?: string;
  priority?: string;
  service?: string;
  lat?: number;
  lng?: number;
  location_accuracy?: number;
  session_callsign?: string;
  session_operator_id?: string;
  session_service?: string;
  session_station?: string;
  original_assessment?: Assessment;
  final_assessment?: Assessment;
  diff?: Record<string, any>;
  edited?: boolean;
  incident_number?: string;
  transmission_count?: number;
  latest_transmission_at?: string;
  status?: 'active' | 'closed';
  shift_id?: string;
}

export interface IncidentTransmission {
  id: string;
  report_id: string;
  timestamp: string;
  transcript: string | null;
  assessment: Assessment | null;
  priority: string | null;
  headline: string | null;
  operator_id: string | null;
  session_callsign: string | null;
  created_at: string;
}

export interface Assessment {
  service: string;
  protocol: string;
  priority: string;
  priority_label: string;
  headline: string;
  structured: Record<string, string>;
  actions: string[];
  transmit_to: string;
  formatted_report: string;
  confidence?: number;
  incident_type?: string;
  major_incident?: boolean;
  scene_location?: string;
  receiving_hospital?: string[];
  clinical_findings?: {
    A?: string;
    B?: string;
    C?: string;
    D?: string;
    E?: string;
  };
  atmist?: Record<string, {
    A?: string;
    T?: string;
    M?: string;
    I?: string;
    S?: string;
    T_treatment?: string;
    downtime?: string;
    status?: string;
  }>;
  treatment_given?: string[];
  action_items?: string[];
  clinical_history?: string;
}

export interface ActionItem {
  text: string;
  opened_at: string; // ISO timestamp
  resolved_at?: string; // ISO timestamp when resolved
}

export type DispositionType =
  | 'conveyed'
  | 'see_and_treat'
  | 'see_and_refer'
  | 'refused_transport'
  | 'role';

export interface DispositionFields {
  // Conveyed
  receiving_hospital?: string;
  time_of_handover?: string;
  handover_given_to?: string;
  eprf_handed_over?: boolean;
  // See and Treat
  clinical_justification?: string;
  discharge_observations?: string;
  advice_given?: string;
  safety_net_given?: boolean;
  time_of_discharge?: string;
  patient_understands?: boolean;
  // See and Refer (extends See and Treat)
  referral_destination?: string;
  referral_pathway?: string; // GP / 111 / Walk-in / Mental health crisis team / Other
  referral_accepted?: boolean; // true = accepted, false = advised only
  reference_number?: string;
  // Refused transport
  capacity_assessed?: boolean;
  patient_has_capacity?: boolean;
  risks_explained?: boolean;
  patient_understanding_confirmed?: boolean;
  refusal_witnessed_by?: string;
  time_of_refusal?: string;
  safeguarding_concern?: boolean;
  best_interests_decision?: string;
  signed_refusal_form?: boolean;
  // ROLE
  time_of_recognition?: string;
  role_criteria?: string;
  resuscitation_attempted?: boolean;
  resuscitation_details?: string;
  gp_notified?: boolean;
  police_notified?: boolean;
  coroner_referral?: boolean;
  nok_notified?: boolean;
}

export interface CasualtyDisposition {
  disposition: DispositionType;
  closed_at: string;
  casualty_key: string;
  casualty_label: string;
  priority: string;
  incident_id: string;
  incident_number: string | null;
  session_callsign?: string | null;
  fields: DispositionFields;
}

export const DISPOSITION_LABELS: Record<DispositionType, string> = {
  conveyed: 'Conveyed to hospital',
  see_and_treat: 'See and Treat — discharged on scene',
  see_and_refer: 'See and Refer',
  refused_transport: 'Refused transport / DAA',
  role: 'Recognition of Life Extinct (ROLE)',
};

export type LiveState = 'idle' | 'recording' | 'processing' | 'ready' | 'confirmed';

export interface Mismatch {
  field: string;
  session_value: string;
  transcript_value: string;
  resolved_to: string;
}

export function detectMismatches(
  session: { service: string; callsign: string; operator_id: string | null },
  assessment: Assessment
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  // Service
  if (session.service && assessment.service && session.service !== assessment.service) {
    mismatches.push({
      field: 'service',
      session_value: session.service,
      transcript_value: assessment.service,
      resolved_to: assessment.service,
    });
  }

  // Callsign
  const txCallsign = assessment.structured?.callsign;
  if (session.callsign && txCallsign && txCallsign !== 'null') {
    const sNorm = session.callsign.toLowerCase().trim();
    const tNorm = txCallsign.toLowerCase().trim();
    // Skip if one contains the other (e.g. "delta four" vs "control delta four")
    if (sNorm !== tNorm && !tNorm.includes(sNorm) && !sNorm.includes(tNorm)) {
      mismatches.push({
        field: 'callsign',
        session_value: session.callsign,
        transcript_value: txCallsign,
        resolved_to: txCallsign,
      });
    }
  }

  // Operator ID
  const txOperator = assessment.structured?.operator_id;
  if (session.operator_id && txOperator && txOperator !== 'null' && session.operator_id.toLowerCase() !== txOperator.toLowerCase()) {
    mismatches.push({
      field: 'operator_id',
      session_value: session.operator_id,
      transcript_value: txOperator,
      resolved_to: txOperator,
    });
  }

  return mismatches;
}

export const PRIORITY_COLORS: Record<string, string> = {
  P1: '#FF3B30',
  P2: '#FF9500',
  P3: '#34C759',
};

export const SERVICE_LABELS: Record<string, string> = {
  military: 'Military',
  ambulance: 'Ambulance',
  police: 'Police',
  fire: 'Fire & Rescue',
  unknown: 'Unknown',
};

export const TEST_TRANSMISSIONS = [
  {
    label: 'METHANE — RTC',
    text: 'Control this is Alpha Two incident 4471. METHANE. Major incident confirmed. RTC M62 westbound junction 26. Three vehicles two HGVs and a car. Hazards diesel spill and vehicle on fire. Access junction 26 westbound slip only. Six casualties two priority one. Police on scene fire ETA two minutes. Requesting two additional ambulances and HEMS.',
  },
  {
    label: 'ATMIST — SINGLE CASUALTY',
    text: 'Control this is Delta Four. ATMIST handover. Male approximately 35 years old. Time of injury 1423. Mechanism high speed RTC unrestrained driver. Injuries open fracture right femur with arterial bleed, suspected pelvic fracture. Signs GCS 12 BP 90 over 60 pulse 120 weak resps 24. Treatment tourniquet applied right thigh 1425, IV access established large bore left AC, one litre normal saline running. Requesting HEMS and conveying to MRI Manchester.',
  },
  {
    label: 'CARDIAC ARREST',
    text: 'Alpha One to control. On scene cardiac arrest. Male approximately 60. Bystander CPR in progress on arrival. Rhythm VF. Two shocks delivered. Adrenaline one milligram IV given. ROSC achieved at 1438. GCS 3 intubated ventilating. BP 100 over 70. Conveying priority one to Salford Royal.',
  },
  {
    label: 'MULTI-CASUALTY',
    text: 'Control Bravo Two. Update on incident 4471. P1 casualty one entrapped driver now extricated by fire. Open chest wound left side. Chest seal applied. IV fluids running. HEMS on scene taking over P1. P2 casualty two passenger fractured left arm splinted. P3 casualty three walking wounded laceration to forehead dressed. P2 conveying to MRI Manchester. P3 to Wythenshawe.',
  },
];
