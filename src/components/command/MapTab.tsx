import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { CommandReport } from '@/hooks/useHeraldCommand';
import { PRIORITY_COLORS, SERVICE_LABELS } from '@/lib/herald-types';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

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
      const marker = markersRef.current.get(report.id);
      if (marker) {
        marker.togglePopup();
      }
    },
  }));

  const [webglFailed, setWebglFailed] = useState(() => !isWebGLSupported());

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN || webglFailed) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/navigation-night-v1',
        center: [-2.5, 54.5],
        zoom: 6,
        attributionControl: false,
      });

      map.on('load', () => {
        map.resize();
      });

      // Also resize after a short delay for containers that settle layout late
      const resizeTimer = setTimeout(() => map.resize(), 200);

      map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      mapRef.current = map;

      return () => {
        clearTimeout(resizeTimer);
        map.remove();
        mapRef.current = null;
        markersRef.current.clear();
        fittedRef.current = false;
      };
    } catch (e) {
      console.warn('MapTab: WebGL not available, falling back to placeholder', e);
      setWebglFailed(true);
    }
  }, []);

  const addMarker = useCallback(
    (r: CommandReport, animate = false) => {
      const map = mapRef.current;
      if (!map || r.lat == null || r.lng == null) return;
      if (markersRef.current.has(r.id)) return;

      const p = getReportPriority(r);
      const color = PRIORITY_COLORS[p] ?? '#34C759';
      const radius = PRIORITY_RADIUS[p] ?? 8;
      const label = SERVICE_LABELS[r.assessment?.service ?? r.service ?? 'unknown'] ?? 'UNK';

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
        <div style="font-family:Inter,sans-serif;color:#1A1E24;padding:4px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="background:${color};color:#fff;font-weight:700;padding:2px 8px;border-radius:4px;font-size:13px;">${p}</span>
            <span style="font-size:13px;text-transform:uppercase;font-weight:600;">${label}</span>
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

  if (!MAPBOX_TOKEN || webglFailed) {
    const geoReports = reports
      .filter((r) => r.lat != null && r.lng != null)
      .sort((a, b) => {
        const pOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2 };
        return (pOrder[getReportPriority(a)] ?? 3) - (pOrder[getReportPriority(b)] ?? 3);
      });

    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="mb-4 rounded-lg px-3 py-2 border border-muted bg-muted/30">
          <p className="text-lg text-foreground opacity-60 tracking-wider font-semibold">
            {!MAPBOX_TOKEN ? 'MAPBOX TOKEN NOT CONFIGURED' : 'MAP UNAVAILABLE — INCIDENT LIST VIEW'}
          </p>
          <p className="text-lg text-foreground opacity-60 mt-2">
            WEBGL IS DISABLED ON THIS DEVICE. SELECT AN INCIDENT TO OPEN DETAILS OR OPEN ITS LOCATION IN EXTERNAL MAPS.
          </p>
        </div>
        {geoReports.length === 0 ? (
          <p className="text-lg text-foreground opacity-40 text-center mt-12 tracking-wider">NO GEO-LOCATED INCIDENTS</p>
        ) : (
          <div className="flex flex-col gap-2">
            {geoReports.map((r) => {
              const p = getReportPriority(r);
              const color = PRIORITY_COLORS[p] ?? '#34C759';
              const headline = r.assessment?.headline ?? r.headline ?? 'No headline';
              const label = SERVICE_LABELS[r.assessment?.service ?? r.service ?? 'unknown'] ?? 'UNK';
              const ts = new Date(r.created_at ?? r.timestamp);
              const timeStr =
                ts.getUTCHours().toString().padStart(2, '0') + ':' +
                ts.getUTCMinutes().toString().padStart(2, '0') + 'Z';
              const mapsHref = `https://www.google.com/maps?q=${r.lat},${r.lng}`;

              return (
                <div key={r.id} className="rounded-lg p-3 border border-muted/40 bg-background/40">
                  <button
                    onClick={() => onSelectReport(r.id)}
                    className="w-full flex items-start gap-3 text-left transition-colors hover:bg-muted/30 rounded"
                  >
                    <span
                      className="mt-1 flex-shrink-0 rounded px-2 py-0.5 text-lg font-bold text-primary-foreground"
                      style={{ backgroundColor: color }}
                    >
                      {p}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold text-foreground uppercase tracking-wider">{label}</span>
                        <span className="text-lg text-foreground opacity-50">{timeStr}</span>
                      </div>
                      <p className="text-lg text-foreground opacity-80 truncate">{headline}</p>
                      <p className="text-lg text-foreground opacity-40 font-mono">
                        {r.lat!.toFixed(4)}, {r.lng!.toFixed(4)}
                      </p>
                    </div>
                  </button>

                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center justify-center rounded border border-border bg-card px-3 py-1 text-lg font-semibold tracking-wider text-foreground hover:bg-muted/40"
                  >
                    OPEN IN MAPS
                  </a>
                </div>
              );
            })}
          </div>
        )}
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
              <span className="text-lg text-foreground font-bold tracking-wider">{p}</span>
              <span className="text-lg text-foreground opacity-70">{label}</span>
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