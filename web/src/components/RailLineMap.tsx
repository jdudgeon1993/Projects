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

/** Build a lookup of stop_id → {lat, lon} from all directions' stop lists. */
function buildStopCoords(directions: DirectionInfo[]): Map<string, { lat: number; lon: number }> {
  const map = new Map<string, { lat: number; lon: number }>();
  for (const dir of directions) {
    for (const s of dir.stops) {
      if (!map.has(s.stop_id)) map.set(s.stop_id, { lat: s.stop_lat, lon: s.stop_lon });
    }
  }
  return map;
}

/**
 * Given a vehicle and the tripUpdates feed, compute an interpolated lat/lon.
 *
 * Strategy:
 *  - STOPPED_AT / INCOMING_AT: use the raw GPS fix (no interpolation needed).
 *  - IN_TRANSIT_TO: find the vehicle's trip in the TripUpdate feed, locate the
 *    two consecutive stop_time_updates that bracket `now` (prev departed, next
 *    arriving), lerp between their stop coordinates by time fraction.
 *  - Falls back to raw GPS if the trip update is missing or times can't be found.
 *  - Caps extrapolation at 90s beyond the last known fix to avoid wild drift.
 */
function interpolatePosition(
  v: LiveVehicle,
  tripUpdates: ParsedFeed | null,
  stopCoords: Map<string, { lat: number; lon: number }>,
  nowSec: number,
): { lat: number; lon: number } | null {
  const rawLat = v.lat;
  const rawLon = v.lon;

  if (rawLat == null || rawLon == null) return null;

  // For stopped/incoming, the GPS fix is authoritative — no interpolation.
  if (v.status !== 'IN_TRANSIT_TO') return { lat: rawLat, lon: rawLon };

  // Cap: if the feed fix is too old, trust it less but still use it as-is.
  if (v.feedTimestamp != null && nowSec - v.feedTimestamp > 90) {
    return { lat: rawLat, lon: rawLon };
  }

  if (!tripUpdates?.entity || !v.tripId) return { lat: rawLat, lon: rawLon };

  const entity = tripUpdates.entity.find((e) => e.tripUpdate?.trip?.tripId === v.tripId);
  if (!entity) return { lat: rawLat, lon: rawLon };

  const stus: any[] = entity.tripUpdate?.stopTimeUpdate ?? [];
  if (stus.length < 2) return { lat: rawLat, lon: rawLon };

  // Find the pair: last stop whose departure has passed (fromStop) and
  // the next stop whose arrival is in the future (toStop).
  let fromIdx = -1;
  for (let i = 0; i < stus.length - 1; i++) {
    const depTime = Number(stus[i].departure?.time ?? stus[i].arrival?.time ?? 0);
    const arrTime = Number(stus[i + 1].arrival?.time ?? stus[i + 1].departure?.time ?? 0);
    if (depTime > 0 && arrTime > 0 && depTime <= nowSec && arrTime > nowSec - 30) {
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

  const fromCoords = fromStu.stopId ? stopCoords.get(fromStu.stopId) : null;
  const toCoords = toStu.stopId ? stopCoords.get(toStu.stopId) : null;

  if (!fromCoords || !toCoords) return { lat: rawLat, lon: rawLon };

  const fraction = Math.max(0, Math.min(1, (nowSec - depTime) / (arrTime - depTime)));
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
  const stopCoordsRef = useRef<Map<string, { lat: number; lon: number }>>(new Map());

  // Keep refs current so the interval always sees the latest data.
  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);
  useEffect(() => { tripUpdatesRef.current = tripUpdates; }, [tripUpdates]);
  useEffect(() => {
    stopCoordsRef.current = buildStopCoords(directions);
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
        const pos = interpolatePosition(v, tripUpdatesRef.current, stopCoordsRef.current, nowSec);
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
