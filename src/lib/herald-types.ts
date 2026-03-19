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
  confidence: number;
}

export type LiveState = 'idle' | 'recording' | 'processing' | 'ready' | 'confirmed';

export const PRIORITY_COLORS: Record<string, string> = {
  P1: '#FF3B30',
  P2: '#FF9500',
  P3: '#34C759',
};

export const SERVICE_EMOJIS: Record<string, string> = {
  military: '⚔️',
  ambulance: '🚑',
  police: '👮',
  fire: '🚒',
  unknown: '📻',
};

export const TEST_TRANSMISSIONS = [
  {
    emoji: '⚔️',
    label: 'MILITARY',
    text: 'Control this is Delta Two. Casualty male approximately 35. GSW right thigh arterial bleed tourniquet applied 1423 Zulu. Airway clear breathing fast pulse weak. Request immediate CASEVAC Grid 456789.',
  },
  {
    emoji: '🚑',
    label: 'AMBULANCE',
    text: 'Control this is Alpha Two incident 4471. METHANE. Major incident confirmed. RTC M62 westbound junction 26. Three vehicles two HGVs and a car. Hazards diesel spill and vehicle on fire. Access junction 26 westbound slip only. Six casualties two priority one. Police on scene fire ETA two minutes. Requesting two additional ambulances and HEMS.',
  },
  {
    emoji: '🚒',
    label: 'FIRE',
    text: 'Delta one to control. Building entry confirmed 0934. Two BA crews ground floor. Persons reported second floor. Fire spreading east wing. Request additional pump.',
  },
  {
    emoji: '👮',
    label: 'POLICE',
    text: 'Trojan 1 to Gold. Suspect vehicle stopped A1 northbound junction 4. Two detained. Weapon seen footwell. Request ARV backup. Scene secure.',
  },
];
