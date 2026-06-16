import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DirectionInfo, LiveVehicle } from '../lib/useRailLine';
import type { ParsedFeed } from '../lib/gtfsrt';

// ─── Types ───────────────────────────────────────────────────────────────────

type Pt = { lat: number; lon: number };

interface RouteGeometry {
  shape: Pt[];
  stopShapeIndex: Map<string, number>;
  stopCoords: Map<string, Pt>;
}

// ─── CSS animations (injected once) ──────────────────────────────────────────

const MARKER_CSS = `
@keyframes vm-pulse {
  0%   { transform: scale(1);   opacity: 0.55; }
  70%  { transform: scale(2.4); opacity: 0;    }
  100% { transform: scale(2.4); opacity: 0;    }
}
.vm-pulse {
  transform-box: fill-box;
  transform-origin: center;
  animation: vm-pulse 1.8s ease-out infinite;
}
`;

function injectMarkerStyles() {
  if (document.getElementById('vm-styles')) return;
  const el = document.createElement('style');
  el.id = 'vm-styles';
  el.textContent = MARKER_CSS;
  document.head.appendChild(el);
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

const DIR_COLORS = ['#38bdf8', '#a78bfa'];

function dirColor(v: LiveVehicle): string {
  return DIR_COLORS[v.directionId ?? 0] ?? DIR_COLORS[0];
}

function delayColor(v: LiveVehicle): string {
  const d = v.delaySeconds ?? 0;
  if (d > 600) return '#ef4444';
  if (d > 60)  return '#facc15';
  if (d < -60) return '#818cf8'; // running early
  return '#22c55e';
}

// ─── Zoom scale ──────────────────────────────────────────────────────────────

function zoomScale(zoom: number): number {
  // 0.75× at zoom ≤10, 1× at zoom 12, 1.4× at zoom 15+
  return Math.max(0.75, Math.min(1.4, 0.75 + (zoom - 10) * 0.13));
}

// ─── Vehicle icon ─────────────────────────────────────────────────────────────

/**
 * Builds a Leaflet DivIcon for a vehicle. The shape is an SVG "navigation
 * arrow" — a chevron pointing up before rotation, rotated to the vehicle's
 * bearing. The body circle carries the direction colour; a thin outer ring
 * carries the delay colour; a pulsing halo appears only for STOPPED_AT.
 *
 * Rail vehicles are slightly larger than buses.
 */
function makeVehicleIcon(v: LiveVehicle, isRail: boolean, zoom: number): L.DivIcon {
  const scale  = zoomScale(zoom);
  const base   = isRail ? 28 : 22;
  const size   = Math.round(base * scale);
  const half   = size / 2;
  const bearing = v.bearing ?? 0;
  const stopped = v.status === 'STOPPED_AT';
  const dc      = dirColor(v);
  const rc      = delayColor(v);

  // SVG is drawn in a 0 0 24 24 viewBox, anchor at centre (12,12).
  // The arrow chevron points "up" (north) and the whole SVG rotates to bearing.
  const pulseEl = stopped
    ? `<circle class="vm-pulse" cx="12" cy="12" r="10" fill="${dc}" opacity="0.35"/>`
    : '';

  const trainStripes = isRail
    ? `<line x1="9" y1="10" x2="15" y2="10" stroke="white" stroke-width="1" opacity="0.35"/>
       <line x1="9" y1="13" x2="15" y2="13" stroke="white" stroke-width="1" opacity="0.35"/>`
    : '';

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="${size}" height="${size}"
     viewBox="0 0 24 24"
     overflow="visible"
     style="transform:rotate(${bearing}deg);transform-origin:12px 12px;display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))">
  ${pulseEl}
  <!-- Delay ring -->
  <circle cx="12" cy="12" r="11" fill="none" stroke="${rc}" stroke-width="2.2" opacity="0.9"/>
  <!-- Body -->
  <circle cx="12" cy="12" r="8" fill="${dc}"/>
  <!-- Subtle inner gradient highlight -->
  <circle cx="10" cy="10" r="3.5" fill="white" opacity="0.12"/>
  ${trainStripes}
  <!-- Direction chevron (arrow pointing north = up) -->
  <path d="M12,1 L17.5,11 L12,8.5 L6.5,11 Z" fill="white" opacity="0.92"/>
</svg>`;

  return L.divIcon({
    html: svg,
    className: '',
    iconSize:   [size, size],
    iconAnchor: [half, half],
    tooltipAnchor: [half + 4, -half],
  });
}

// ─── Route geometry (shape-based interpolation) ───────────────────────────────

function sq(x: number) { return x * x; }
function dist2(a: Pt, b: Pt) { return sq(a.lat - b.lat) + sq(a.lon - b.lon); }

function nearestShapeIndex(shape: Pt[], stop: Pt): number {
  let best = 0, bestD = dist2(shape[0], stop);
  for (let i = 1; i < shape.length; i++) {
    const d = dist2(shape[i], stop);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function buildRouteGeometry(directions: DirectionInfo[]): Map<number, RouteGeometry> {
  const result = new Map<number, RouteGeometry>();
  for (const dir of directions) {
    const shape = dir.shape.length > 1 ? dir.shape : [];
    const stopShapeIndex = new Map<string, number>();
    const stopCoords     = new Map<string, Pt>();
    for (const s of dir.stops) {
      const pt: Pt = { lat: s.stop_lat, lon: s.stop_lon };
      stopCoords.set(s.stop_id, pt);
      if (shape.length > 0) stopShapeIndex.set(s.stop_id, nearestShapeIndex(shape, pt));
    }
    result.set(dir.directionId, { shape, stopShapeIndex, stopCoords });
  }
  return result;
}

function walkPolyline(pts: Pt[], fraction: number): Pt {
  if (pts.length === 1) return pts[0];
  const f = Math.max(0, Math.min(1, fraction));
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.sqrt(dist2(pts[i], pts[i - 1])));
  const total = lens[lens.length - 1];
  if (total === 0) return pts[0];
  const target = f * total;
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] >= target) {
      const t = (lens[i] - lens[i - 1]) === 0 ? 0 : (target - lens[i - 1]) / (lens[i] - lens[i - 1]);
      return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t, lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * t };
    }
  }
  return pts[pts.length - 1];
}

function interpolatePosition(
  v: LiveVehicle,
  tripUpdates: ParsedFeed | null,
  routeGeometry: Map<number, RouteGeometry>,
  nowSec: number,
): Pt | null {
  const rawLat = v.lat, rawLon = v.lon;
  if (rawLat == null || rawLon == null) return null;
  if (v.status !== 'IN_TRANSIT_TO') return { lat: rawLat, lon: rawLon };
  if (!tripUpdates?.entity || !v.tripId) return { lat: rawLat, lon: rawLon };

  const entity = tripUpdates.entity.find((e) => e.tripUpdate?.trip?.tripId === v.tripId);
  if (!entity) return { lat: rawLat, lon: rawLon };

  const stus: any[] = entity.tripUpdate?.stopTimeUpdate ?? [];
  if (stus.length < 2) return { lat: rawLat, lon: rawLon };

  let fromIdx = -1;
  for (let i = 0; i < stus.length - 1; i++) {
    const depTime = Number(stus[i].departure?.time ?? stus[i].arrival?.time ?? 0);
    const arrTime = Number(stus[i + 1].arrival?.time ?? stus[i + 1].departure?.time ?? 0);
    if (depTime > 0 && arrTime > 0 && depTime <= nowSec && arrTime >= nowSec) { fromIdx = i; break; }
  }
  if (fromIdx === -1) return { lat: rawLat, lon: rawLon };

  const fromStu = stus[fromIdx], toStu = stus[fromIdx + 1];
  const depTime = Number(fromStu.departure?.time ?? fromStu.arrival?.time);
  const arrTime = Number(toStu.arrival?.time   ?? toStu.departure?.time);
  if (!depTime || !arrTime || arrTime <= depTime) return { lat: rawLat, lon: rawLon };

  const fraction = Math.max(0, Math.min(1, (nowSec - depTime) / (arrTime - depTime)));
  const geo      = routeGeometry.get(v.directionId ?? 0);
  if (!geo) return { lat: rawLat, lon: rawLon };

  const fromStopId: string | undefined = fromStu.stopId;
  const toStopId:   string | undefined = toStu.stopId;

  if (geo.shape.length > 1 && fromStopId && toStopId) {
    const fi = geo.stopShapeIndex.get(fromStopId);
    const ti = geo.stopShapeIndex.get(toStopId);
    if (fi != null && ti != null && fi !== ti) {
      const lo = Math.min(fi, ti), hi = Math.max(fi, ti);
      let seg = geo.shape.slice(lo, hi + 1);
      if (fi > ti) seg = seg.slice().reverse();
      return walkPolyline(seg, fraction);
    }
  }

  const fc = fromStopId ? geo.stopCoords.get(fromStopId) : null;
  const tc = toStopId   ? geo.stopCoords.get(toStopId)   : null;
  if (!fc || !tc) return { lat: rawLat, lon: rawLon };
  return { lat: fc.lat + (tc.lat - fc.lat) * fraction, lon: fc.lon + (tc.lon - fc.lon) * fraction };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RailLineMap({
  directions,
  vehicles,
  tripUpdates,
  routeColor,
  routeType,
  drivingRoute,
}: {
  directions: DirectionInfo[];
  vehicles: LiveVehicle[];
  tripUpdates: ParsedFeed | null;
  routeColor?: string | null;
  routeType?: number | null;
  drivingRoute?: { points: [number, number][]; origin: [number, number]; destination: [number, number] } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const markerRefs   = useRef<Map<string, L.Marker>>(new Map());
  // Cache latest vehicle data per id so zoom-triggered icon refresh can read it.
  const vehicleDataRef   = useRef<Map<string, LiveVehicle>>(new Map());
  const vehiclesRef      = useRef(vehicles);
  const tripUpdatesRef   = useRef(tripUpdates);
  const routeGeoRef      = useRef<Map<number, RouteGeometry>>(new Map());
  const isRail           = routeType != null && routeType !== 3;

  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);
  useEffect(() => { tripUpdatesRef.current = tripUpdates; }, [tripUpdates]);
  useEffect(() => { routeGeoRef.current = buildRouteGeometry(directions); }, [directions]);

  // Refresh all vehicle icon sizes when the user zooms.
  function refreshIconsForZoom(zoom: number) {
    for (const [id, marker] of markerRefs.current) {
      const v = vehicleDataRef.current.get(id);
      if (v) marker.setIcon(makeVehicleIcon(v, isRail, zoom));
    }
  }

  // ── Map init + route layers ──────────────────────────────────────────────────
  useEffect(() => {
    injectMarkerStyles();
    if (!containerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, { attributionControl: true, zoomSnap: 0.5 });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
      }).addTo(mapRef.current);

      mapRef.current.on('zoomend', () => {
        refreshIconsForZoom(mapRef.current!.getZoom());
      });
    }
    const map = mapRef.current;

    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer) && (layer as any)._isRouteLayer) map.removeLayer(layer);
    });

    const bounds: L.LatLngExpression[] = [];

    for (const dir of directions) {
      if (dir.stops.length === 0) continue;
      const lineColor = routeColor ? `#${routeColor}` : DIR_COLORS[dir.directionId] ?? DIR_COLORS[0];

      const path: L.LatLngExpression[] = dir.shape.length > 1
        ? dir.shape.map((p) => [p.lat, p.lon])
        : dir.stops.map((s) => [s.stop_lat, s.stop_lon]);

      // Glow layer — wider, semi-transparent, same colour.
      const glow = L.polyline(path, { color: lineColor, weight: 9, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      (glow as any)._isRouteLayer = true;

      // Main route line.
      const line = L.polyline(path, { color: lineColor, weight: 3, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      (line as any)._isRouteLayer = true;

      // Intermediate stop dots — styled with route colour.
      for (const stop of dir.stops.slice(1, -1)) {
        const dot = L.circleMarker([stop.stop_lat, stop.stop_lon], {
          radius: 4.5,
          color: lineColor,
          weight: 1.5,
          fillColor: '#0f172a',
          fillOpacity: 1,
        }).addTo(map);
        dot.bindTooltip(stop.stop_name, { direction: 'top', offset: [0, -6] });
        (dot as any)._isRouteLayer = true;
      }

      // Terminal stop markers — coloured divIcon instead of default Leaflet pin.
      for (const stop of [dir.stops[0], dir.stops[dir.stops.length - 1]]) {
        const icon = L.divIcon({
          html: `<div style="
            width:14px;height:14px;
            background:${lineColor};
            border:2.5px solid #f8fafc;
            border-radius:50%;
            box-shadow:0 0 10px ${lineColor}70,0 2px 6px rgba(0,0,0,.6);
          "></div>`,
          className: '',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const m = L.marker([stop.stop_lat, stop.stop_lon], { icon })
          .addTo(map)
          .bindTooltip(stop.stop_name, { direction: 'top', offset: [0, -10], permanent: false });
        (m as any)._isRouteLayer = true;
        bounds.push([stop.stop_lat, stop.stop_lon]);
      }
    }

    if (bounds.length > 0) map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
    else map.setView([39.7392, -104.9903], 10);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directions, routeColor]);

  // ── Sync vehicle markers ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const zoom = map.getZoom();
    const currentIds = new Set(vehicles.map((v) => v.id));

    // Remove stale markers.
    for (const [id, marker] of markerRefs.current) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        markerRefs.current.delete(id);
        vehicleDataRef.current.delete(id);
      }
    }

    for (const v of vehicles) {
      if (v.lat == null || v.lon == null) continue;

      vehicleDataRef.current.set(v.id, v);

      const delayMins = v.delaySeconds != null ? Math.round(v.delaySeconds / 60) : null;
      const statusLabel = v.status?.replace(/_/g, ' ').toLowerCase() ?? '';
      const tooltipText = [
        statusLabel,
        delayMins != null ? (delayMins > 0 ? `+${delayMins} min late` : delayMins < 0 ? `${Math.abs(delayMins)} min early` : 'on time') : null,
        v.occupancyStatus ? v.occupancyStatus.replace(/_/g, ' ').toLowerCase() : null,
      ].filter(Boolean).join(' · ');

      const icon = makeVehicleIcon(v, isRail, zoom);

      if (markerRefs.current.has(v.id)) {
        const existing = markerRefs.current.get(v.id)!;
        existing.setLatLng([v.lat, v.lon]);
        existing.setIcon(icon);
        existing.setTooltipContent(tooltipText);
      } else {
        const marker = L.marker([v.lat, v.lon], { icon, zIndexOffset: 1000 })
          .addTo(map)
          .bindTooltip(tooltipText, { direction: 'top', offset: [0, -14] });
        markerRefs.current.set(v.id, marker);
      }
    }
  }, [vehicles, isRail]);

  // ── Animation loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const nowSec = Date.now() / 1000;
      for (const v of vehiclesRef.current) {
        const marker = markerRefs.current.get(v.id);
        if (!marker) continue;
        const pos = interpolatePosition(v, tripUpdatesRef.current, routeGeoRef.current, nowSec);
        if (pos) marker.setLatLng([pos.lat, pos.lon]);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── Driving route overlay ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.eachLayer((layer) => { if ((layer as any)._isDriveLayer) map.removeLayer(layer); });
    if (!drivingRoute) return;

    const glow = L.polyline(drivingRoute.points, { color: '#fb923c', weight: 10, opacity: 0.2 }).addTo(map);
    (glow as any)._isDriveLayer = true;
    const line = L.polyline(drivingRoute.points, { color: '#fb923c', weight: 4, opacity: 0.88 }).addTo(map);
    (line as any)._isDriveLayer = true;

    const originIcon = L.divIcon({
      html: `<div style="width:12px;height:12px;background:#22c55e;border:2px solid white;border-radius:50%;box-shadow:0 0 8px #22c55e80;"></div>`,
      className: '', iconSize: [12, 12], iconAnchor: [6, 6],
    });
    const destIcon = L.divIcon({
      html: `<div style="width:12px;height:12px;background:#f97316;border:2px solid white;border-radius:50%;box-shadow:0 0 8px #f9731680;"></div>`,
      className: '', iconSize: [12, 12], iconAnchor: [6, 6],
    });

    const om = L.marker(drivingRoute.origin, { icon: originIcon }).addTo(map).bindTooltip('Start', { direction: 'top' });
    (om as any)._isDriveLayer = true;
    const dm = L.marker(drivingRoute.destination, { icon: destIcon }).addTo(map).bindTooltip('Destination', { direction: 'top' });
    (dm as any)._isDriveLayer = true;

    map.fitBounds(line.getBounds(), { padding: [40, 40] });
  }, [drivingRoute]);

  // ── Cleanup ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRefs.current.clear();
      vehicleDataRef.current.clear();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
