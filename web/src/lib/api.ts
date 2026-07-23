// Helpers for the Railway-hosted API (server/index.js)

export type GtfsFeed = 'TripUpdate' | 'VehiclePosition' | 'Alerts';

export async function fetchGtfsRt(feed: GtfsFeed): Promise<ArrayBuffer> {
  const response = await fetch(`/api/gtfs-rt?feed=${feed}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GTFS-RT ${feed} fetch failed: ${response.status}`);
  return response.arrayBuffer();
}

export interface WeatherData {
  temp: number;
  icon: string;
}

export async function fetchWeather(): Promise<WeatherData> {
  const response = await fetch('/api/weather', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'Denver,CO,US' }),
  });
  if (!response.ok) throw new Error('Failed to fetch weather');
  return response.json();
}

export interface NearbyStop {
  name: string;
  address?: string;
  distance: string;
  rating?: number;
  place_id?: string;
}

export async function searchNearbyTransit(location: string, radius: number): Promise<{ stops: NearbyStop[] }> {
  const response = await fetch('/api/search-nearby-transit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location, radius, includeRail: false, includeBus: true }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to search nearby transit');
  return data;
}

export interface DriveTimeLeg {
  minutes: number;
  trafficPercent: number;
  status: string;
}

export async function calculateDriveTime(home: string, work: string, avoidHighways: boolean): Promise<{ homeToWork: DriveTimeLeg; workToHome: DriveTimeLeg }> {
  const response = await fetch('/api/calculate-drive-time', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ home, work, avoidHighways }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to calculate drive time');
  return data;
}

export interface DrivingRoute {
  minutes: number;
  distanceMeters: number;
  trafficPercent: number;
  polyline: string | null;
}

export type RoutePoint = string | { lat: number; lng: number };

export async function getDrivingRoute(origin: RoutePoint, destination: RoutePoint): Promise<DrivingRoute> {
  const response = await fetch('/api/driving-route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, destination }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to get driving route');
  return data;
}
