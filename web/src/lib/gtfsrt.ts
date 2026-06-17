import protobuf from 'protobufjs';

// GTFS-Realtime v2 schema (https://gtfs.org/realtime/reference/)
const GTFS_RT_PROTO = `
syntax = "proto2";
package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}

message FeedHeader {
  required string gtfs_realtime_version = 1;
  enum Incrementality {
    FULL_DATASET = 0;
    DIFFERENTIAL = 1;
  }
  optional Incrementality incrementality = 2;
  optional uint64 timestamp = 3;
  optional string feed_version = 4;
}

message FeedEntity {
  required string id = 1;
  optional bool is_deleted = 2;
  optional TripUpdate trip_update = 3;
  optional VehiclePosition vehicle = 4;
  optional Alert alert = 5;
}

message TripUpdate {
  required TripDescriptor trip = 1;
  repeated StopTimeUpdate stop_time_update = 2;
  optional VehicleDescriptor vehicle = 3;
  optional uint64 timestamp = 4;
  optional int32 delay = 5;
  message TripProperties {
    optional string trip_id = 1;
    optional string start_date = 2;
    optional string start_time = 3;
    optional string shape_id = 4;
    optional string trip_headsign = 5;
    optional string trip_short_name = 6;
  }
  optional TripProperties trip_properties = 6;
}

message StopTimeUpdate {
  optional uint32 stop_sequence = 1;
  optional StopTimeEvent arrival = 2;
  optional StopTimeEvent departure = 3;
  optional string stop_id = 4;
  enum ScheduleRelationship {
    SCHEDULED = 0;
    SKIPPED = 1;
    NO_DATA = 2;
    UNSCHEDULED = 3;
  }
  optional ScheduleRelationship schedule_relationship = 5;
}

message StopTimeEvent {
  optional int32 delay = 1;
  optional int64 time = 2;
  optional int32 uncertainty = 3;
}

message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional Position position = 2;
  optional uint32 current_stop_sequence = 3;
  optional VehicleStopStatus current_status = 4;
  optional uint64 timestamp = 5;
  enum CongestionLevel {
    UNKNOWN_CONGESTION_LEVEL = 0;
    RUNNING_SMOOTHLY = 1;
    STOP_AND_GO = 2;
    CONGESTION = 3;
    SEVERE_CONGESTION = 4;
  }
  optional CongestionLevel congestion_level = 6;
  optional string stop_id = 7;
  optional VehicleDescriptor vehicle = 8;
  enum OccupancyStatus {
    EMPTY = 0;
    MANY_SEATS_AVAILABLE = 1;
    FEW_SEATS_AVAILABLE = 2;
    STANDING_ROOM_ONLY = 3;
    CRUSHED_STANDING_ROOM_ONLY = 4;
    FULL = 5;
    NOT_ACCEPTING_PASSENGERS = 6;
    NO_DATA_AVAILABLE = 7;
    NOT_BOARDABLE = 8;
  }
  optional OccupancyStatus occupancy_status = 9;
  optional uint32 occupancy_percentage = 10;
}

enum VehicleStopStatus {
  INCOMING_AT = 0;
  STOPPED_AT = 1;
  IN_TRANSIT_TO = 2;
}

message Position {
  optional float latitude = 1;
  optional float longitude = 2;
  optional float bearing = 3;
  optional double odometer = 4;
  optional float speed = 5;
}

message TripDescriptor {
  optional string trip_id = 1;
  optional string start_time = 2;
  optional string start_date = 3;
  enum ScheduleRelationship {
    SCHEDULED = 0;
    ADDED = 1;
    UNSCHEDULED = 2;
    CANCELED = 3;
    DUPLICATED = 5;
    DELETED = 6;
  }
  optional ScheduleRelationship schedule_relationship = 4;
  optional string route_id = 5;
  optional uint32 direction_id = 6;
}

message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
  optional string license_plate = 3;
}

message Alert {
  repeated TimeRange active_period = 1;
  repeated EntitySelector informed_entity = 2;
  enum Cause {
    UNKNOWN_CAUSE = 1;
    OTHER_CAUSE = 2;
    TECHNICAL_PROBLEM = 3;
    STRIKE = 4;
    DEMONSTRATION = 5;
    ACCIDENT = 6;
    HOLIDAY = 7;
    WEATHER = 8;
    MAINTENANCE = 9;
    CONSTRUCTION = 10;
    POLICE_ACTIVITY = 11;
    MEDICAL_EMERGENCY = 12;
  }
  enum Effect {
    NO_SERVICE = 1;
    REDUCED_SERVICE = 2;
    SIGNIFICANT_DELAYS = 3;
    DETOUR = 4;
    ADDITIONAL_SERVICE = 5;
    MODIFIED_SERVICE = 6;
    OTHER_EFFECT = 7;
    UNKNOWN_EFFECT = 8;
    STOP_MOVED = 9;
    NO_EFFECT = 10;
    ACCESSIBILITY_ISSUE = 11;
  }
  optional Cause cause = 6;
  optional Effect effect = 7;
  optional TranslatedString header_text = 3;
  optional TranslatedString description_text = 4;
  optional TranslatedString url = 8;
  optional TranslatedString tts_header_text = 10;
  optional TranslatedString tts_description_text = 11;
}

message TimeRange {
  optional uint64 start = 1;
  optional uint64 end = 2;
}

message EntitySelector {
  optional string agency_id = 1;
  optional string route_id = 2;
  optional int32 route_type = 3;
  optional TripDescriptor trip = 4;
  optional string stop_id = 5;
  optional int32 direction_id = 6;
}

message TranslatedString {
  repeated Translation translation = 1;
}

message Translation {
  required string text = 1;
  optional string language = 2;
}
`;

let feedMessageTypePromise: Promise<protobuf.Type> | null = null;

async function getFeedMessageType(): Promise<protobuf.Type> {
  if (!feedMessageTypePromise) {
    feedMessageTypePromise = Promise.resolve().then(() => {
      const root = protobuf.parse(GTFS_RT_PROTO).root;
      return root.lookupType('transit_realtime.FeedMessage');
    });
  }
  return feedMessageTypePromise;
}

export interface ParsedFeed {
  header: { gtfsRealtimeVersion: string; timestamp?: number };
  entity: any[];
}

export async function decodeFeed(buffer: ArrayBuffer): Promise<ParsedFeed> {
  const FeedMessage = await getFeedMessageType();
  const message = FeedMessage.decode(new Uint8Array(buffer));
  // defaults: false so we can distinguish "field not sent" (undefined) from a real
  // zero value — e.g. RTD often omits VehiclePosition.speed entirely, and with
  // defaults:true that decoded as 0, making every vehicle look stationary.
  return FeedMessage.toObject(message, { longs: Number, enums: String, defaults: false }) as ParsedFeed;
}

export interface ServiceAlert {
  id: string;
  header: string;
  description: string;
  routeIds: string[];        // internal GTFS route_ids from informedEntity
  cause: string | null;
  effect: string | null;
  url: string | null;
  updatedAt: number;
  // Parsed metadata — derived from header/description text
  meta: AlertMeta;
}

export type AlertType =
  | 'cancellation'   // trip(s) cancelled
  | 'delay'          // delay in service
  | 'detour'         // route detour
  | 'stop_closure'   // stop(s) closed
  | 'stop_move'      // stop relocated
  | 'elevator'       // elevator/escalator out
  | 'construction'   // construction notice
  | 'notice';        // general informational

export interface AlertMeta {
  type: AlertType;
  /** Short route names parsed from the header text, e.g. ["15L"], ["W"], ["JUMP"] */
  routeShortNames: string[];
  /** Stop IDs parsed from "(#NNNNN)" patterns in the description */
  affectedStopIds: string[];
  /** Directions mentioned, lower-cased, e.g. ["westbound", "eastbound"] */
  affectedDirections: string[];
  /** Minutes of delay when type === 'delay' */
  delayMinutes: number | null;
  /** Specific trip times mentioned, e.g. ["8:08 am", "10:08 am"] */
  affectedTrips: string[];
  /**
   * Primary trip time from the header (the "Trip X:XX am" time), used for
   * auto-expiry of cancellation alerts once that trip time passes today.
   * null if no trip time found in the header.
   */
  primaryTripTime: string | null;
  /**
   * Station name parsed from the header, e.g. "Lincoln Station".
   * Used to match station-level alerts (elevator, construction) to routes
   * whose stop list contains that station name.
   */
  stationName: string | null;
  /**
   * Whether this alert can be permanently dismissed by the user.
   * Urgent/feed-driven types (cancellation, delay, detour) should not be
   * persistently dismissed — they disappear when RTD removes them from the feed.
   * Long-running informational types (elevator, construction, notice, stop_move,
   * stop_closure) can be dismissed until a new alert ID appears.
   */
  isDismissible: boolean;
}

// ─── Alert parsing ─────────────────────────────────────────────────────────────

/** Priority order for alert types — higher index = higher severity. */
const ALERT_TYPE_PRIORITY: Record<AlertType, number> = {
  cancellation: 6,
  delay:        5,
  detour:       4,
  stop_closure: 3,
  stop_move:    2,
  elevator:     1,
  construction: 1,
  notice:       0,
};

export function alertTypePriority(type: AlertType): number {
  return ALERT_TYPE_PRIORITY[type] ?? 0;
}

function classifyAlertType(header: string, description: string, effect: string | null): AlertType {
  const text = `${header} ${description}`.toLowerCase();
  if (effect === 'NO_SERVICE' || text.includes('cancel')) return 'cancellation';
  if (effect === 'SIGNIFICANT_DELAYS' || text.includes('delay')) return 'delay';
  if (effect === 'DETOUR' || text.includes('detour')) return 'detour';
  if (effect === 'STOP_MOVED' || text.includes('stop move') || text.includes('relocated')) return 'stop_move';
  if (text.includes('elevator') || text.includes('escalator')) return 'elevator';
  if (effect === 'NO_SERVICE' || text.includes('closed') || text.includes('closure')) return 'stop_closure';
  if (text.includes('construction')) return 'construction';
  return 'notice';
}

function parseRouteShortNames(header: string): string[] {
  const names: string[] = [];

  // "Route 15L", "Route 17" — bus routes
  const busMatch = header.match(/^Route\s+([A-Z0-9]+)/i);
  if (busMatch) names.push(busMatch[1].toUpperCase());

  // "W Line", "AB1 Line", "X Line"
  const railLineMatch = header.match(/^([A-Z][A-Z0-9]*)\s+Line\b/i);
  if (railLineMatch) names.push(railLineMatch[1].toUpperCase());

  // Named BRT / special services at start of header with no "Route" prefix
  // e.g. "JUMP detoured...", "SKIP 208 ...", "FLEX..."
  if (names.length === 0) {
    const namedMatch = header.match(/^([A-Z]{2,})\b/);
    if (namedMatch) names.push(namedMatch[1].toUpperCase());
  }

  // Rail line letter at the very start: "W Line" already caught above,
  // but catch cases like "AB1 notice:" where there's no "Line" keyword
  if (names.length === 0) {
    const singleMatch = header.match(/^([A-Z][A-Z0-9]*)\s+(notice|trip|station|detour)/i);
    if (singleMatch) names.push(singleMatch[1].toUpperCase());
  }

  return [...new Set(names)];
}

function parseAffectedStopIds(description: string): string[] {
  const ids: string[] = [];
  // Pattern: "(#12999)" or "(# 12999)"
  const re = /\(#\s*(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) ids.push(m[1]);
  return [...new Set(ids)];
}

function parseAffectedDirections(text: string): string[] {
  const dirs: string[] = [];
  const re = /\b(eastbound|westbound|northbound|southbound)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) dirs.push(m[1].toLowerCase());
  return [...new Set(dirs)];
}

function parseDelayMinutes(header: string): number | null {
  const m = header.match(/up to\s+(\d+)\s+minute/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseAffectedTrips(description: string): string[] {
  const times: string[] = [];
  const re = /\b(\d{1,2}:\d{2}\s*(?:am|pm))\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) times.push(m[1]);
  return [...new Set(times)];
}

/** Parse the primary trip time from the *header* (e.g. "Trip 9:23 am from ..."). */
function parsePrimaryTripTime(header: string): string | null {
  const m = header.match(/\bTrip\s+(\d{1,2}:\d{2}\s*(?:am|pm))\b/i);
  return m ? m[1] : null;
}

/** Parse a station name from the header (e.g. "Lincoln Station East Elevator..."). */
function parseStationName(header: string): string | null {
  // Match "Anything Station" — one or more words before "Station"
  const m = header.match(/\b([\w]+(?:\s+[\w]+)*\s+Station)\b/i);
  return m ? m[1].trim() : null;
}

const DISMISSIBLE_TYPES: Set<AlertType> = new Set([
  'elevator', 'construction', 'notice', 'stop_move', 'stop_closure',
]);

export function parseAlertMeta(header: string, description: string, effect: string | null): AlertMeta {
  const fullText = `${header} ${description}`;
  const type = classifyAlertType(header, description, effect);
  return {
    type,
    routeShortNames:    parseRouteShortNames(header),
    affectedStopIds:    parseAffectedStopIds(description),
    affectedDirections: parseAffectedDirections(fullText),
    delayMinutes:       parseDelayMinutes(header),
    affectedTrips:      parseAffectedTrips(description),
    primaryTripTime:    parsePrimaryTripTime(header),
    stationName:        parseStationName(header),
    isDismissible:      DISMISSIBLE_TYPES.has(type),
  };
}

/**
 * Returns true if a cancellation alert with a primary trip time has already
 * expired — the trip time has passed today (Mountain Time).
 */
export function isCancellationExpired(alert: ServiceAlert): boolean {
  if (alert.meta.type !== 'cancellation' || !alert.meta.primaryTripTime) return false;
  const t = alert.meta.primaryTripTime.replace(/\s/g, '').toLowerCase();
  const m = t.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!m) return false;
  let hours = parseInt(m[1], 10);
  const mins  = parseInt(m[2], 10);
  if (m[3] === 'pm' && hours !== 12) hours += 12;
  if (m[3] === 'am' && hours === 12) hours = 0;

  // Compare against current Mountain Time
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const tripMinutes  = hours * 60 + mins;
  const nowMinutes   = now.getHours() * 60 + now.getMinutes();
  return nowMinutes > tripMinutes + 5; // 5-min grace so it doesn't vanish the moment it departs
}

/**
 * Returns true if an alert applies to the given route.
 * Checks in order:
 *  1. informedEntity.routeId match (GTFS internal ID)
 *  2. Text-parsed short name match
 *  3. Station name match — alert mentions a station whose name appears in
 *     the route's stop list (e.g. "Lincoln Station" elevator alert surfaces
 *     on any rail line that stops at Lincoln Station)
 */
export function alertAppliesToRoute(
  alert: ServiceAlert,
  routeId: string,
  shortName: string,
  stopNames: string[] = [],
): boolean {
  if (alert.routeIds.includes(routeId)) return true;
  if (alert.meta.routeShortNames.some((n) => n.toUpperCase() === shortName.toUpperCase())) return true;
  if (alert.meta.stationName && stopNames.length > 0) {
    const station = alert.meta.stationName.toLowerCase();
    if (stopNames.some((s) => s.toLowerCase().includes(station))) return true;
  }
  return false;
}

/** Returns alerts for a route, sorted by severity then recency. */
export function getAlertsForRoute(
  allAlerts: ServiceAlert[],
  routeId: string,
  shortName: string,
  stopNames: string[] = [],
): ServiceAlert[] {
  return allAlerts
    .filter((a) => alertAppliesToRoute(a, routeId, shortName, stopNames))
    .sort((a, b) =>
      alertTypePriority(b.meta.type) - alertTypePriority(a.meta.type) ||
      b.updatedAt - a.updatedAt,
    );
}

/** Union of all stop IDs affected by a set of alerts. */
export function alertedStopIds(alerts: ServiceAlert[]): Set<string> {
  const ids = new Set<string>();
  for (const a of alerts) for (const id of a.meta.affectedStopIds) ids.add(id);
  return ids;
}

/** Display label + colour for each alert type. */
export const ALERT_TYPE_LABELS: Record<AlertType, { label: string; color: string; bg: string; border: string }> = {
  cancellation: { label: 'Cancelled',    color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/40' },
  delay:        { label: 'Delays',       color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/40' },
  detour:       { label: 'Detour',       color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/40' },
  stop_closure: { label: 'Stop Closed',  color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/40' },
  stop_move:    { label: 'Stop Moved',   color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/40' },
  elevator:     { label: 'Elevator Out', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/40' },
  construction: { label: 'Construction', color: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/40' },
  notice:       { label: 'Notice',       color: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/40' },
};


/**
 * Returns currently-active alerts that apply to the given route/stop/trip.
 * RTD's informedEntity uses the GTFS `route_id` (e.g. an internal ID), NOT the
 * rail line letter (route_short_name) — callers must pass the actual route_id.
 */
export function getActiveAlerts(
  alertsFeed: ParsedFeed | null,
  filter: { routeId?: string; stopId?: string; tripId?: string } = {},
): ServiceAlert[] {
  if (!alertsFeed?.entity) return [];

  const now = Math.floor(Date.now() / 1000);

  return alertsFeed.entity
    .filter((entity) => {
      const alert = entity.alert;
      if (!alert) return false;

      // RTD leaves headerText/descriptionText empty for most alerts and only
      // populates ttsHeaderText/ttsDescriptionText instead, so check both pairs.
      // An activePeriod.end of 0 means "no end date" (treated as never-ending below).
      const hasHeader = alert.headerText?.translation?.length || alert.ttsHeaderText?.translation?.length;
      const hasDescription = alert.descriptionText?.translation?.length || alert.ttsDescriptionText?.translation?.length;
      if (!hasHeader && !hasDescription) {
        return false;
      }

      const informed: any[] = alert.informedEntity || [];
      const matchesFilter =
        informed.length === 0 ||
        !(filter.routeId || filter.stopId || filter.tripId) ||
        informed.some((ie) => {
          // An entity that only specifies an agency (no route/stop/trip) is a
          // system-wide alert and applies to every route/stop.
          if (ie.agencyId && !ie.routeId && !ie.stopId && !ie.trip) return true;
          if (filter.routeId && ie.routeId === filter.routeId) return true;
          if (filter.stopId && ie.stopId === filter.stopId) return true;
          if (filter.tripId && ie.trip?.tripId === filter.tripId) return true;
          return false;
        });
      if (!matchesFilter) return false;

      const periods: any[] = alert.activePeriod || [];
      if (periods.length === 0) return true;
      return periods.some((p) => {
        const start = Number(p.start || 0);
        const end = p.end ? Number(p.end) : Infinity;
        return now >= start && now <= end;
      });
    })
    .map((entity) => {
      const alert = entity.alert;
      const informed: any[] = alert.informedEntity || [];
      const header = alert.headerText?.translation?.[0]?.text || alert.ttsHeaderText?.translation?.[0]?.text || 'Service Alert';
      const description = alert.descriptionText?.translation?.[0]?.text || alert.ttsDescriptionText?.translation?.[0]?.text || '';
      const effect = alert.effect && alert.effect !== 'UNKNOWN_EFFECT' ? alert.effect : null;
      return {
        id: entity.id,
        header,
        description,
        routeIds: [...new Set(informed.map((ie) => ie.routeId).filter(Boolean))] as string[],
        cause: alert.cause && alert.cause !== 'UNKNOWN_CAUSE' ? alert.cause : null,
        effect,
        url: alert.url?.translation?.[0]?.text || null,
        updatedAt: Math.max(0, ...((alert.activePeriod || []) as any[]).map((p) => Number(p.start || 0)).filter((t) => t > 0), 0),
        meta: parseAlertMeta(header, description, effect),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface TripDelayResult {
  delaySeconds: number | null;
  matchTier: 'trip_id' | 'route_time' | 'none';
}

/** Multi-tier match: exact trip_id, then route+direction+time within +/- windowMinutes. */
export function getTripDelay(
  tripUpdatesFeed: ParsedFeed | null,
  train: { trip_id: string; route_id?: string; direction_id?: number; departure_time?: string; start_time?: string },
  windowMinutes = 10,
): TripDelayResult {
  const entities = tripUpdatesFeed?.entity;
  if (!entities) return { delaySeconds: null, matchTier: 'none' };

  // Tier 1: exact trip_id match.
  let match = entities.find((e) => e.tripUpdate?.trip?.tripId === train.trip_id);
  if (match) {
    // Top-level TripUpdate.delay is often absent; fall back to the first stop's delay.
    const topLevel = match.tripUpdate.delay ?? null;
    if (topLevel !== null) return { delaySeconds: topLevel, matchTier: 'trip_id' };
    const stus: any[] = match.tripUpdate.stopTimeUpdate ?? [];
    const firstDelay = stus[0]?.departure?.delay ?? stus[0]?.arrival?.delay ?? null;
    return { delaySeconds: firstDelay, matchTier: 'trip_id' };
  }

  // Tier 2: match by TripDescriptor.start_time (RTD puts this in the trip descriptor
  // and it's stable across trip_id rotations).
  if (train.start_time && train.route_id && train.direction_id !== undefined) {
    match = entities.find((e) => {
      const trip = e.tripUpdate?.trip;
      return trip?.routeId === train.route_id &&
        Number(trip?.directionId ?? -1) === train.direction_id &&
        trip?.startTime === train.start_time;
    });
    if (match) {
      const topLevel = match.tripUpdate.delay ?? null;
      if (topLevel !== null) return { delaySeconds: topLevel, matchTier: 'route_time' };
      const stus: any[] = match.tripUpdate.stopTimeUpdate ?? [];
      const firstDelay = stus[0]?.departure?.delay ?? stus[0]?.arrival?.delay ?? null;
      return { delaySeconds: firstDelay, matchTier: 'route_time' };
    }
  }

  // Tier 3: match by route + direction + scheduled departure time window.
  if (train.route_id && train.direction_id !== undefined && train.departure_time) {
    const trainMinutes = timeToMinutes(train.departure_time);
    match = entities.find((e) => {
      const trip = e.tripUpdate?.trip;
      if (!trip) return false;
      if (trip.routeId !== train.route_id) return false;
      if (Number(trip.directionId ?? -1) !== train.direction_id) return false;

      const stopTimes = e.tripUpdate?.stopTimeUpdate || [];
      return stopTimes.some((stu: any) => {
        const time = stu.departure?.time ?? stu.arrival?.time;
        if (!time) return false;
        // Parse in Denver local time to match GTFS scheduled times.
        const d = new Date(Number(time) * 1000);
        const mst = new Date(d.toLocaleString('en-US', { timeZone: 'America/Denver' }));
        const rtMinutes = mst.getHours() * 60 + mst.getMinutes();
        return Math.abs(rtMinutes - trainMinutes) <= windowMinutes;
      });
    });
    if (match) {
      const topLevel = match.tripUpdate.delay ?? null;
      if (topLevel !== null) return { delaySeconds: topLevel, matchTier: 'route_time' };
      const stus: any[] = match.tripUpdate.stopTimeUpdate ?? [];
      const firstDelay = stus[0]?.departure?.delay ?? stus[0]?.arrival?.delay ?? null;
      return { delaySeconds: firstDelay, matchTier: 'route_time' };
    }
  }

  return { delaySeconds: null, matchTier: 'none' };
}

export interface UpcomingArrival {
  stopId: string;
  directionId: number;
  time: number; // unix seconds
  departureTime: number | null; // predicted departure from this stop, if known
  delaySeconds: number | null;
  tripId: string;
  scheduleRelationship?: string;
}

/**
 * Live predicted arrivals per stop+direction for a route, derived from Trip Updates
 * (no static schedule needed). Key is `${stopId}|${directionId}`.
 */
// Grace window: keep recently-departed stop times visible so the UI can show "Departed".
// Must exceed the poll interval (30 s) to avoid disappearing between feed refreshes.
const DEPARTED_GRACE_SEC = 90;

export function getUpcomingArrivalsByStop(
  tripUpdatesFeed: ParsedFeed | null,
  routeId: string,
  limitPerStop = 3,
): Record<string, UpcomingArrival[]> {
  const entities = tripUpdatesFeed?.entity;
  if (!entities) return {};

  const now = Math.floor(Date.now() / 1000);
  const byStop: Record<string, UpcomingArrival[]> = {};

  for (const e of entities) {
    const trip = e.tripUpdate?.trip;
    if (!trip || trip.routeId !== routeId) continue;
    // Skip entities with no direction_id — can't bucket them correctly.
    if (trip.directionId == null) continue;
    const directionId = Number(trip.directionId);

    const tripDelay = e.tripUpdate.delay ?? null;
    for (const stu of e.tripUpdate.stopTimeUpdate || []) {
      const time = Number(stu.arrival?.time ?? stu.departure?.time);
      if (!time || time < now - DEPARTED_GRACE_SEC) continue;
      const stopId = stu.stopId;
      if (!stopId) continue;

      const delaySeconds = stu.arrival?.delay ?? stu.departure?.delay ?? tripDelay;
      const departureTime = stu.departure?.time != null ? Number(stu.departure.time) : null;
      const key = `${stopId}|${directionId}`;
      (byStop[key] ??= []).push({ stopId, directionId, time, departureTime, delaySeconds, tripId: trip.tripId, scheduleRelationship: stu.scheduleRelationship ?? undefined });
    }
  }

  for (const key of Object.keys(byStop)) {
    byStop[key].sort((a, b) => a.time - b.time);
    byStop[key] = byStop[key].slice(0, limitPerStop);
  }

  return byStop;
}

export interface StopArrival {
  routeId: string;
  directionId: number;
  time: number; // unix seconds
  delaySeconds: number | null;
  tripId: string;
}

/** Live predicted arrivals at a single stop across ALL routes (for the stop view). */
export function getArrivalsForStop(tripUpdatesFeed: ParsedFeed | null, stopId: string, limit = 10): StopArrival[] {
  const entities = tripUpdatesFeed?.entity;
  if (!entities) return [];

  const now = Math.floor(Date.now() / 1000);
  const arrivals: StopArrival[] = [];

  for (const e of entities) {
    const trip = e.tripUpdate?.trip;
    if (!trip?.routeId) continue;
    const tripDelay = e.tripUpdate.delay ?? null;
    for (const stu of e.tripUpdate.stopTimeUpdate || []) {
      if (stu.stopId !== stopId) continue;
      const time = Number(stu.arrival?.time ?? stu.departure?.time);
      if (!time || time < now - DEPARTED_GRACE_SEC) continue;
      arrivals.push({
        routeId: trip.routeId,
        directionId: Number(trip.directionId ?? 0),
        time,
        delaySeconds: stu.arrival?.delay ?? stu.departure?.delay ?? tripDelay,
        tripId: trip.tripId,
      });
    }
  }

  return arrivals.sort((a, b) => a.time - b.time).slice(0, limit);
}

/**
 * Stop IDs (per direction) that an active trip is skipping, e.g. an express
 * service bypassing local stops. Key is `${stopId}|${directionId}`.
 */
export function getSkippedStops(tripUpdatesFeed: ParsedFeed | null, routeId: string): Set<string> {
  const entities = tripUpdatesFeed?.entity;
  const skipped = new Set<string>();
  if (!entities) return skipped;

  for (const e of entities) {
    const trip = e.tripUpdate?.trip;
    if (!trip || trip.routeId !== routeId) continue;
    const directionId = Number(trip.directionId ?? 0);

    for (const stu of e.tripUpdate.stopTimeUpdate || []) {
      if (stu.scheduleRelationship !== 'SKIPPED' || !stu.stopId) continue;
      skipped.add(`${stu.stopId}|${directionId}`);
    }
  }

  return skipped;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h % 24) * 60 + m;
}
