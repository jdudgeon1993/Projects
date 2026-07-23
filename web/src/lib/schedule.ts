import { supabase } from './supabase';

export interface RailStop {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stop_sequence: number;
  arrival_time: string | null;
  departure_time: string | null;
}

/** Parses a GTFS HH:MM:SS time (hours can exceed 24 for next-day trips) into total minutes. */
export function gtfsTimeToMinutes(time: string | null): number | null {
  if (!time) return null;
  const [h, m, s] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m + (s ?? 0) / 60;
}

/** Scheduled end-to-end trip duration in minutes, derived from the representative trip's stop times. */
export function getScheduledDurationMinutes(stops: RailStop[]): number | null {
  if (stops.length < 2) return null;
  const start = gtfsTimeToMinutes(stops[0].departure_time ?? stops[0].arrival_time);
  const end = gtfsTimeToMinutes(stops[stops.length - 1].arrival_time ?? stops[stops.length - 1].departure_time);
  if (start == null || end == null || end < start) return null;
  return Math.round(end - start);
}

export interface RailLineOption {
  shortName: string;
  longName: string;
  routeType: number;
  color: string | null;
  sortOrder: number | null;
}

/** GTFS route_type: 2 = commuter rail, 0/1 = light rail/subway, 3 = bus. */
export function routeTypeLabel(routeType: number): string {
  if (routeType === 2) return 'Commuter Rail';
  if (routeType === 3) return 'Bus';
  return 'Light Rail';
}

/** All rail lines present in the current GTFS import (reflects active RTD service). */
export async function getRailLines(): Promise<RailLineOption[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('rtd_routes')
    .select('route_short_name, route_long_name, route_type, route_color, route_sort_order')
    .order('route_sort_order', { ascending: true, nullsFirst: false })
    .order('route_short_name');
  if (error || !data) return [];
  return data.map((r: any) => ({
    shortName: r.route_short_name,
    longName: r.route_long_name,
    routeType: Number(r.route_type),
    color: r.route_color ? `#${r.route_color}` : null,
    sortOrder: r.route_sort_order != null ? Number(r.route_sort_order) : null,
  }));
}

/** Approximate distance in meters between two lat/lon points (haversine). */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface NearbyRoute {
  shortName: string;
  longName: string;
  routeType: number;
  stopName: string;
  distanceMeters: number;
}

/** Routes whose representative stops are closest to the given coordinates, nearest first. */
export async function getNearestRoutes(lat: number, lon: number, limit = 5): Promise<NearbyRoute[]> {
  if (!supabase) return [];

  // Bounding-box prefilter (~5.5km) so we don't pull every stop_time row in the system.
  const latDelta = 0.05;
  const lonDelta = latDelta / Math.cos((lat * Math.PI) / 180);
  const { data: nearbyStops, error: stopsErr } = await supabase
    .from('rtd_stops')
    .select('stop_id, stop_name, stop_lat, stop_lon')
    .gte('stop_lat', lat - latDelta)
    .lte('stop_lat', lat + latDelta)
    .gte('stop_lon', lon - lonDelta)
    .lte('stop_lon', lon + lonDelta);
  if (stopsErr || !nearbyStops || nearbyStops.length === 0) return [];

  const stopsByDistance = nearbyStops
    .filter((s: any) => s.stop_lat != null && s.stop_lon != null)
    .map((s: any) => ({
      ...s,
      distance: distanceMeters(lat, lon, Number(s.stop_lat), Number(s.stop_lon)),
    }))
    .sort((a: any, b: any) => a.distance - b.distance)
    .slice(0, 100);
  const stopInfo = new Map(stopsByDistance.map((s: any) => [s.stop_id, s]));

  const { data, error } = await supabase
    .from('rtd_stop_times')
    .select('stop_id, rtd_trips(rtd_routes(route_short_name, route_long_name, route_type))')
    .in('stop_id', [...stopInfo.keys()]);
  if (error || !data) return [];

  const best = new Map<string, NearbyRoute>();
  for (const row of data as any[]) {
    const stop = stopInfo.get(row.stop_id);
    const route = row.rtd_trips?.rtd_routes;
    if (!stop || !route) continue;
    const existing = best.get(route.route_short_name);
    if (!existing || stop.distance < existing.distanceMeters) {
      best.set(route.route_short_name, {
        shortName: route.route_short_name,
        longName: route.route_long_name,
        routeType: Number(route.route_type),
        stopName: stop.stop_name,
        distanceMeters: stop.distance,
      });
    }
  }

  return [...best.values()].sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, limit);
}

export async function getRouteId(shortName: string): Promise<{ routeId: string; routeType: number; color: string | null } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('rtd_routes')
    .select('route_id, route_type, route_color')
    .eq('route_short_name', shortName)
    .maybeSingle();
  if (error || !data) return null;
  return {
    routeId: data.route_id,
    routeType: Number(data.route_type),
    color: data.route_color ? `#${data.route_color}` : null,
  };
}

/** Whether the route has scheduled service today, per calendar + calendar_dates. Null if unknown. */
export async function isRouteServiceToday(routeId: string): Promise<boolean | null> {
  if (!supabase) return null;
  const { data: trips, error: tripsErr } = await supabase
    .from('rtd_trips')
    .select('service_id')
    .eq('route_id', routeId);
  if (tripsErr || !trips || trips.length === 0) return null;
  const serviceIds = [...new Set(trips.map((t: any) => t.service_id))];

  const now = new Date();
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];

  const [{ data: cal }, { data: exceptions }] = await Promise.all([
    supabase.from('rtd_calendar').select('*').in('service_id', serviceIds),
    supabase.from('rtd_calendar_dates').select('service_id, exception_type').in('service_id', serviceIds).eq('date', today),
  ]);

  const added = new Set((exceptions ?? []).filter((e: any) => Number(e.exception_type) === 1).map((e: any) => e.service_id));
  const removed = new Set((exceptions ?? []).filter((e: any) => Number(e.exception_type) === 2).map((e: any) => e.service_id));

  if (added.size > 0) return true;
  if (!cal || cal.length === 0) return null;
  return cal.some(
    (c: any) =>
      !removed.has(c.service_id) &&
      Number(c[weekday]) === 1 &&
      c.start_date <= today &&
      c.end_date >= today,
  );
}

export interface RouteAtStop {
  routeId: string;
  shortName: string;
  longName: string;
  routeType: number;
  color: string | null;
}

export interface RoutesAtStopResult {
  routes: RouteAtStop[];
  stopIds: string[]; // tapped stop + all nearby stop IDs found
}

/** All routes whose imported trips serve the given stop or any stop within radiusMeters. */
export async function getRoutesServingStop(stopId: string, radiusMeters = 250): Promise<RoutesAtStopResult> {
  if (!supabase) return { routes: [], stopIds: [stopId] };

  // Step 1: get the tapped stop's coordinates
  const { data: origin } = await supabase
    .from('rtd_stops')
    .select('stop_lat, stop_lon')
    .eq('stop_id', stopId)
    .single();
  if (!origin) return { routes: [], stopIds: [stopId] };

  const lat = Number(origin.stop_lat);
  const lon = Number(origin.stop_lon);

  // Step 2: bounding box of nearby stops (lat/lon degrees ≈ metres at Denver's latitude)
  const latD = radiusMeters / 111000;
  const lonD = radiusMeters / (111000 * Math.cos((lat * Math.PI) / 180));
  const { data: nearbyRows } = await supabase
    .from('rtd_stops')
    .select('stop_id, stop_lat, stop_lon')
    .gte('stop_lat', lat - latD)
    .lte('stop_lat', lat + latD)
    .gte('stop_lon', lon - lonD)
    .lte('stop_lon', lon + lonD);

  // Exact haversine filter to stay within circle, not just bounding box
  const nearbyStopIds = [
    stopId,
    ...((nearbyRows ?? []) as any[])
      .filter((s) => distanceMeters(lat, lon, Number(s.stop_lat), Number(s.stop_lon)) <= radiusMeters)
      .map((s) => s.stop_id as string),
  ];
  const allStopIds = [...new Set(nearbyStopIds)];

  // Step 3: trips serving any of these stops
  const { data: stRows, error: stErr } = await supabase
    .from('rtd_stop_times')
    .select('trip_id')
    .in('stop_id', allStopIds)
    .limit(2000);
  if (stErr || !stRows || stRows.length === 0) return { routes: [], stopIds: allStopIds };
  const tripIds = [...new Set(stRows.map((r: any) => r.trip_id))];

  const routeIds = new Set<string>();
  for (let i = 0; i < tripIds.length; i += 100) {
    const { data: trips } = await supabase
      .from('rtd_trips')
      .select('route_id')
      .in('trip_id', tripIds.slice(i, i + 100));
    for (const t of (trips ?? []) as any[]) routeIds.add(t.route_id);
  }
  if (routeIds.size === 0) return { routes: [], stopIds: allStopIds };

  const { data: routes, error: rErr } = await supabase
    .from('rtd_routes')
    .select('route_id, route_short_name, route_long_name, route_type, route_color')
    .in('route_id', [...routeIds]);
  if (rErr || !routes) return { routes: [], stopIds: allStopIds };

  return {
    routes: routes
      .map((r: any) => ({
        routeId: r.route_id,
        shortName: r.route_short_name,
        longName: r.route_long_name,
        routeType: Number(r.route_type),
        color: r.route_color ? `#${r.route_color}` : null,
      }))
      .sort((a, b) => a.routeType - b.routeType || a.shortName.localeCompare(b.shortName)),
    stopIds: allStopIds,
  };
}

export interface StopSearchResult {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
}

/** Search stops by name for the trip planner. */
export async function searchStops(query: string, limit = 8): Promise<StopSearchResult[]> {
  if (!supabase || query.trim().length < 2) return [];
  const { data, error } = await supabase
    .from('rtd_stops')
    .select('stop_id, stop_name, stop_lat, stop_lon')
    .ilike('stop_name', `%${query.trim()}%`)
    .limit(limit);
  if (error || !data) return [];
  return data.map((s: any) => ({
    stopId: s.stop_id,
    stopName: s.stop_name,
    lat: Number(s.stop_lat),
    lon: Number(s.stop_lon),
  }));
}

export interface ShapePoint {
  lat: number;
  lon: number;
  sequence: number;
}

export interface TripAccessibility {
  wheelchairAccessible: boolean | null;
  bikesAllowed: boolean | null;
}

export interface RouteFare {
  price: number;
  currency: string;
}

/** Fare for a route, derived from fare_rules + fare_attributes (first match). */
export async function getRouteFare(routeId: string): Promise<RouteFare | null> {
  if (!supabase) return null;
  const { data: rules, error: ruleErr } = await supabase
    .from('rtd_fare_rules')
    .select('fare_id')
    .eq('route_id', routeId)
    .limit(1);
  if (ruleErr || !rules || rules.length === 0) return null;
  const { data: attr, error: attrErr } = await supabase
    .from('rtd_fare_attributes')
    .select('price, currency_type')
    .eq('fare_id', rules[0].fare_id)
    .maybeSingle();
  if (attrErr || !attr) return null;
  return { price: Number(attr.price), currency: attr.currency_type ?? 'USD' };
}

/** Average headway in minutes for a trip, if frequency-based service is defined. */
export async function getFrequencyMinutes(tripId: string): Promise<number | null> {
  if (!supabase || !tripId) return null;
  const { data, error } = await supabase
    .from('rtd_frequencies')
    .select('headway_secs')
    .eq('trip_id', tripId);
  if (error || !data || data.length === 0) return null;
  const avg = data.reduce((sum: number, f: any) => sum + Number(f.headway_secs), 0) / data.length;
  return Math.round(avg / 60);
}

export interface StopTransfer {
  routeShortName: string;
  routeLongName: string;
}

/** For each given stop, the other routes reachable via a same-station transfer (excluding the current route). */
export async function getTransfersForStops(stopIds: string[], currentRouteShortName: string): Promise<Record<string, StopTransfer[]>> {
  if (!supabase || stopIds.length === 0) return {};

  const { data: transfers, error } = await supabase
    .from('rtd_transfers')
    .select('from_stop_id, to_stop_id')
    .in('from_stop_id', stopIds);
  if (error || !transfers || transfers.length === 0) return {};

  const toStopIds = [...new Set(transfers.map((t: any) => t.to_stop_id).filter((id: string) => !stopIds.includes(id)))];
  if (toStopIds.length === 0) return {};

  const { data: stopTimes, error: stErr } = await supabase
    .from('rtd_stop_times')
    .select('stop_id, rtd_trips(rtd_routes(route_short_name, route_long_name))')
    .in('stop_id', toStopIds);
  if (stErr || !stopTimes) return {};

  const routesByStop = new Map<string, Map<string, StopTransfer>>();
  for (const row of stopTimes as any[]) {
    const route = row.rtd_trips?.rtd_routes;
    if (!route || route.route_short_name === currentRouteShortName) continue;
    if (!routesByStop.has(row.stop_id)) routesByStop.set(row.stop_id, new Map());
    routesByStop.get(row.stop_id)!.set(route.route_short_name, {
      routeShortName: route.route_short_name,
      routeLongName: route.route_long_name,
    });
  }

  const result: Record<string, StopTransfer[]> = {};
  for (const t of transfers as any[]) {
    const routes = routesByStop.get(t.to_stop_id);
    if (!routes || routes.size === 0) continue;
    if (!result[t.from_stop_id]) result[t.from_stop_id] = [];
    for (const r of routes.values()) {
      if (!result[t.from_stop_id].some((existing) => existing.routeShortName === r.routeShortName)) {
        result[t.from_stop_id].push(r);
      }
    }
  }
  return result;
}

/** GTFS 1 = yes, 2 = no, 0/missing = unknown. */
function gtfsBool(value: unknown): boolean | null {
  const n = Number(value);
  if (n === 1) return true;
  if (n === 2) return false;
  return null;
}

/** Returns the ordered list of stops for one direction of a route, using a representative trip. */
export async function getStopsForRoute(routeId: string, directionId = 0): Promise<{ stops: RailStop[]; shapeId: string | null; tripId: string | null; accessibility: TripAccessibility }> {
  const empty = { stops: [], shapeId: null, tripId: null, accessibility: { wheelchairAccessible: null, bikesAllowed: null } };
  if (!supabase) return empty;
  const { data: trip } = await supabase
    .from('rtd_trips')
    .select('trip_id, shape_id, wheelchair_accessible, bikes_allowed')
    .eq('route_id', routeId)
    .eq('direction_id', directionId)
    .limit(1)
    .maybeSingle();
  if (!trip) return empty;

  const accessibility: TripAccessibility = {
    wheelchairAccessible: gtfsBool(trip.wheelchair_accessible),
    bikesAllowed: gtfsBool(trip.bikes_allowed),
  };

  const { data: stopTimes } = await supabase
    .from('rtd_stop_times')
    .select('stop_id, stop_sequence, arrival_time, departure_time, rtd_stops(stop_name, stop_lat, stop_lon)')
    .eq('trip_id', trip.trip_id)
    .order('stop_sequence');
  if (!stopTimes) return { stops: [], shapeId: trip.shape_id ?? null, tripId: trip.trip_id ?? null, accessibility };

  const stops = stopTimes.map((st: any) => ({
    stop_id: st.stop_id,
    stop_sequence: st.stop_sequence,
    stop_name: st.rtd_stops?.stop_name,
    stop_lat: Number(st.rtd_stops?.stop_lat),
    stop_lon: Number(st.rtd_stops?.stop_lon),
    arrival_time: st.arrival_time ?? null,
    departure_time: st.departure_time ?? null,
  }));

  return { stops, shapeId: trip.shape_id ?? null, tripId: trip.trip_id ?? null, accessibility };
}

export interface RouteOverview {
  routeId: string;
  shortName: string;
  routeType: number;
  color: string | null;
  /** Unique stops in direction-0 order (direction-1-only stops appended). */
  stops: RailStop[];
  shape: ShapePoint[];
  durationMinutes: number | null;
}

/** Everything the trip planner needs to know about one route: stops, geometry, typical duration. */
export async function getRouteOverview(shortName: string): Promise<RouteOverview | null> {
  const route = await getRouteId(shortName);
  if (!route) return null;
  const [dir0, dir1] = await Promise.all([
    getStopsForRoute(route.routeId, 0),
    getStopsForRoute(route.routeId, 1),
  ]);
  const seen = new Set(dir0.stops.map((s) => s.stop_id));
  const stops = [...dir0.stops, ...dir1.stops.filter((s) => !seen.has(s.stop_id))];
  const shapeId = dir0.shapeId ?? dir1.shapeId;
  const shape = shapeId ? await getShapePoints(shapeId) : [];
  return {
    routeId: route.routeId,
    shortName,
    routeType: route.routeType,
    color: route.color,
    stops,
    shape,
    durationMinutes: getScheduledDurationMinutes(dir0.stops.length > 0 ? dir0.stops : dir1.stops),
  };
}

/** Returns the ordered shape points (route geometry) for a given shape_id. */
export async function getShapePoints(shapeId: string): Promise<ShapePoint[]> {
  if (!supabase || !shapeId) return [];
  const points: ShapePoint[] = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('rtd_shapes')
      .select('shape_pt_lat, shape_pt_lon, shape_pt_sequence')
      .eq('shape_id', shapeId)
      .order('shape_pt_sequence')
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    points.push(
      ...data.map((p: any) => ({
        lat: Number(p.shape_pt_lat),
        lon: Number(p.shape_pt_lon),
        sequence: p.shape_pt_sequence,
      })),
    );
    if (data.length < PAGE_SIZE) break;
  }
  return points;
}

export interface ScheduledArrival {
  routeShortName: string;
  directionId: number;
  timeDisplay: string; // "9:15 PM"
  timeMinutes: number; // minutes since midnight, for sorting
}

/**
 * Next scheduled departures at a stop for a given set of routes.
 * Used as a fallback when live GTFS-RT data is missing for a connecting route.
 */
export async function getNextScheduledDepartures(
  stopIds: string | string[],
  routeShortNames: string[],
  nowMinutes: number,
  countPerRoute = 3,
): Promise<Map<string, ScheduledArrival[]>> {
  if (!supabase || routeShortNames.length === 0) return new Map();
  const ids = Array.isArray(stopIds) ? stopIds : [stopIds];
  const { data, error } = await supabase
    .from('rtd_stop_times')
    .select('departure_time, arrival_time, rtd_trips(direction_id, rtd_routes(route_short_name))')
    .in('stop_id', ids)
    .limit(5000);
  if (error || !data) return new Map();

  const nameSet = new Set(routeShortNames);
  const buckets = new Map<string, ScheduledArrival[]>();

  for (const row of data as any[]) {
    const shortName = row.rtd_trips?.rtd_routes?.route_short_name;
    if (!shortName || !nameSet.has(shortName)) continue;
    const timeStr = row.departure_time ?? row.arrival_time;
    if (!timeStr) continue;
    const mins = gtfsTimeToMinutes(timeStr);
    if (mins == null || mins < nowMinutes) continue;

    const [h, m] = timeStr.split(':').map(Number);
    const hour24 = h % 24;
    const period = hour24 < 12 ? 'AM' : 'PM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const timeDisplay = `${hour12}:${String(m).padStart(2, '0')} ${period}`;

    if (!buckets.has(shortName)) buckets.set(shortName, []);
    buckets.get(shortName)!.push({
      routeShortName: shortName,
      directionId: Number(row.rtd_trips?.direction_id ?? 0),
      timeDisplay,
      timeMinutes: mins,
    });
  }

  for (const [key, arr] of buckets) {
    arr.sort((a, b) => a.timeMinutes - b.timeMinutes);
    buckets.set(key, arr.slice(0, countPerRoute));
  }
  return buckets;
}
