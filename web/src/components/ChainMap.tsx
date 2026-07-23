import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RouteOverview } from '../lib/schedule';

/**
 * Fallback map for the trip planner: draws every route in the user's chain
 * (in its brand color) so they can eyeball the connection even when no
 * scheduled itinerary could be computed.
 */
export default function ChainMap({ routes }: { routes: RouteOverview[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

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
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });

    const allPoints: L.LatLngExpression[] = [];
    for (const route of routes) {
      const color = route.color ?? '#38bdf8';
      const path: L.LatLngExpression[] =
        route.shape.length > 1
          ? route.shape.map((p) => [p.lat, p.lon])
          : route.stops.map((s) => [s.stop_lat, s.stop_lon]);
      if (path.length < 2) continue;
      L.polyline(path, { color, weight: 4, opacity: 0.8 }).addTo(map);
      allPoints.push(...path);

      const first = route.stops[0];
      const last = route.stops[route.stops.length - 1];
      for (const endpoint of [first, last]) {
        if (!endpoint) continue;
        L.circleMarker([endpoint.stop_lat, endpoint.stop_lon], {
          radius: 6,
          color: '#0f172a',
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(`${route.shortName}: ${endpoint.stop_name}`);
      }
    }

    if (allPoints.length > 0) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [25, 25] });
    } else {
      map.setView([39.7392, -104.9903], 10);
    }
  }, [routes]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-64 w-full rounded-lg" />;
}
