import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Clock, User, Radio } from 'lucide-react';
import { useOpsLog, type Shift, type OpsReport, type OpsFilters } from '@/hooks/useOpsLog';
import { SERVICE_LABELS, PRIORITY_COLORS } from '@/lib/herald-types';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function shiftDuration(s: Shift) {
  if (!s.ended_at) return 'Active';
  const ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function matchesSearch(text: string | null | undefined, query: string): boolean {
  if (!text || !query) return !query;
  return text.toLowerCase().includes(query.toLowerCase());
}

function applyFilters(shifts: Shift[], reports: OpsReport[], filters: OpsFilters) {
  const q = filters.search.trim().toLowerCase();
  let filteredShifts = [...shifts];
  let filteredReports = [...reports];

  if (filters.service) {
    filteredShifts = filteredShifts.filter((s) => s.service === filters.service);
    filteredReports = filteredReports.filter((r) => (r.assessment?.service ?? r.service ?? r.session_service) === filters.service);
  }

  if (filters.station) {
    filteredShifts = filteredShifts.filter((s) => s.station === filters.station);
    filteredReports = filteredReports.filter((r) => r.session_station === filters.station);
  }

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    filteredShifts = filteredShifts.filter((s) => new Date(s.started_at).getTime() >= from);
    filteredReports = filteredReports.filter((r) => new Date(r.created_at ?? r.timestamp).getTime() >= from);
  }

  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime() + 86400000;
    filteredShifts = filteredShifts.filter((s) => new Date(s.started_at).getTime() < to);
    filteredReports = filteredReports.filter((r) => new Date(r.created_at ?? r.timestamp).getTime() < to);
  }

  if (q) {
    // Search across callsign, operator_id, incident number (in assessment structured), transcript
    filteredShifts = filteredShifts.filter(
      (s) =>
        matchesSearch(s.callsign, q) ||
        matchesSearch(s.operator_id, q) ||
        matchesSearch(s.station, q)
    );

    filteredReports = filteredReports.filter(
      (r) =>
        matchesSearch(r.session_callsign, q) ||
        matchesSearch(r.session_operator_id, q) ||
        matchesSearch(r.transcript, q) ||
        matchesSearch(r.headline, q) ||
        matchesSearch(r.assessment?.structured?.incident_number, q) ||
        matchesSearch(r.assessment?.structured?.callsign, q)
    );
  }

  return { filteredShifts, filteredReports };
}

function ShiftCard({
  shift,
  reports,
  expanded,
  onToggle,
}: {
  shift: Shift;
  reports: OpsReport[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const isActive = !shift.ended_at;
  const shiftReports = reports.filter((r) => r.shift_id === shift.id);

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown size={16} className="text-muted-foreground flex-shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-foreground">{shift.callsign}</span>
            <span
              className="text-sm px-1.5 py-0.5 rounded"
              style={{
                background: isActive ? 'rgba(52,199,89,0.15)' : 'rgba(255,255,255,0.05)',
                color: isActive ? '#34C759' : 'hsl(var(--muted-foreground))',
                border: isActive ? '1px solid rgba(52,199,89,0.3)' : '1px solid hsl(var(--border))',
              }}
            >
              {isActive ? 'ACTIVE' : shiftDuration(shift)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground flex-wrap">
            <span>{SERVICE_LABELS[shift.service] ?? shift.service}</span>
            {shift.operator_id && <span className="flex items-center gap-1"><User size={12} /> {shift.operator_id}</span>}
            {shift.station && <span>· {shift.station}</span>}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><Clock size={12} /> {formatTime(shift.started_at)}</span>
          <span className="flex items-center gap-1"><Radio size={12} /> {shift.report_count ?? shiftReports.length}</span>
        </div>
      </button>

      {expanded && shiftReports.length > 0 && (
        <div className="border-t border-border">
          {shiftReports.map((r) => {
            const p = r.assessment?.priority ?? r.priority;
            const color = p ? PRIORITY_COLORS[p] ?? 'hsl(var(--muted-foreground))' : 'hsl(var(--muted-foreground))';
            const txCount = r.transmission_count ?? 1;
            const isActive = r.status === 'active';
            const isClosed = r.status === 'closed';
            return (
              <div key={r.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-border/50 last:border-b-0">
                <span className="text-sm font-bold flex-shrink-0 mt-0.5" style={{ color, minWidth: 24 }}>
                  {p ?? '—'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-foreground truncate max-w-[300px]">
                      {r.headline ?? r.assessment?.headline ?? r.transcript?.slice(0, 80) ?? 'No transcript'}
                    </span>
                    {r.incident_number && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
                        style={{ border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}>
                        #{r.incident_number}
                      </span>
                    )}
                    {txCount > 1 && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ color: '#1E90FF', border: '1px solid rgba(30,144,255,0.3)', background: 'rgba(30,144,255,0.08)' }}>
                        {txCount} TX
                      </span>
                    )}
                    {isClosed && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ color: '#888', border: '1px solid rgba(136,136,136,0.3)', background: 'rgba(136,136,136,0.08)' }}>
                        CLOSED
                      </span>
                    )}
                    {isActive && r.incident_number && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ color: '#FF9500', border: '1px solid rgba(255,149,0,0.3)', background: 'rgba(255,149,0,0.08)' }}>
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(r.latest_transmission_at ?? r.created_at ?? r.timestamp)}
                    {r.assessment?.structured?.incident_number && !r.incident_number && ` · INC ${r.assessment.structured.incident_number}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {expanded && shiftReports.length === 0 && (
        <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          No reports during this shift
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'hsl(var(--background))',
  border: '1px solid hsl(var(--border))',
  color: 'hsl(var(--foreground))',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none',
  width: '100%',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
};

export function OpsLogTab() {
  const { shifts, reports, loading, uniqueServices, uniqueStations } = useOpsLog();
  const [expandedShift, setExpandedShift] = useState<string | null>(null);
  const [filters, setFilters] = useState<OpsFilters>({
    search: '',
    service: '',
    station: '',
    dateFrom: '',
    dateTo: '',
  });

  const { filteredShifts, filteredReports } = useMemo(
    () => applyFilters(shifts, reports, filters),
    [shifts, reports, filters]
  );

  // Orphaned reports: no shift_id OR shift_id doesn't match any known shift
  const shiftIds = useMemo(() => new Set(shifts.map((s) => s.id)), [shifts]);
  const orphanReports = useMemo(
    () => filteredReports.filter((r) => !r.shift_id || !shiftIds.has(r.shift_id)),
    [filteredReports, shiftIds]
  );

  const updateFilter = (key: keyof OpsFilters, val: string) => {
    setFilters((prev) => ({ ...prev, [key]: val }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-lg tracking-widest">
        LOADING OPS LOG...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search & Filters */}
      <div className="flex-shrink-0 p-3 border-b border-border space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Search callsign, collar number, incident, transcript..."
            style={{ ...inputStyle, paddingLeft: 36 }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={filters.service}
            onChange={(e) => updateFilter('service', e.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 120 }}
          >
            <option value="">All services</option>
            {uniqueServices.map((s) => (
              <option key={s} value={s}>{SERVICE_LABELS[s] ?? s}</option>
            ))}
          </select>
          <select
            value={filters.station}
            onChange={(e) => updateFilter('station', e.target.value)}
            style={{ ...selectStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="">All stations</option>
            {uniqueStations.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
            style={{ ...inputStyle, width: 'auto' }}
            title="From date"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
            style={{ ...inputStyle, width: 'auto' }}
            title="To date"
          />
          {(filters.search || filters.service || filters.station || filters.dateFrom || filters.dateTo) && (
            <button
              onClick={() => setFilters({ search: '', service: '', station: '', dateFrom: '', dateTo: '' })}
              className="px-3 py-1.5 text-sm rounded border cursor-pointer"
              style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredShifts.length === 0 && orphanReports.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-lg tracking-widest">
            NO MATCHING RECORDS
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground tracking-widest mb-2">
              {filteredShifts.length} SHIFT{filteredShifts.length !== 1 ? 'S' : ''} · {filteredReports.length} REPORT{filteredReports.length !== 1 ? 'S' : ''}
            </div>

            {filteredShifts.map((shift) => (
              <ShiftCard
                key={shift.id}
                shift={shift}
                reports={filteredReports}
                expanded={expandedShift === shift.id}
                onToggle={() => setExpandedShift((prev) => (prev === shift.id ? null : shift.id))}
              />
            ))}

            {orphanReports.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground tracking-widest mb-2">
                  {orphanReports.length} UNLINKED REPORT{orphanReports.length !== 1 ? 'S' : ''}
                </div>
                <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                  {orphanReports.map((r) => {
                    const p = r.assessment?.priority ?? r.priority;
                    const color = p ? PRIORITY_COLORS[p] ?? 'hsl(var(--muted-foreground))' : 'hsl(var(--muted-foreground))';
                    return (
                      <div key={r.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-border/50 last:border-b-0">
                        <span className="text-sm font-bold flex-shrink-0 mt-0.5" style={{ color, minWidth: 24 }}>
                          {p ?? '—'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground block truncate">
                            {r.headline ?? r.assessment?.headline ?? r.transcript?.slice(0, 80) ?? 'No transcript'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(r.created_at ?? r.timestamp)}
                            {r.session_callsign && ` · ${r.session_callsign}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
