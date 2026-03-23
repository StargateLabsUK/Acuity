export interface VehicleType {
  code: string;
  label: string;
  can_transport: boolean;
  critical_care: boolean;
}

export const VEHICLE_TYPES: VehicleType[] = [
  { code: 'DSA', label: 'Double Staffed Ambulance', can_transport: true, critical_care: false },
  { code: 'SSA', label: 'Single Staffed Ambulance', can_transport: true, critical_care: false },
  { code: 'RRV', label: 'Rapid Response Vehicle', can_transport: false, critical_care: false },
  { code: 'MOTORCYCLE', label: 'Motorcycle Responder', can_transport: false, critical_care: false },
  { code: 'CYCLE', label: 'Cycle Responder', can_transport: false, critical_care: false },
  { code: 'HART', label: 'Hazardous Area Response Team', can_transport: false, critical_care: true },
  { code: 'AO', label: 'Ambulance Officer', can_transport: false, critical_care: false },
  { code: 'MTU', label: 'Mobile Treatment Unit', can_transport: true, critical_care: true },
  { code: 'CCC', label: 'Critical Care Car', can_transport: true, critical_care: true },
];

export function getVehicleType(code: string | null | undefined): VehicleType | undefined {
  if (!code) return undefined;
  return VEHICLE_TYPES.find((v) => v.code === code);
}

export function getVehicleLabel(code: string | null | undefined): string {
  const vt = getVehicleType(code);
  return vt ? vt.code : '';
}
