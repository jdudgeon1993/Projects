import { supabase } from './supabase';
import { gtfsTimeToMinutes } from './schedule';
import { getTripDelay, type ParsedFeed } from './gtfsrt';

const MAX_ITINERARIES = 6;
/** Stops within this distance count as the same transfer point (bus bay <-> rail platform, across a park-n-ride). */
const WALK_RADIUS_METERS = 400;
/** Extra minutes for a proximity (walking) transfer vs a same-platform one. */
const WALK_TRANSFER_BUFFER_MINUTES = 4;

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface ItineraryLeg {
  routeShortName: string;
  routeLongName: string;
  routeType: number;
  routeColor: string | null;
  tripId: string;
  headsign: string;
  boardStopName: string;
  boardTime: string; // GTFS HH:MM:SS (scheduled)
  alightStopName: string;
  alightTime: string; // GTFS HH:MM:SS (scheduled)
  delaySeconds: number | null;
}

export interface Itinerary {
  legs: ItineraryLeg[];
  departMinutes: number; // scheduled
  arriveMinutes: number; // scheduled
  totalMinutes: number;
  transfers: number;
  /** Minutes spent waiting before each leg after the first (index i = wait before legs[i+1]). */
  transferWaits?: number[];
  /** Live-delay warnings, e.g. a connection that gets tight because the feeder is running late. */
  warnings?: string[];
}

/** Scheduled wait at each transfer, plus live-delay warnings for tight ones. */
function annotateTransfers(it: Itinerary): Itinerary {
  const waits: number[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < it.legs.length; i++) {
    const prev = it.legs[i - 1];
    const curr = it.legs[i];
    const arr = gtfsTimeToMinutes(prev.alightTime);
    const dep = gtfsTimeToMinutes(curr.boardTime);
    if (arr == null || dep == null) {
      waits.push(0);
      continue;
    }
    const wait = dep - arr;
    waits.push(wait);
    // Heartbeat check: shift the connection by each vehicle's live delay.
    const prevLate = prev.delaySeconds != null ? prev.delaySeconds / 60 : 0;
    const currLate = curr.delaySeconds != null ? curr.delaySeconds / 60 : 0;
    const effective = wait - prevLate + currLate;
    if ((prev.delaySeconds != null || curr.delaySeconds != null) && effective < WALK_TRANSFER_BUFFER_MINUTES) {
      warnings.push(
        effective < 0
          ? `Live delays may break the ${curr.routeShortName} connection at ${curr.boardStopName} — the ${prev.routeShortName} is running ~${Math.round(prevLate)} min late.`
          : `Tight connection to the ${curr.routeShortName} at ${curr.boardStopName} (~${Math.max(0, Math.round(effective))} min with current delays).`,
      );
    }
  }
  return { ...it, transferWaits: waits, warnings };
}

interface StopTimeRow {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrival_time: string | null;
  departure_time: string | null;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: number;
  route_color: string | null;
  headsign: string;
}

function mapRow(r: any): StopTimeRow | null {
  if (!r.rtd_trips?.rtd_routes) return null;
  return {
    trip_id: r.trip_id,
    stop_id: r.stop_id,
    stop_sequence: Number(r.stop_sequence),
    arrival_time: r.arrival_time,
    departure_time: r.departure_time,
    stop_name: r.rtd_stops?.stop_name ?? '',
    stop_lat: Number(r.rtd_stops?.stop_lat ?? 0),
    stop_lon: Number(r.rtd_stops?.stop_lon ?? 0),
    route_id: r.rtd_trips.route_id,
    route_short_name: r.rtd_trips.rtd_routes.route_short_name,
    route_long_name: r.rtd_trips.rtd_routes.route_long_name,
    route_type: Number(r.rtd_trips.rtd_routes.route_type),
    route_color: r.rtd_trips.rtd_routes.route_color ? `#${r.rtd_trips.rtd_routes.route_color}` : null,
    headsign: r.rtd_trips.trip_headsign ?? r.rtd_trips.rtd_routes.route_long_name ?? '',
  };
}

const ROW_SELECT =
  'trip_id, stop_id, stop_sequence, arrival_time, departure_time, rtd_stops(stop_name, stop_lat, stop_lon), rtd_trips(route_id, trip_headsign, rtd_routes(route_short_name, route_long_name, route_type, route_color))';

/** All stop_times for the given trips (used to find shared transfer stops). */
async function stopTimesForTrips(tripIds: string[]): Promise<StopTimeRow[]> {
  if (!supabase || tripIds.length === 0) return [];
  // Supabase/PostgREST silently caps responses at 1000 rows, so chunk small
  // enough (10 trips x ~80 stops) that no single request can hit the cap.
  const chunks: string[][] = [];
  for (let i = 0; i < tripIds.length; i += 10) chunks.push(tripIds.slice(i, i + 10));
  const results = await Promise.all(
    chunks.map((chunk) => supabase!.from('rtd_stop_times').select(ROW_SELECT).in('trip_id', chunk)),
  );
  const rows: StopTimeRow[] = [];
  for (const { data } of results) {
    for (const r of (data ?? []) as any[]) {
      const row = mapRow(r);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function legDelay(tripUpdates: ParsedFeed | null, row: StopTimeRow): number | null {
  if (!tripUpdates) return null;
  return getTripDelay(tripUpdates, { trip_id: row.trip_id, route_id: row.route_id }).delaySeconds;
}

function makeLeg(board: StopTimeRow, alight: StopTimeRow, tripUpdates: ParsedFeed | null): ItineraryLeg {
  return {
    routeShortName: board.route_short_name,
    routeLongName: board.route_long_name,
    routeType: board.route_type,
    routeColor: board.route_color,
    tripId: board.trip_id,
    headsign: board.headsign,
    boardStopName: board.stop_name,
    boardTime: board.departure_time ?? board.arrival_time ?? '',
    alightStopName: alight.stop_name,
    alightTime: alight.arrival_time ?? alight.departure_time ?? '',
    delaySeconds: legDelay(tripUpdates, board),
  };
}

/**
 * Returns the set of service_ids that are active today for the given route.
 * Falls back to ALL service_ids for the route if calendar data is unavailable
 * (empty table, import not run, etc.) so the planner always returns results.
 */
async function activeServiceIds(routeId: string): Promise<Set<string>> {
  if (!supabase) return new Set();
  const { data: trips } = await supabase.from('rtd_trips').select('service_id').eq('route_id', routeId);
  if (!trips || trips.length === 0) return new Set();
  const allServiceIds = [...new Set(trips.map((t: any) => t.service_id as string))];

  const now = new Date();
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];

  const [{ data: cal, error: calErr }, { data: exceptions }] = await Promise.all([
    supabase.from('rtd_calendar').select('service_id, start_date, end_date, ' + weekday).in('service_id', allServiceIds),
    supabase.from('rtd_calendar_dates').select('service_id, exception_type').in('service_id', allServiceIds).eq('date', today),
  ]);

  // If calendar data is missing or the query failed, fall back to all trips
  // so results still show rather than erroring out silently.
  if (calErr || (!cal?.length && !exceptions?.length)) {
    return new Set(allServiceIds);
  }

  const added = new Set((exceptions ?? []).filter((e: any) => Number(e.exception_type) === 1).map((e: any) => e.service_id as string));
  const removed = new Set((exceptions ?? []).filter((e: any) => Number(e.exception_type) === 2).map((e: any) => e.service_id as string));

  const active = new Set<string>(added);
  for (const c of (cal ?? []) as any[]) {
    if (!removed.has(c.service_id) && Number(c[weekday]) === 1 && c.start_date <= today && c.end_date >= today) {
      active.add(c.service_id as string);
    }
  }

  // If filtering produced zero results despite having calendar rows, fall back
  // to all trips rather than returning nothing (e.g. date range issue).
  return active.size > 0 ? active : new Set(allServiceIds);
}

/** Closest pair of stops between two routes — for "why didn't this connect?" diagnostics. */
function closestApproach(
  a: Map<string, StopTimeRow[]>,
  b: Map<string, StopTimeRow[]>,
): { meters: number; stopA: string; stopB: string } | null {
  const stopsA = new Map<string, StopTimeRow>();
  for (const rows of a.values()) for (const r of rows) stopsA.set(r.stop_id, r);
  const stopsB = new Map<string, StopTimeRow>();
  for (const rows of b.values()) for (const r of rows) stopsB.set(r.stop_id, r);
  let best: { meters: number; stopA: string; stopB: string } | null = null;
  for (const sa of stopsA.values()) {
    for (const sb of stopsB.values()) {
      const d = distMeters(sa.stop_lat, sa.stop_lon, sb.stop_lat, sb.stop_lon);
      if (!best || d < best.meters) best = { meters: d, stopA: sa.stop_name, stopB: sb.stop_name };
    }
  }
  return best;
}

interface ChainState {
  stopId: string;
  lat: number;
  lon: number;
  arriveMinutes: number;
  legs: ItineraryLeg[];
}

export interface ChainResult {
  itineraries: Itinerary[];
  issues: string[];
}

/**
 * Plans a trip along a USER-CHOSEN sequence of routes (e.g. ["120L", "N"]):
 * board the first route at the origin, transfer between consecutive routes at
 * any pair of stops within walking distance (bus bay <-> rail platform counts),
 * and arrive at the destination on the last route. This is the "unorthodox
 * combo" planner that stop-ID-only systems can't do.
 */
export async function planChain(
  originStopId: string | null,
  destStopId: string | null,
  routeNames: string[],
  tripUpdates: ParsedFeed | null = null,
  options: { startMinutes?: number; arriveByMinutes?: number } = {},
): Promise<ChainResult> {
  const issues: string[] = [];
  if (!supabase || routeNames.length === 0) return { itineraries: [], issues: ['No routes selected.'] };

  const now = new Date();
  const nowMinutes = options.startMinutes ?? now.getHours() * 60 + now.getMinutes();

  const [{ data: originStop }, { data: destStop }] = await Promise.all([
    originStopId
      ? supabase.from('rtd_stops').select('stop_id, stop_name, stop_lat, stop_lon').eq('stop_id', originStopId).maybeSingle()
      : Promise.resolve({ data: null }),
    destStopId
      ? supabase.from('rtd_stops').select('stop_id, stop_name, stop_lat, stop_lon').eq('stop_id', destStopId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (originStopId && !originStop) return { itineraries: [], issues: ['Could not load the origin stop.'] };
  if (destStopId && !destStop) return { itineraries: [], issues: ['Could not load the destination stop.'] };

  // Resolve route_ids and load today-only trips for each route in the chain.
  const routeIdResults = await Promise.all(
    routeNames.map((name) =>
      supabase!.from('rtd_routes').select('route_id').eq('route_short_name', name).maybeSingle(),
    ),
  );

  const resolvedRouteIds: (string | null)[] = routeIdResults.map((r) => r.data?.route_id ?? null);

  // Load active service_ids and trip rows only for today's service.
  const routeRows = await Promise.all(
    resolvedRouteIds.map(async (routeId): Promise<Map<string, StopTimeRow[]>> => {
      const empty = new Map<string, StopTimeRow[]>();
      if (!routeId || !supabase) return empty;

      const activeIds = await activeServiceIds(routeId);

      const tripsQuery = supabase.from('rtd_trips').select('trip_id').eq('route_id', routeId);
      const { data: trips } = activeIds.size > 0
        ? await tripsQuery.in('service_id', [...activeIds])
        : await tripsQuery;
      if (!trips || trips.length === 0) return empty;

      const rows = await stopTimesForTrips(trips.map((t: any) => t.trip_id));
      const byTrip = new Map<string, StopTimeRow[]>();
      for (const r of rows) {
        if (!byTrip.has(r.trip_id)) byTrip.set(r.trip_id, []);
        byTrip.get(r.trip_id)!.push(r);
      }
      for (const list of byTrip.values()) list.sort((a, b) => a.stop_sequence - b.stop_sequence);
      return byTrip;
    }),
  );

  for (let i = 0; i < routeNames.length; i++) {
    if (routeRows[i].size === 0) issues.push(`No schedule data found for route ${routeNames[i]} today.`);
  }
  if (issues.length > 0) return { itineraries: [], issues };

  const finals: Itinerary[] = [];
  let states: ChainState[] = [
    originStop
      ? {
          stopId: originStop.stop_id,
          lat: Number(originStop.stop_lat),
          lon: Number(originStop.stop_lon),
          arriveMinutes: nowMinutes,
          legs: [],
        }
      : { stopId: '', lat: NaN, lon: NaN, arriveMinutes: nowMinutes, legs: [] },
  ];

  for (let i = 0; i < routeNames.length; i++) {
    const isFirst = i === 0;
    const isLast = i === routeNames.length - 1;
    // First route: no buffer (board immediately). Transfer legs: allow time to walk.
    const buffer = isFirst ? 0 : WALK_TRANSFER_BUFFER_MINUTES;
    const nextStates = new Map<string, ChainState>();
    let boardedAnywhere = false;

    // Transfer states are only useful at stops within walking range of the
    // next route — precompute its stop locations so we don't flood the search
    // with unreachable alight points.
    let nextRouteStops: { lat: number; lon: number }[] | null = null;
    if (!isLast) {
      const seen = new Set<string>();
      nextRouteStops = [];
      for (const trip of routeRows[i + 1].values()) {
        for (const row of trip) {
          if (seen.has(row.stop_id)) continue;
          seen.add(row.stop_id);
          nextRouteStops.push({ lat: row.stop_lat, lon: row.stop_lon });
        }
      }
    }

    for (const trip of routeRows[i].values()) {
      for (const state of states) {
        // Find the first boardable stop on this trip: near the state's location,
        // departing after we arrive (+buffer).
        // When no origin is specified on the first route, allow boarding at ANY
        // stop (not just k=0) so we don't miss trips that start at the far end.
        let boardIdx = -1;
        for (let k = 0; k < trip.length; k++) {
          const row = trip[k];
          // No origin chosen: only board at the trip's starting terminal (k===0).
          // This naturally selects the correct direction — trips going away from
          // the transfer point board at the far terminal and never find a connection.
          const near = isFirst && !originStop
            ? k === 0
            : row.stop_id === state.stopId ||
              distMeters(row.stop_lat, row.stop_lon, state.lat, state.lon) <= WALK_RADIUS_METERS;
          if (!near) continue;
          const dep = gtfsTimeToMinutes(row.departure_time ?? row.arrival_time);
          if (dep == null || dep < state.arriveMinutes + buffer) continue;
          boardIdx = k;
          break;
        }
        if (boardIdx === -1) continue;
        boardedAnywhere = true;

        const board = trip[boardIdx];
        for (let k = boardIdx + 1; k < trip.length; k++) {
          const alight = trip[k];
          const arr = gtfsTimeToMinutes(alight.arrival_time ?? alight.departure_time);
          if (arr == null) continue;
          const legs = [...state.legs, makeLeg(board, alight, tripUpdates)];

          if (isLast) {
            const atDest = destStop
              ? alight.stop_id === destStop.stop_id ||
                distMeters(alight.stop_lat, alight.stop_lon, Number(destStop.stop_lat), Number(destStop.stop_lon)) <= WALK_RADIUS_METERS
              : k === trip.length - 1; // no destination: ride to the end of the line
            if (atDest) {
              const dep0 = gtfsTimeToMinutes(legs[0].boardTime)!;
              finals.push({
                legs,
                departMinutes: dep0,
                arriveMinutes: arr,
                totalMinutes: arr - dep0,
                transfers: legs.length - 1,
              });
              break;
            }
          } else {
            // Skip alight points the next route can't be reached from.
            const reachable =
              !nextRouteStops ||
              nextRouteStops.some((s) => distMeters(alight.stop_lat, alight.stop_lon, s.lat, s.lon) <= WALK_RADIUS_METERS);
            if (!reachable) continue;
            // Candidate transfer point — keep the earliest arrival per
            // (stop, first-leg departure) so later departures survive for arrive-by mode.
            const stateKey = `${alight.stop_id}|${legs[0]?.boardTime ?? ''}`;
            const existing = nextStates.get(stateKey);
            if (!existing || arr < existing.arriveMinutes) {
              nextStates.set(stateKey, {
                stopId: alight.stop_id,
                lat: alight.stop_lat,
                lon: alight.stop_lon,
                arriveMinutes: arr,
                legs,
              });
            }
          }
        }
      }
    }

    if (!isLast) {
      if (nextStates.size === 0) {
        issues.push(
          boardedAnywhere
            ? `Boarded ${routeNames[i]}, but found no upcoming connection to ${routeNames[i + 1]}.`
            : `No upcoming ${routeNames[i]} departures near ${i === 0 ? originStop?.stop_name ?? 'the start of the line' : 'the transfer point'} today.`,
        );
        const approach = closestApproach(routeRows[i], routeRows[i + 1]);
        if (approach) {
          issues.push(
            approach.meters <= WALK_RADIUS_METERS
              ? `${routeNames[i]} and ${routeNames[i + 1]} do connect at ${approach.stopA} / ${approach.stopB} (${Math.round(approach.meters)}m apart) — the remaining schedules today just don't line up.`
              : `Closest the two routes get: ${approach.stopA} to ${approach.stopB}, ~${Math.round(approach.meters)}m apart (beyond the ${WALK_RADIUS_METERS}m walk limit).`,
          );
        }
        return { itineraries: [], issues };
      }
      // Keep the search bounded. For arrive-by, keep the LATEST candidates
      // that can still make the deadline; otherwise keep earliest arrivals.
      let pool = [...nextStates.values()];
      if (options.arriveByMinutes != null) {
        pool = pool
          .filter((s) => s.arriveMinutes <= options.arriveByMinutes!)
          .sort((a, b) => b.arriveMinutes - a.arriveMinutes);
      } else {
        pool.sort((a, b) => a.arriveMinutes - b.arriveMinutes);
      }
      states = pool.slice(0, 120);
    } else if (finals.length === 0) {
      issues.push(
        boardedAnywhere
          ? `${routeNames[i]} doesn't reach ${destStop?.stop_name ?? 'the end of the line'} (within a ${WALK_RADIUS_METERS}m walk) from those transfer points.`
          : `No upcoming ${routeNames[i]} departures connect from ${routeNames[i - 1] ?? originStop?.stop_name ?? 'the start'} today.`,
      );
    }
  }

  let candidates = finals;
  if (options.arriveByMinutes != null) {
    candidates = candidates.filter((it) => it.arriveMinutes <= options.arriveByMinutes!);
    if (candidates.length === 0 && finals.length > 0) {
      const earliest = finals.reduce((min, it) => Math.min(min, it.arriveMinutes), Infinity);
      const h = Math.floor(earliest / 60) % 24;
      const m = Math.round(earliest % 60);
      issues.push(
        `Nothing arrives by the requested time — earliest possible arrival on this combo is ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}.`,
      );
    }
    candidates.sort((a, b) => b.departMinutes - a.departMinutes);
  } else {
    candidates.sort((a, b) => a.arriveMinutes - b.arriveMinutes);
  }

  // Dominance pruning: drop any option strictly dominated by another —
  // i.e. another leaves at least as late AND arrives at least as early
  // AND has less or equal transfer wait. Must be strictly better in at
  // least one dimension to count as dominating.
  const totalWait = (it: Itinerary) =>
    it.legs.slice(1).reduce((sum, leg, i) => {
      const arr = gtfsTimeToMinutes(it.legs[i].alightTime);
      const dep = gtfsTimeToMinutes(leg.boardTime);
      return arr != null && dep != null ? sum + (dep - arr) : sum;
    }, 0);

  const nonDominated = candidates.filter(
    (it) =>
      !candidates.some(
        (other) =>
          other !== it &&
          other.departMinutes >= it.departMinutes &&
          other.arriveMinutes <= it.arriveMinutes &&
          totalWait(other) <= totalWait(it) &&
          (other.departMinutes > it.departMinutes ||
            other.arriveMinutes < it.arriveMinutes ||
            totalWait(other) < totalWait(it)),
      ),
  );

  // Dedupe on full leg signature, then collapse itineraries whose first leg
  // departs within 3 minutes of another on the same route from the same stop —
  // these are usually duplicate trips (same route, different sub-variant).
  const seenKeys = new Set<string>();
  const dedup: Itinerary[] = [];
  for (const it of nonDominated) {
    const key = it.legs.map((l) => `${l.routeShortName}@${l.boardTime}>${l.alightTime}@${l.alightStopName}`).join('|');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const first = it.legs[0];
    const dep = gtfsTimeToMinutes(first.boardTime) ?? 0;
    const tooClose = dedup.some((existing) => {
      const ef = existing.legs[0];
      if (ef.routeShortName !== first.routeShortName) return false;
      if (ef.boardStopName !== first.boardStopName) return false;
      const ed = gtfsTimeToMinutes(ef.boardTime) ?? 0;
      return Math.abs(dep - ed) <= 3;
    });
    if (tooClose) continue;

    dedup.push(it);
  }

  // Diversify: prefer options that catch a different connecting train on the
  // final leg so cards represent genuinely different journeys.
  const seenLastTrip = new Set<string>();
  const diverse: Itinerary[] = [];
  const rest: Itinerary[] = [];
  for (const it of dedup) {
    const lastTripId = it.legs[it.legs.length - 1]?.tripId;
    if (lastTripId && !seenLastTrip.has(lastTripId)) {
      seenLastTrip.add(lastTripId);
      diverse.push(it);
    } else {
      rest.push(it);
    }
  }

  const unique = [...diverse, ...rest].slice(0, MAX_ITINERARIES).map(annotateTransfers);
  return { itineraries: unique, issues };
}
