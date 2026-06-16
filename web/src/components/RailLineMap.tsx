import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import type { DirectionInfo, LiveVehicle } from '../lib/useRailLine';
import type { ParsedFeed } from '../lib/gtfsrt';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DIRECTION_COLORS = ['#38bdf8', '#a78bfa']; // direction 0 / 1

function trainColor(vehicle: LiveVehicle): string {
  const delay = vehicle.delaySeconds ?? 0;
  if (delay > 600) return '#ef4444';
  if (delay > 60) return '#facc15';
  return DIRECTION_COLORS[vehicle.directionId ?? 0] ?? DIRECTION_COLORS[0];
}

type Pt = { lat: number; lon: number };

interface RouteGeometry {
  // Full shape polyline for this direction (may be empty for bus routes without shapes).
  shape: Pt[];
  // stopId → index into shape[] of the nearest shape point to that stop.
  stopShapeIndex: Map<string, number>;
  // Fallback: stopId → raw coords (used when shape is unavailable).
  stopCoords: Map<string, Pt>;
}

function sq(x: number) { return x * x; }
function dist2(a: Pt, b: Pt) { return sq(a.lat - b.lat) + sq(a.lon - b.lon); }

/** For each stop find the shape point index closest to the stop's coordinates. */
function nearestShapeIndex(shape: Pt[], stop: Pt): number {
  let best = 0;
  let bestD = dist2(shape[0], stop);
  for (let i = 1; i < shape.length; i++) {
    const d = dist2(shape[i], stop);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Build per-direction geometry for all loaded directions.
 * Keyed by directionId.
 */
function buildRouteGeometry(directions: DirectionInfo[]): Map<number, RouteGeometry> {
  const result = new Map<number, RouteGeometry>();
  for (const dir of directions) {
    const shape = dir.shape.length > 1 ? dir.shape : [];
    const stopShapeIndex = new Map<string, number>();
    const stopCoords = new Map<string, Pt>();

    for (const s of dir.stops) {
      const pt: Pt = { lat: s.stop_lat, lon: s.stop_lon };
      stopCoords.set(s.stop_id, pt);
      if (shape.length > 0) {
        stopShapeIndex.set(s.stop_id, nearestShapeIndex(shape, pt));
      }
    }
    result.set(dir.directionId, { shape, stopShapeIndex, stopCoords });
  }
  return result;
}

/**
 * Walk a polyline and return the point at `fraction` (0–1) of its total length.
 * fraction=0 → first point, fraction=1 → last point.
 */
function walkPolyline(pts: Pt[], fraction: number): Pt {
  if (pts.length === 1) return pts[0];
  const f = Math.max(0, Math.min(1, fraction));

  // Accumulate segment lengths.
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    lens.push(lens[i - 1] + Math.sqrt(dist2(pts[i], pts[i - 1])));
  }
  const total = lens[lens.length - 1];
  if (total === 0) return pts[0];

  const target = f * total;
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] >= target) {
      const segLen = lens[i] - lens[i - 1];
      const t = segLen === 0 ? 0 : (target - lens[i - 1]) / segLen;
      return {
        lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t,
        lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * t,
      };
    }
  }
  return pts[pts.length - 1];
}

/**
 * Interpolate a vehicle's position along the actual route geometry.
 *
 * For IN_TRANSIT_TO vehicles:
 *  1. Find the from/to stop pair that brackets `now` in the TripUpdate.
 *  2. Look up their shape indices and extract that shape segment.
 *  3. Walk the segment at the time fraction — vehicle follows the real track.
 *  4. Falls back to straight-line lerp if shape data is unavailable, then to
 *     raw GPS if stop coordinates can't be found at all.
 */
function interpolatePosition(
  v: LiveVehicle,
  tripUpdates: ParsedFeed | null,
  routeGeometry: Map<number, RouteGeometry>,
  nowSec: number,
): Pt | null {
  const rawLat = v.lat;
  const rawLon = v.lon;
  if (rawLat == null || rawLon == null) return null;

  // STOPPED_AT / INCOMING_AT: GPS fix is authoritative.
  if (v.status !== 'IN_TRANSIT_TO') return { lat: rawLat, lon: rawLon };

  if (!tripUpdates?.entity || !v.tripId) return { lat: rawLat, lon: rawLon };

  const entity = tripUpdates.entity.find((e) => e.tripUpdate?.trip?.tripId === v.tripId);
  if (!entity) return { lat: rawLat, lon: rawLon };

  const stus: any[] = entity.tripUpdate?.stopTimeUpdate ?? [];
  if (stus.length < 2) return { lat: rawLat, lon: rawLon };

  // Find the bracketing stop pair: fromStop departed, toStop not yet arrived.
  let fromIdx = -1;
  for (let i = 0; i < stus.length - 1; i++) {
    const depTime = Number(stus[i].departure?.time ?? stus[i].arrival?.time ?? 0);
    const arrTime = Number(stus[i + 1].arrival?.time ?? stus[i + 1].departure?.time ?? 0);
    if (depTime > 0 && arrTime > 0 && depTime <= nowSec && arrTime >= nowSec) {
      fromIdx = i;
      break;
    }
  }
  if (fromIdx === -1) return { lat: rawLat, lon: rawLon };

  const fromStu = stus[fromIdx];
  const toStu = stus[fromIdx + 1];
  const depTime = Number(fromStu.departure?.time ?? fromStu.arrival?.time);
  const arrTime = Number(toStu.arrival?.time ?? toStu.departure?.time);
  if (!depTime || !arrTime || arrTime <= depTime) return { lat: rawLat, lon: rawLon };

  const fraction = Math.max(0, Math.min(1, (nowSec - depTime) / (arrTime - depTime)));

  // Look up geometry for this vehicle's direction.
  const dirId = v.directionId ?? 0;
  const geo = routeGeometry.get(dirId);
  if (!geo) return { lat: rawLat, lon: rawLon };

  const fromStopId: string | undefined = fromStu.stopId;
  const toStopId: string | undefined = toStu.stopId;

  // Shape-based interpolation: walk the actual route geometry.
  if (geo.shape.length > 1 && fromStopId && toStopId) {
    const fromShapeIdx = geo.stopShapeIndex.get(fromStopId);
    const toShapeIdx = geo.stopShapeIndex.get(toStopId);

    if (fromShapeIdx != null && toShapeIdx != null && fromShapeIdx !== toShapeIdx) {
      // Extract the segment of the shape between these two stops.
      // If toShapeIdx < fromShapeIdx the shape direction is reversed — handle both.
      const lo = Math.min(fromShapeIdx, toShapeIdx);
      const hi = Math.max(fromShapeIdx, toShapeIdx);
      let segment = geo.shape.slice(lo, hi + 1);
      if (fromShapeIdx > toShapeIdx) segment = segment.slice().reverse();

      return walkPolyline(segment, fraction);
    }
  }

  // Fallback: straight-line lerp between stop coordinates.
  const fromCoords = fromStopId ? geo.stopCoords.get(fromStopId) : null;
  const toCoords = toStopId ? geo.stopCoords.get(toStopId) : null;
  if (!fromCoords || !toCoords) return { lat: rawLat, lon: rawLon };

  return {
    lat: fromCoords.lat + (toCoords.lat - fromCoords.lat) * fraction,
    lon: fromCoords.lon + (toCoords.lon - fromCoords.lon) * fraction,
  };
}

export default function RailLineMap({
  directions,
  vehicles,
  tripUpdates,
  routeColor,
  drivingRoute,
}: {
  directions: DirectionInfo[];
  vehicles: LiveVehicle[];
  tripUpdates: ParsedFeed | null;
  routeColor?: string | null;
  drivingRoute?: { points: [number, number][]; origin: [number, number]; destination: [number, number] } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Persistent marker refs keyed by vehicle id — survive between re-renders.
  const markerRefs = useRef<Map<string, L.CircleMarker>>(new Map());
  const vehiclesRef = useRef(vehicles);
  const tripUpdatesRef = useRef(tripUpdates);
  const routeGeoRef = useRef<Map<number, RouteGeometry>>(new Map());

  // Keep refs current so the interval always sees the latest data.
  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);
  useEffect(() => { tripUpdatesRef.current = tripUpdates; }, [tripUpdates]);
  useEffect(() => {
    routeGeoRef.current = buildRouteGeometry(directions);
  }, [directions]);

  // Endpoints + route lines — only redrawn when the line/direction data changes.
  useEffect(() => {
    if (!containerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, { attributionControl: true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;

    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer) && (layer as any)._isRouteLayer) map.removeLayer(layer);
    });

    const points: L.LatLngExpression[] = [];
    for (const dir of directions) {
      if (dir.stops.length === 0) continue;
      const start = dir.stops[0];
      const end = dir.stops[dir.stops.length - 1];

      const startMarker = L.marker([start.stop_lat, start.stop_lon]).addTo(map).bindPopup(start.stop_name);
      const endMarker = L.marker([end.stop_lat, end.stop_lon]).addTo(map).bindPopup(end.stop_name);
      (startMarker as any)._isRouteLayer = true;
      (endMarker as any)._isRouteLayer = true;
      points.push([start.stop_lat, start.stop_lon], [end.stop_lat, end.stop_lon]);

      const path: L.LatLngExpression[] =
        dir.shape.length > 1
          ? dir.shape.map((p) => [p.lat, p.lon])
          : dir.stops.map((s) => [s.stop_lat, s.stop_lon]);
      const line = L.polyline(path, { color: routeColor || '#38bdf8', weight: 3, opacity: 0.7 }).addTo(map);
      (line as any)._isRouteLayer = true;

      for (const stop of dir.stops.slice(1, -1)) {
        const dot = L.circleMarker([stop.stop_lat, stop.stop_lon], {
          radius: 4,
          color: '#0f172a',
          weight: 1,
          fillColor: '#e2e8f0',
          fillOpacity: 0.9,
        }).addTo(map);
        dot.bindPopup(stop.stop_name);
        (dot as any)._isRouteLayer = true;
      }
    }

    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    } else {
      map.setView([39.7392, -104.9903], 10);
    }
  }, [directions, routeColor]);

  // Sync vehicle markers: add new ones, remove stale ones, keep existing ones alive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(vehicles.map((v) => v.id));

    // Remove markers for vehicles no longer in the feed.
    for (const [id, marker] of markerRefs.current) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        markerRefs.current.delete(id);
      }
    }

    // Add markers for new vehicles; update popup text for existing ones.
    for (const v of vehicles) {
      if (v.lat == null || v.lon == null) continue;
      const popupText = `${v.status?.replace(/_/g, ' ').toLowerCase() ?? ''}${v.delaySeconds != null ? ` · ${Math.round(v.delaySeconds / 60)} min delay` : ''}`;

      if (markerRefs.current.has(v.id)) {
        const existing = markerRefs.current.get(v.id)!;
        existing.setStyle({ fillColor: trainColor(v) });
        existing.setPopupContent(popupText);
        // Snap to the new GPS fix immediately so we don't interpolate from a stale position.
        existing.setLatLng([v.lat, v.lon]);
      } else {
        const marker = L.circleMarker([v.lat, v.lon], {
          radius: 7,
          color: '#0f172a',
          weight: 2,
          fillColor: trainColor(v),
          fillOpacity: 1,
        }).addTo(map);
        marker.bindPopup(popupText);
        markerRefs.current.set(v.id, marker);
      }
    }
  }, [vehicles]);

  // Animation loop: smoothly move markers between feed updates using interpolation.
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
  }, []); // runs once; reads live data via refs

  // Driving directions overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.eachLayer((layer) => {
      if ((layer as any)._isDriveLayer) map.removeLayer(layer);
    });

    if (!drivingRoute) return;

    const line = L.polyline(drivingRoute.points, { color: '#fb923c', weight: 4, opacity: 0.85 }).addTo(map);
    (line as any)._isDriveLayer = true;

    const originMarker = L.circleMarker(drivingRoute.origin, {
      radius: 7,
      color: '#0f172a',
      weight: 2,
      fillColor: '#22c55e',
      fillOpacity: 1,
    }).addTo(map).bindPopup('Start');
    (originMarker as any)._isDriveLayer = true;

    const destMarker = L.marker(drivingRoute.destination).addTo(map).bindPopup('Destination');
    (destMarker as any)._isDriveLayer = true;

    map.fitBounds(line.getBounds(), { padding: [40, 40] });
  }, [drivingRoute]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRefs.current.clear();
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
