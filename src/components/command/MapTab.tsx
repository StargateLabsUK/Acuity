import { useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
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

const PRIORITY_RADIUS: Record<string, number> = { P1: 12, P2: 10, P3: 8 };

function getReportPriority(r: CommandReport) {
  return r.assessment?.priority ?? r.priority ?? 'P3';
}

export const MapTab = forwardRef<MapTabHandle, Props>(({ reports, onSelectReport }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const fittedRef = useRef(false);

  const geoReports = useMemo(
    () => reports.filter((r) => r.lat != null && r.lng != null),
    [reports]
  );

  useImperativeHandle(ref, () => ({
    flyToReport: (report: CommandReport) => {
      const map = mapRef.current;
      if (!map || report.lat == null || report.lng == null) return;
      map.flyTo([report.lat, report.lng], 13, { duration: 1.2 });
      const marker = markersRef.current.get(report.id);
      if (marker) {
        marker.openPopup();
      }
    },
  }));

  useEffect(() => {
    if (!containerRef.current || geoReports.length === 0 || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([54.5, -2.5], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 100);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      fittedRef.current = false;
    };
  }, [geoReports.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    geoReports.forEach((r) => {
      const p = getReportPriority(r);
      const color = PRIORITY_COLORS[p] ?? '#34C759';
      const radius = PRIORITY_RADIUS[p] ?? 8;
      const label = SERVICE_LABELS[r.assessment?.service ?? r.service ?? 'unknown'] ?? 'UNK';
      const headline = r.assessment?.headline ?? r.headline ?? 'No headline';
      const ts = new Date(r.created_at ?? r.timestamp);
      const timeStr =
        ts.getUTCHours().toString().padStart(2, '0') + ':' +
        ts.getUTCMinutes().toString().padStart(2, '0') + 'Z';

      const popupContent = document.createElement('div');
      popupContent.style.display = 'flex';
      popupContent.style.flexDirection = 'column';
      popupContent.style.gap = '6px';
      popupContent.style.minWidth = '220px';

      const title = document.createElement('div');
      title.style.fontWeight = '700';
      title.textContent = `${p} · ${label}`;

      const body = document.createElement('div');
      body.textContent = headline;

      const meta = document.createElement('div');
      meta.style.opacity = '0.7';
      meta.textContent = `${timeStr} · ${r.lat?.toFixed(4)}, ${r.lng?.toFixed(4)}`;

      const viewButton = document.createElement('button');
      viewButton.type = 'button';
      viewButton.textContent = 'VIEW FULL REPORT';
      viewButton.style.padding = '6px 10px';
      viewButton.style.borderRadius = '6px';
      viewButton.style.border = `1px solid ${color}`;
      viewButton.style.background = `${color}1A`;
      viewButton.style.cursor = 'pointer';
      viewButton.style.fontWeight = '700';
      viewButton.onclick = () => onSelectReport(r.id);

      popupContent.append(title, body, meta, viewButton);

      const marker = L.circleMarker([r.lat!, r.lng!], {
        radius,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2,
      })
        .addTo(map)
        .bindPopup(popupContent, { maxWidth: 280 });

      marker.on('click', () => onSelectReport(r.id));

      if (r.isNew) {
        marker.setStyle({ weight: 4 });
        window.setTimeout(() => marker.setStyle({ weight: 2 }), 900);
      }

      markersRef.current.set(r.id, marker);
    });

    if (!fittedRef.current && geoReports.length > 0) {
      fittedRef.current = true;
      const bounds = L.latLngBounds(geoReports.map((r) => [r.lat!, r.lng!] as [number, number]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
  }, [geoReports, onSelectReport]);

  if (geoReports.length === 0) {
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
      <div
        className="absolute bottom-4 left-4 rounded-lg px-3 py-2.5 z-10 border border-border bg-card"
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

    </div>
  );
});

MapTab.displayName = 'MapTab';