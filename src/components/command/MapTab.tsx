import { useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { PRIORITY_COLORS, SERVICE_LABELS } from '@/lib/herald-types';

interface Props {
  reports: CommandReport[];
  onSelectReport: (id: string) => void;
}

export interface MapTabHandle {
  flyToReport: (report: CommandReport) => void;
}

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || '').trim();

function getReportPriority(r: CommandReport) {
  return r.assessment?.priority ?? r.priority ?? 'P3';
}

export const MapTab = forwardRef<MapTabHandle, Props>(({ reports, onSelectReport }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupsRef = useRef<Map<string, mapboxgl.Popup>>(new Map());
  const fittedRef = useRef(false);

  const geoReports = useMemo(
    () => reports.filter((r) => r.lat != null && r.lng != null),
    [reports]
  );

  useImperativeHandle(ref, () => ({
    flyToReport: (report: CommandReport) => {
      const map = mapRef.current;
      if (!map || report.lat == null || report.lng == null) return;
      map.flyTo({ center: [report.lng, report.lat], zoom: 14, duration: 1200 });
      const popup = popupsRef.current.get(report.id);
      if (popup) popup.addTo(map);
    },
  }));

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-1.5, 53.5],
      zoom: 6,
      attributionControl: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      popupsRef.current.clear();
      fittedRef.current = false;
    };
  }, []);

  // Update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();
    popupsRef.current.forEach((popup) => popup.remove());
    popupsRef.current.clear();

    geoReports.forEach((r) => {
      const p = getReportPriority(r);
      const color = PRIORITY_COLORS[p] ?? '#34C759';
      const label = SERVICE_LABELS[r.assessment?.service ?? r.service ?? 'unknown'] ?? 'UNK';
      const headline = String(r.assessment?.headline ?? r.headline ?? 'No headline');
      const ts = new Date(r.created_at ?? r.timestamp);
      const timeStr =
        ts.getUTCHours().toString().padStart(2, '0') + ':' +
        ts.getUTCMinutes().toString().padStart(2, '0') + 'Z';

      // Create marker element
      const el = document.createElement('div');
      el.style.width = p === 'P1' ? '20px' : '16px';
      el.style.height = p === 'P1' ? '20px' : '16px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = color;
      el.style.border = '2px solid rgba(255,255,255,0.6)';
      el.style.cursor = 'pointer';
      el.style.boxShadow = `0 0 8px ${color}80`;
      if (r.isNew) {
        el.style.animation = 'pulse 1.5s ease-in-out 3';
      }

      // Popup
      const popupHtml = `
        <div style="font-family: 'IBM Plex Mono', monospace; min-width: 200px;">
          <div style="font-weight: 700; margin-bottom: 4px;">${p} · ${label}</div>
          <div style="margin-bottom: 4px;">${headline}</div>
          <div style="opacity: 0.7; font-size: 12px;">${timeStr} · ${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}</div>
        </div>
      `;

      const popup = new mapboxgl.Popup({ offset: 15, maxWidth: '280px' })
        .setHTML(popupHtml);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([r.lng!, r.lat!])
        .setPopup(popup)
        .addTo(map);

      el.addEventListener('click', () => {
        onSelectReport(r.id);
      });

      markersRef.current.set(r.id, marker);
      popupsRef.current.set(r.id, popup);
    });

    // Fit bounds on first load
    if (!fittedRef.current && geoReports.length > 0) {
      fittedRef.current = true;
      const bounds = new mapboxgl.LngLatBounds();
      geoReports.forEach((r) => bounds.extend([r.lng!, r.lat!]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [geoReports, onSelectReport]);

  if (geoReports.length === 0 && !mapRef.current) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="rounded-lg px-3 py-2 border border-muted bg-muted/30">
          <p className="text-lg text-foreground opacity-60 tracking-wider font-semibold">
            NO GEO LOCATION DATA AVAILABLE
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Legend */}
      <div className="absolute bottom-4 left-4 rounded-lg px-3 py-2.5 z-10 border border-border bg-card">
        <div className="flex flex-col gap-1.5">
          {[
            { p: 'P1', label: 'IMMEDIATE' },
            { p: 'P2', label: 'URGENT' },
            { p: 'P3', label: 'ROUTINE' },
          ].map(({ p, label }) => (
            <div key={p} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: PRIORITY_COLORS[p] }}
              />
              <span className="text-lg text-foreground font-bold tracking-wider">{p}</span>
              <span className="text-lg text-foreground opacity-70">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

MapTab.displayName = 'MapTab';
