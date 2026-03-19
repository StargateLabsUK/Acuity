import { useState } from 'react';

interface Props {
  services: string[];
  callsigns: string[];
  onFilterChange: (filters: CommandFilters) => void;
}

export interface CommandFilters {
  service: string;
  callsign: string;
  timeRange: 'today' | '24h' | 'all';
}

const SERVICE_OPTIONS = [
  { value: '', label: 'ALL SERVICES' },
  { value: 'ambulance', label: '🚑 Ambulance' },
  { value: 'police', label: '👮 Police' },
  { value: 'fire', label: '🚒 Fire & Rescue' },
  { value: 'military', label: '⚔️ Military' },
];

const TIME_OPTIONS = [
  { value: 'today', label: 'TODAY' },
  { value: '24h', label: 'LAST 24H' },
  { value: 'all', label: 'ALL TIME' },
];

const selectStyle: React.CSSProperties = {
  background: '#0D1117',
  border: '1px solid #0F1820',
  color: '#C8D0CC',
  padding: '6px 10px',
  borderRadius: 3,
  fontSize: 18,
  outline: 'none',
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
};

export function CommandFilterBar({ services, callsigns, onFilterChange }: Props) {
  const [service, setService] = useState('');
  const [callsign, setCallsign] = useState('');
  const [timeRange, setTimeRange] = useState<'today' | '24h' | 'all'>('today');

  const update = (s: string, c: string, t: 'today' | '24h' | 'all') => {
    onFilterChange({ service: s, callsign: c, timeRange: t });
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 flex-shrink-0 overflow-x-auto"
      style={{ background: '#0D1117', borderBottom: '1px solid #0F1820' }}
    >
      <select
        value={service}
        onChange={(e) => { setService(e.target.value); update(e.target.value, callsign, timeRange); }}
        style={selectStyle}
      >
        {SERVICE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={callsign}
        onChange={(e) => { setCallsign(e.target.value); update(service, e.target.value, timeRange); }}
        style={selectStyle}
      >
        <option value="">ALL UNITS</option>
        {callsigns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <select
        value={timeRange}
        onChange={(e) => { const v = e.target.value as 'today' | '24h' | 'all'; setTimeRange(v); update(service, callsign, v); }}
        style={selectStyle}
      >
        {TIME_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
