/** Comprehensive list of UK emergency service organisations by category */

export interface UKStation {
  name: string;
  service: string;
}

export const UK_AMBULANCE_TRUSTS: string[] = [
  'East Midlands Ambulance Service',
  'East of England Ambulance Service',
  'Isle of Wight NHS Trust (Ambulance)',
  'London Ambulance Service',
  'North East Ambulance Service',
  'North West Ambulance Service',
  'South Central Ambulance Service',
  'South East Coast Ambulance Service',
  'South Western Ambulance Service',
  'West Midlands Ambulance Service',
  'Yorkshire Ambulance Service',
  // Wales
  'Welsh Ambulance Services NHS Trust',
  // Scotland
  'Scottish Ambulance Service',
  // Northern Ireland
  'Northern Ireland Ambulance Service',
  // Other
  'HEMS / Air Ambulance',
  'British Red Cross',
  'St John Ambulance',
];

export const UK_POLICE_FORCES: string[] = [
  'Avon and Somerset Police',
  'Bedfordshire Police',
  'British Transport Police',
  'Cambridgeshire Constabulary',
  'Cheshire Constabulary',
  'City of London Police',
  'Cleveland Police',
  'Cumbria Constabulary',
  'Derbyshire Constabulary',
  'Devon and Cornwall Police',
  'Dorset Police',
  'Durham Constabulary',
  'Essex Police',
  'Gloucestershire Constabulary',
  'Greater Manchester Police',
  'Hampshire and Isle of Wight Constabulary',
  'Hertfordshire Constabulary',
  'Humberside Police',
  'Kent Police',
  'Lancashire Constabulary',
  'Leicestershire Police',
  'Lincolnshire Police',
  'Merseyside Police',
  'Metropolitan Police Service',
  'Ministry of Defence Police',
  'Norfolk Constabulary',
  'North Yorkshire Police',
  'Northamptonshire Police',
  'Northumbria Police',
  'Nottinghamshire Police',
  'South Yorkshire Police',
  'Staffordshire Police',
  'Suffolk Constabulary',
  'Surrey Police',
  'Sussex Police',
  'Thames Valley Police',
  'Warwickshire Police',
  'West Mercia Police',
  'West Midlands Police',
  'West Yorkshire Police',
  'Wiltshire Police',
  // Wales
  'Dyfed-Powys Police',
  'Gwent Police',
  'North Wales Police',
  'South Wales Police',
  // Scotland
  'Police Scotland',
  // Northern Ireland
  'Police Service of Northern Ireland',
  // National
  'National Crime Agency',
  'Civil Nuclear Constabulary',
];

export const UK_FIRE_SERVICES: string[] = [
  'Avon Fire & Rescue Service',
  'Bedfordshire Fire & Rescue Service',
  'Buckinghamshire Fire & Rescue Service',
  'Cambridgeshire Fire & Rescue Service',
  'Cheshire Fire & Rescue Service',
  'Cleveland Fire Brigade',
  'Cornwall Fire & Rescue Service',
  'County Durham and Darlington Fire & Rescue Service',
  'Cumbria Fire & Rescue Service',
  'Derbyshire Fire & Rescue Service',
  'Devon and Somerset Fire & Rescue Service',
  'Dorset & Wiltshire Fire & Rescue Service',
  'East Sussex Fire & Rescue Service',
  'Essex County Fire & Rescue Service',
  'Gloucestershire Fire & Rescue Service',
  'Greater Manchester Fire & Rescue Service',
  'Hampshire and Isle of Wight Fire & Rescue Service',
  'Hereford & Worcester Fire & Rescue Service',
  'Hertfordshire Fire & Rescue Service',
  'Humberside Fire & Rescue Service',
  'Isle of Wight Fire & Rescue Service',
  'Kent Fire & Rescue Service',
  'Lancashire Fire & Rescue Service',
  'Leicestershire Fire & Rescue Service',
  'Lincolnshire Fire & Rescue',
  'London Fire Brigade',
  'Merseyside Fire & Rescue Service',
  'Norfolk Fire & Rescue Service',
  'North Yorkshire Fire & Rescue Service',
  'Northamptonshire Fire & Rescue Service',
  'Northumberland Fire & Rescue Service',
  'Nottinghamshire Fire & Rescue Service',
  'Oxfordshire Fire & Rescue Service',
  'Royal Berkshire Fire & Rescue Service',
  'Shropshire Fire & Rescue Service',
  'South Yorkshire Fire & Rescue',
  'Staffordshire Fire & Rescue Service',
  'Suffolk Fire & Rescue Service',
  'Surrey Fire & Rescue Service',
  'Tyne and Wear Fire & Rescue Service',
  'Warwickshire Fire & Rescue Service',
  'West Midlands Fire Service',
  'West Sussex Fire & Rescue Service',
  'West Yorkshire Fire & Rescue Service',
  // Wales
  'Mid and West Wales Fire & Rescue Service',
  'North Wales Fire & Rescue Service',
  'South Wales Fire & Rescue Service',
  // Scotland
  'Scottish Fire & Rescue Service',
  // Northern Ireland
  'Northern Ireland Fire & Rescue Service',
];

export const UK_MILITARY_UNITS: string[] = [
  'British Army',
  'Royal Navy',
  'Royal Air Force',
  'Royal Marines',
  'Joint Forces Command',
  'Other Military',
];

export function getStationsForService(service: string): string[] {
  switch (service) {
    case 'ambulance':
      return UK_AMBULANCE_TRUSTS;
    case 'police':
      return UK_POLICE_FORCES;
    case 'fire':
      return UK_FIRE_SERVICES;
    case 'military':
      return UK_MILITARY_UNITS;
    default:
      return [];
  }
}
