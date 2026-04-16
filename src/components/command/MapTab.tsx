import { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { PRIORITY_COLORS, SERVICE_LABELS } from '@/lib/herald-types';

interface Props {
  reports: CommandReport[];
  onSelectReport: (id: string) => void;
}

export interface MapTabHandle {
  flyToReport: (report: CommandReport) => void;
}

function getReportPriority(r: CommandReport) {
  return String(r.assessment?.priority ?? r.priority ?? 'P3');
}

export const MapTab = forwardRef<MapTabHandle, Props>(({ reports, onSelectReport }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const fittedRef = useRef(false);

  const geoReports = useMemo(
    () => reports.filter((r) => r.lat != null && r.lng != null && (r as any).status !== 'closed'),
    [reports]
  );

  useImperativeHandle(ref, () => ({
    flyToReport: (report: CommandReport) => {
      try {
        const map = mapRef.current;
        if (!map || report.lat == null || report.lng == null) return;
        map.setView([report.lat, report.lng], 16, { animate: false });
        const marker = markersRef.current.get(report.id);
        if (marker) marker.openPopup();
      } catch {
        // silent
      }
    },
  }));

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([53.5, -1.5], 6);

    // Dark themed tiles from CartoDB
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;

    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      fittedRef.current = false;
    };
  }, []);

  // Update markers when reports change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    geoReports.forEach((r) => {
      const p = getReportPriority(r);
      const color = PRIORITY_COLORS[p] ?? '#34C759';
      const radius = p === 'P1' ? 12 : p === 'P2' ? 10 : 8;
      const label = SERVICE_LABELS[String(r.assessment?.service ?? r.service ?? 'unknown')] ?? 'UNK';
      const headline = String(r.assessment?.headline ?? r.headline ?? 'No headline');
      const ts = new Date(r.created_at ?? r.timestamp);
      const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' + ts.getUTCMinutes().toString().padStart(2, '0') + 'Z';

      const marker = L.circleMarker([r.lat!, r.lng!], {
        radius,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2,
      }).addTo(map);

      const popupEl = document.createElement('div');
      popupEl.style.fontFamily = "'IBM Plex Mono', monospace";
      popupEl.style.minWidth = '240px';
      popupEl.style.fontSize = '13px';

      const priorityRow = document.createElement('div');
      priorityRow.style.display = 'flex';
      priorityRow.style.alignItems = 'center';
      priorityRow.style.gap = '8px';
      priorityRow.style.marginBottom = '6px';

      const priorityBadge = document.createElement('span');
      priorityBadge.textContent = p;
      priorityBadge.style.fontWeight = '700';
      priorityBadge.style.color = color;
      priorityBadge.style.border = `1px solid ${color}`;
      priorityBadge.style.padding = '2px 6px';
      priorityBadge.style.borderRadius = '3px';
      priorityBadge.style.fontSize = '14px';

      const timeEl = document.createElement('span');
      timeEl.textContent = timeStr;
      timeEl.style.opacity = '0.7';

      const callsignEl = document.createElement('span');
      callsignEl.textContent = String(r.session_callsign ?? '');
      callsignEl.style.fontWeight = '600';
      callsignEl.style.color = '#059669';

      priorityRow.append(priorityBadge, timeEl, callsignEl);

      const headlineEl = document.createElement('div');
      headlineEl.textContent = headline;
      headlineEl.style.marginBottom = '8px';
      headlineEl.style.lineHeight = '1.4';

      const metaEl = document.createElement('div');
      metaEl.style.display = 'flex';
      metaEl.style.flexDirection = 'column';
      metaEl.style.gap = '4px';
      metaEl.style.marginBottom = '8px';
      metaEl.style.opacity = '0.8';
      metaEl.style.fontSize = '12px';

      if (r.session_operator_id) {
        const opEl = document.createElement('div');
        opEl.textContent = `Collar: ${r.session_operator_id}`;
        metaEl.appendChild(opEl);
      }
      if (r.incident_number) {
        const incEl = document.createElement('div');
        incEl.textContent = `Incident #: ${r.incident_number}`;
        metaEl.appendChild(incEl);
      }

      const viewBtn = document.createElement('button');
      viewBtn.textContent = 'VIEW FULL REPORT';
      viewBtn.style.width = '100%';
      viewBtn.style.padding = '8px';
      viewBtn.style.fontWeight = '700';
      viewBtn.style.fontSize = '12px';
      viewBtn.style.letterSpacing = '0.1em';
      viewBtn.style.borderRadius = '4px';
      viewBtn.style.border = `1px solid ${color}`;
      viewBtn.style.background = `${color}1A`;
      viewBtn.style.color = color;
      viewBtn.style.cursor = 'pointer';
      viewBtn.style.fontFamily = "'IBM Plex Mono', monospace";
      viewBtn.onclick = (e) => {
        e.stopPropagation();
        onSelectReport(r.id);
      };

      popupEl.append(priorityRow, headlineEl, metaEl, viewBtn);

      marker.bindPopup(popupEl, { maxWidth: 300 });
      marker.on('click', () => marker.openPopup());
      markersRef.current.set(r.id, marker);
    });

    if (!fittedRef.current && geoReports.length > 0) {
      fittedRef.current = true;
      const bounds = L.latLngBounds(geoReports.map((r) => [r.lat!, r.lng!] as [number, number]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
  }, [geoReports, onSelectReport]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);

  const sortedReports = useMemo(() =>
    [...reports].filter(r => (r as any).status !== 'closed').sort((a, b) => new Date(b.created_at ?? b.timestamp).getTime() - new Date(a.created_at ?? a.timestamp).getTime()),
    [reports]
  );

  const handleListClick = (r: CommandReport) => {
    const map = mapRef.current;
    if (map && r.lat != null && r.lng != null) {
      // Instant jump — no animation lag
      map.setView([r.lat, r.lng], 17, { animate: false });
      const marker = markersRef.current.get(r.id);
      if (marker) marker.openPopup();
    }
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Incident list panel */}
      <div
        className="absolute top-2 left-2 z-10 flex flex-col"
        style={{ maxHeight: 'calc(100% - 16px)', width: listOpen ? 340 : 40 }}
      >
        <button
          onClick={() => setListOpen(!listOpen)}
          className="rounded-t-lg px-3 py-2 border border-border bg-card text-foreground font-bold text-lg tracking-wider cursor-pointer"
          style={{ borderBottom: listOpen ? 'none' : undefined, borderRadius: listOpen ? '6px 6px 0 0' : '6px' }}
        >
          {listOpen ? '◀ INCIDENTS' : '▶'}
        </button>
        {listOpen && (
          <div className="flex-1 overflow-y-auto border border-t-0 border-border bg-card/95 rounded-b-lg" style={{ scrollbarWidth: 'thin' }}>
            {sortedReports.length === 0 ? (
              <div className="p-3 text-lg text-foreground opacity-50">No incidents</div>
            ) : (
              sortedReports.map((r) => {
                const p = getReportPriority(r);
                const color = PRIORITY_COLORS[p] ?? '#34C759';
                const ts = new Date(r.created_at ?? r.timestamp);
                const timeStr = ts.getUTCHours().toString().padStart(2, '0') + ':' + ts.getUTCMinutes().toString().padStart(2, '0') + 'Z';
                const hasGeo = r.lat != null && r.lng != null;
                return (
                  <button
                    key={r.id}
                    onClick={() => handleListClick(r)}
                    onMouseEnter={() => setHoveredId(r.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className="w-full text-left block px-3 py-3 border-b border-border cursor-pointer transition-colors"
                    style={{
                      background: hoveredId === r.id ? `${color}15` : 'transparent',
                      opacity: hasGeo ? 1 : 0.4,
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold px-1.5 py-0.5 rounded" style={{ color, border: `1px solid ${color}66` }}>{p}</span>
                      <span className="text-sm text-foreground">{timeStr}</span>
                      {r.session_callsign && (
                        <span className="text-sm font-semibold" style={{ color: '#059669' }}>{String(r.session_callsign)}</span>
                      )}
                    </div>
                    <div className="text-sm text-foreground" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {String(r.assessment?.headline ?? r.headline ?? '—')}
                    </div>
                    {!hasGeo && (
                      <div className="text-sm mt-0.5" style={{ color: '#FF9500' }}>No location</div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {geoReports.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-5">
          <div className="rounded-lg px-4 py-3 border border-muted bg-card/80">
            <p className="text-lg text-foreground opacity-60 tracking-wider font-semibold">
              AWAITING GEO DATA
            </p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-14 rounded-lg px-3 py-2 z-10 border border-border bg-card/90">
        <div className="flex gap-4">
          {[
            { p: 'P1', label: 'IMM' },
            { p: 'P2', label: 'URG' },
            { p: 'P3', label: 'RTN' },
          ].map(({ p, label }) => (
            <div key={p} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY_COLORS[p] }} />
              <span className="text-xs text-foreground font-bold">{p}</span>
              <span className="text-xs text-foreground opacity-60">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

MapTab.displayName = 'MapTab';
