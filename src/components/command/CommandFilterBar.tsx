import { useState, useRef, useEffect, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';

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
  { value: 'ambulance', label: 'Ambulance' },
  { value: 'police', label: 'Police' },
  { value: 'fire', label: 'Fire & Rescue' },
  { value: 'military', label: 'Military' },
];

const TIME_OPTIONS = [
  { value: 'today', label: 'TODAY' },
  { value: '24h', label: 'LAST 24H' },
  { value: 'all', label: 'ALL TIME' },
];

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#0D1117',
  border: '1px solid #0F1820',
  color: '#C8D0CC',
  padding: '10px 12px',
  borderRadius: 3,
  fontSize: 18,
  outline: 'none',
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
};

const labelStyle: React.CSSProperties = {
  color: '#4A6058',
  fontSize: 18,
  letterSpacing: '0.15em',
  marginBottom: 4,
  display: 'block',
  fontWeight: 700,
};

export function CommandFilterBar({ services, callsigns, onFilterChange }: Props) {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState('');
  const [callsign, setCallsign] = useState('');
  const [timeRange, setTimeRange] = useState<'today' | '24h' | 'all'>('today');
  const ref = useRef<HTMLDivElement>(null);

  const update = (s: string, c: string, t: 'today' | '24h' | 'all') => {
    onFilterChange({ service: s, callsign: c, timeRange: t });
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasActiveFilter = service !== '' || callsign !== '' || timeRange !== 'today';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer transition-colors"
        style={{
          color: hasActiveFilter ? '#3DFF8C' : 'hsl(var(--foreground))',
          border: `1px solid ${hasActiveFilter ? 'rgba(61,255,140,0.4)' : 'hsl(var(--border))'}`,
          background: hasActiveFilter ? 'rgba(61,255,140,0.08)' : 'transparent',
        }}
      >
        <SlidersHorizontal size={18} />
      </button>

      {open && (
        <div
          className="fixed left-0 right-0 z-50 shadow-xl"
          style={{
            top: ref.current?.getBoundingClientRect().bottom ?? 0,
            background: '#0D1117',
            borderBottom: '1px solid #0F1820',
            padding: '16px 20px',
          }}
        >
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[160px]">
              <label style={labelStyle}>SERVICE</label>
              <select
                value={service}
                onChange={(e) => { setService(e.target.value); update(e.target.value, callsign, timeRange); }}
                style={selectStyle}
              >
                {SERVICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[160px]">
              <label style={labelStyle}>UNIT</label>
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
            </div>

            <div className="flex-1 min-w-[160px]">
              <label style={labelStyle}>TIME RANGE</label>
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

            {hasActiveFilter && (
              <button
                onClick={() => {
                  setService('');
                  setCallsign('');
                  setTimeRange('today');
                  update('', '', 'today');
                }}
                className="text-lg font-bold tracking-wide py-2 px-4 rounded-sm cursor-pointer"
                style={{
                  color: '#FF9500',
                  border: '1px solid rgba(255,149,0,0.3)',
                  background: 'rgba(255,149,0,0.08)',
                }}
              >
                RESET
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
