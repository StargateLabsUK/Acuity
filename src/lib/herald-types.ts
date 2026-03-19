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

export type LiveState = 'idle' | 'triggered' | 'processing' | 'ready' | 'confirmed';

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
    label: 'Military',
    text: 'Casualty male 35, GSW right thigh arterial bleed tourniquet applied 1423 Zulu, airway clear, breathing fast, pulse weak, request CASEVAC Grid 456789',
  },
  {
    label: 'Ambulance',
    text: 'METHANE. Major incident RTC M62 junction 26. Multiple vehicles. Diesel spill hazard. Access westbound. Eight casualties two critical. Police and fire on scene. Require additional ambulances.',
  },
  {
    label: 'Fire',
    text: 'Delta one to control. Building entry confirmed 0934. Two BA crews ground floor. Persons reported second floor. Fire spreading east wing. Request additional pump.',
  },
  {
    label: 'Police',
    text: 'Trojan 1 to Gold. Suspect vehicle stopped A1 northbound junction 4. Two detained. Weapon seen footwell. Request ARV backup. Scene secure.',
  },
];
