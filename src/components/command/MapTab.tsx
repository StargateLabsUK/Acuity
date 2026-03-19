import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { PRIORITY_COLORS, SERVICE_EMOJIS } from '@/lib/herald-types';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

interface Props {
  reports: CommandReport[];
  onSelectReport: (id: string) => void;
}

export interface MapTabHandle {
  flyToReport: (report: CommandReport) => void;
}

const PRIORITY_RADIUS: Record<string, number> = { P1: 12, P2: 10, P3: 8 };

function getReportPriority(r: CommandReport) {
  return r.assessment?.priority ?? r.priority ?? 'P3';
}

export const MapTab = forwardRef<MapTabHandle, Props>(({ reports, onSelectReport }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const fittedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    flyToReport: (report: CommandReport) => {
      const map = mapRef.current;
      if (!map || report.lat == null || report.lng == null) return;
      map.flyTo({ center: [report.lng, report.lat], zoom: 13, duration: 1500 });
      // Open the marker popup
      const marker = markersRef.current.get(report.id);
      if (marker) {
        marker.togglePopup();
      }
    },
  }));

  // Init map
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-2.5, 54.5],
      zoom: 6,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      fittedRef.current = false;
    };
  }, []);

  const addMarker = useCallback(
    (r: CommandReport, animate = false) => {
      const map = mapRef.current;
      if (!map || r.lat == null || r.lng == null) return;
      if (markersRef.current.has(r.id)) return;

      const p = getReportPriority(r);
      const color = PRIORITY_COLORS[p] ?? '#34C759';
      const radius = PRIORITY_RADIUS[p] ?? 8;
      const emoji = SERVICE_EMOJIS[r.assessment?.service ?? r.service ?? 'unknown'] ?? '📻';

      const el = document.createElement('div');
      el.style.width = `${radius * 2}px`;
      el.style.height = `${radius * 2}px`;
      el.style.borderRadius = '50%';
      el.style.backgroundColor = color;
      el.style.border = `2px solid ${color}`;
      el.style.boxShadow = `0 0 8px ${color}66`;
      el.style.cursor = 'pointer';

      if (animate) {
        el.style.animation = 'pulse-marker 1s ease-out';
      }

      const headline = r.assessment?.headline ?? r.headline ?? 'No headline';
      const service = r.assessment?.service ?? r.service ?? 'unknown';
      const ts = new Date(r.created_at ?? r.timestamp);
      const timeStr =
        ts.getUTCHours().toString().padStart(2, '0') + ':' +
        ts.getUTCMinutes().toString().padStart(2, '0') + 'Z';
      const callsign = r.assessment?.structured?.callsign ?? '';

      const popup = new mapboxgl.Popup({ offset: 15, maxWidth: '280px' }).setHTML(`
        <div style="font-family:Inter,sans-serif;color:#E6EDF3;padding:4px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="background:${color};color:#fff;font-weight:700;padding:2px 8px;border-radius:4px;font-size:13px;">${p}</span>
            <span style="font-size:16px;">${emoji}</span>
            <span style="font-size:13px;text-transform:uppercase;font-weight:600;">${service}</span>
          </div>
          <p style="font-size:13px;line-height:1.4;margin:0 0 6px;">${headline}</p>
          <div style="font-size:11px;opacity:0.7;">${timeStr}${callsign ? ` · ${callsign}` : ''}</div>
          <button
            onclick="window.__heraldSelectReport('${r.id}')"
            style="margin-top:8px;width:100%;padding:6px;background:${color}1A;border:1px solid ${color};color:${color};font-weight:700;font-size:12px;border-radius:4px;cursor:pointer;letter-spacing:0.05em;"
          >VIEW FULL REPORT</button>
        </div>
      `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([r.lng, r.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.set(r.id, marker);
    },
    [onSelectReport]
  );

  useEffect(() => {
    (window as any).__heraldSelectReport = (id: string) => {
      onSelectReport(id);
    };
    return () => {
      delete (window as any).__heraldSelectReport;
    };
  }, [onSelectReport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const geoReports = reports.filter((r) => r.lat != null && r.lng != null);
    geoReports.forEach((r) => {
      if (!markersRef.current.has(r.id)) {
        addMarker(r, r.isNew);
      }
    });

    if (!fittedRef.current && geoReports.length > 0) {
      fittedRef.current = true;
      const bounds = new mapboxgl.LngLatBounds();
      geoReports.forEach((r) => bounds.extend([r.lng!, r.lat!]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [reports, addMarker]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-foreground opacity-50 text-sm tracking-widest">
          MAPBOX TOKEN NOT CONFIGURED
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Legend */}
      <div
        className="absolute bottom-4 left-4 rounded-lg px-3 py-2.5 z-10"
        style={{ background: '#0D1117', border: '1px solid #0F1820' }}
      >
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
              <span className="text-xs text-foreground font-bold tracking-wider">{p}</span>
              <span className="text-xs text-foreground opacity-70">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse-marker {
          0% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 currentColor; }
          50% { transform: scale(1.8); opacity: 0.6; }
          100% { transform: scale(1); opacity: 1; }
        }
        .mapboxgl-ctrl-logo { display: none !important; }
        .mapboxgl-ctrl-attrib { display: none !important; }
      `}</style>
    </div>
  );
});

MapTab.displayName = 'MapTab';
