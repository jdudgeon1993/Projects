import { lazy, Suspense, useEffect, useState } from 'react';
import { useRailLine } from '../lib/useRailLine';
import { getRailLines, getNearestRoutes, getRoutesServingStop, routeTypeLabel, type RailLineOption, type NearbyRoute, type RouteAtStop } from '../lib/schedule';
import { getArrivalsForStop, getActiveAlerts, type UpcomingArrival, type ServiceAlert } from '../lib/gtfsrt';
import { getDrivingRoute, type DrivingRoute } from '../lib/api';
import { decodePolyline } from '../lib/polyline';
import { loadSavedTrips, type SavedTrip } from '../lib/savedTrips';
import { alertSeenKey, loadSeenAlerts, persistSeenAlerts } from '../lib/seenAlerts';
import BottomSheet from './BottomSheet';

const TripPlanner = lazy(() => import('./TripPlanner'));

const RailLineMap = lazy(() => import('./RailLineMap'));

const OCCUPANCY_LABELS: Record<string, string> = {
  EMPTY: 'empty',
  MANY_SEATS_AVAILABLE: 'many seats available',
  FEW_SEATS_AVAILABLE: 'few seats available',
  STANDING_ROOM_ONLY: 'standing room only',
  CRUSHED_STANDING_ROOM_ONLY: 'crowded',
  FULL: 'full',
  NOT_ACCEPTING_PASSENGERS: 'not accepting passengers',
  NOT_BOARDABLE: 'not boardable',
};

function formatOccupancy(status: string): string {
  return OCCUPANCY_LABELS[status] ?? status.replace(/_/g, ' ').toLowerCase();
}

const VEHICLE_STATUS_LABELS: Record<string, string> = {
  INCOMING_AT: 'Approaching next stop',
  STOPPED_AT: 'Stopped at platform',
  IN_TRANSIT_TO: 'In transit',
};

/** "45 min" under an hour, "1 hr 52 min" above. */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function formatDelay(seconds: number | null): string {
  if (seconds == null) return '';
  if (Math.abs(seconds) < 60) return 'on time';
  const mins = Math.round(seconds / 60);
  return mins > 0 ? `+${mins} min late` : `${Math.abs(mins)} min early`;
}

/** Extracts a route label (e.g. "36" or "A") from alerts that begin with "Route 36 ..." or "Route A ...". */
function parseRouteLabel(header: string): string | null {
  const match = header.match(/^Route\s+([A-Za-z0-9]+)/i);
  return match ? match[1] : null;
}

type AlertCategory = 'closure' | 'detour' | 'schedule' | 'other';

const ALERT_CATEGORY_LABELS: Record<AlertCategory, string> = {
  closure: 'Stop Closures',
  detour: 'Detours',
  schedule: 'Schedule Changes',
  other: 'Other',
};

function categorizeAlert(alert: ServiceAlert): AlertCategory {
  const text = `${alert.header} ${alert.description}`.toLowerCase();
  if (alert.effect === 'DETOUR' || text.includes('detour')) return 'detour';
  if (alert.effect === 'NO_SERVICE' || alert.effect === 'STOP_MOVED' || text.includes('closed') || text.includes('closure')) return 'closure';
  if (alert.effect === 'MODIFIED_SERVICE' || alert.effect === 'REDUCED_SERVICE' || text.includes('service change') || text.includes('schedule')) return 'schedule';
  return 'other';
}

/** Formats a GTFS HH:MM:SS time (hours can exceed 24 for next-day trips) as a 12-hour clock time. */
function formatScheduledTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const hour24 = h % 24;
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatClockTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}


interface PhaseInfo {
  label: string;
  sublabel: string | null;
  dotClass: string;
  labelClass: string;
  animate: 'none' | 'pulse' | 'bounce';
  current: UpcomingArrival | null;
  upcoming: UpcomingArrival[];
}

function computeStopPhase(
  arrivals: UpcomingArrival[],
  nowSec: number,
  isTerminal: boolean,
): PhaseInfo {
  const dwelling = arrivals.find((a) => {
    const dep = a.departureTime ?? a.time;
    return nowSec >= a.time - 5 && nowSec < Math.max(dep, a.time + 15) + 5;
  });
  const dwellingDeparted =
    dwelling != null && nowSec >= Math.max(dwelling.departureTime ?? dwelling.time, dwelling.time);

  const pool = arrivals.filter((a) => a.time - nowSec > -25);
  const current = pool[0] ?? null;
  const rest = pool.slice(1);

  if (dwelling && !dwellingDeparted) {
    const dep = dwelling.departureTime ?? dwelling.time;
    const depIn = Math.round(dep - nowSec);
    const sublabel = depIn > 5 ? `Departs in ${depIn}s` : 'Departing soon';
    return {
      label: isTerminal ? 'At Platform' : 'Arrived',
      sublabel,
      dotClass: 'border-amber-400 bg-amber-400',
      labelClass: 'text-amber-400',
      animate: 'pulse',
      current: dwelling,
      upcoming: rest,
    };
  }

  if (dwelling && dwellingDeparted) {
    const dep = Math.max(dwelling.departureTime ?? dwelling.time, dwelling.time);
    const secsSince = nowSec - dep;
    if (secsSince < 10) {
      return {
        label: 'Departing',
        sublabel: null,
        dotClass: 'border-amber-500 bg-amber-500/30',
        labelClass: 'text-amber-400',
        animate: 'pulse',
        current: dwelling,
        upcoming: rest,
      };
    }
    if (secsSince < 25) {
      return {
        label: 'Departed',
        sublabel: null,
        dotClass: 'border-slate-500 bg-slate-700',
        labelClass: 'text-slate-500',
        animate: 'none',
        current: rest[0] ?? null,
        upcoming: rest.slice(1),
      };
    }
  }

  if (!current) {
    return {
      label: '—',
      sublabel: null,
      dotClass: 'border-slate-700 bg-slate-800',
      labelClass: 'text-slate-700',
      animate: 'none',
      current: null,
      upcoming: [],
    };
  }

  const diff = current.time - nowSec;

  if (diff <= 0) {
    return {
      label: 'Departed',
      sublabel: null,
      dotClass: 'border-slate-500 bg-slate-700',
      labelClass: 'text-slate-500',
      animate: 'none',
      current: rest[0] ?? null,
      upcoming: rest.slice(1),
    };
  }
  if (diff <= 7) {
    return {
      label: 'Arriving',
      sublabel: formatClockTime(current.time),
      dotClass: 'border-red-400 bg-red-400',
      labelClass: 'text-red-400',
      animate: 'pulse',
      current,
      upcoming: rest,
    };
  }
  if (diff <= 30) {
    return {
      label: 'Arriving soon',
      sublabel: formatClockTime(current.time),
      dotClass: 'border-red-400 bg-red-400/40',
      labelClass: 'text-red-400',
      animate: 'pulse',
      current,
      upcoming: rest,
    };
  }
  if (diff <= 60) {
    const secs = Math.ceil(diff);
    return {
      label: `:${String(secs).padStart(2, '0')}`,
      sublabel: formatClockTime(current.time),
      dotClass: 'border-red-400 bg-red-400/20',
      labelClass: 'text-red-400',
      animate: 'bounce',
      current,
      upcoming: rest,
    };
  }
  if (diff <= 180) {
    return {
      label: `${Math.ceil(diff / 60)} min`,
      sublabel: formatClockTime(current.time),
      dotClass: 'border-yellow-400 bg-yellow-400/20',
      labelClass: 'text-yellow-400',
      animate: 'pulse',
      current,
      upcoming: rest,
    };
  }
  if (diff <= 300) {
    return {
      label: `${Math.ceil(diff / 60)} min`,
      sublabel: formatClockTime(current.time),
      dotClass: 'border-yellow-400 bg-yellow-400/10',
      labelClass: 'text-yellow-400',
      animate: 'none',
      current,
      upcoming: rest,
    };
  }
  const mins = Math.round(diff / 60);
  return {
    label: `${mins} min`,
    sublabel: formatClockTime(current.time),
    dotClass: 'border-sky-500/40 bg-slate-800',
    labelClass: 'text-sky-400',
    animate: 'none',
    current,
    upcoming: rest,
  };
}

/** Destination input + result, shared between the empty-map state and the Directions tab. */
function DirectionsPanel({
  destination,
  setDestination,
  driveLoading,
  driveError,
  drivingRoute,
  onGo,
}: {
  destination: string;
  setDestination: (v: string) => void;
  driveLoading: boolean;
  driveError: string | null;
  drivingRoute: DrivingRoute | null;
  onGo: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onGo()}
          placeholder="Destination address…"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onGo}
          disabled={driveLoading || !destination.trim()}
          className="shrink-0 rounded-lg border border-orange-500 bg-orange-500/20 px-3 py-2 text-sm font-medium text-orange-300 hover:bg-orange-500/30 disabled:opacity-50"
        >
          {driveLoading ? '…' : 'Go'}
        </button>
      </div>
      {driveError && <p className="text-xs text-red-400">{driveError}</p>}
      {drivingRoute && (
        <p className="text-sm text-slate-300">
          🚗 {drivingRoute.minutes} min · {(drivingRoute.distanceMeters / 1609.34).toFixed(1)} mi
          {drivingRoute.trafficPercent > 0 && <span className="text-amber-400"> · +{drivingRoute.trafficPercent}% traffic</span>}
        </p>
      )}
    </div>
  );
}

const FAV_KEY = 'nexus_fav_routes';

function loadFavorites(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export default function RailLineSection() {
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [shortName, setShortName] = useState<string | null>(null);
  const [lines, setLines] = useState<RailLineOption[]>([]);
  const { directions, arrivalsByStop, skippedStops, vehicleByTripId, vehicles, routeType, color, fare, transfersByStop, serviceToday, tripUpdates, alerts, lastUpdated, loading, error } =
    useRailLine(shortName);
  const [selectedVehicleStop, setSelectedVehicleStop] = useState<string | null>(null);
  const activeAlerts: ServiceAlert[] = getActiveAlerts(alerts);
  const [savedTrips] = useState<SavedTrip[]>(loadSavedTrips);
  const [activeOverlay, setActiveOverlay] = useState<'directions' | 'alerts' | 'plan' | 'settings' | null>(null);
  const [alertSearch, setAlertSearch] = useState('');
  const [alertCategory, setAlertCategory] = useState<AlertCategory | null>(null);
  const [seenAlertKeys, setSeenAlertKeys] = useState<Set<string>>(loadSeenAlerts);
  const newAlerts = activeAlerts.filter((a) => !seenAlertKeys.has(alertSeenKey(a.id, a.header)));

  // Mark all currently-active alerts as "seen" once the alerts overlay is closed,
  // so only newly-appeared alerts are highlighted/counted next time.
  function markAlertsSeen(current: ServiceAlert[]) {
    setSeenAlertKeys((prev) => {
      const next = new Set(prev);
      for (const a of current) next.add(alertSeenKey(a.id, a.header));
      persistSeenAlerts(next);
      return next;
    });
  }
  const [sheetExpandTrigger, setSheetExpandTrigger] = useState(0);

  function toggleFavorite(name: string) {
    setFavorites((prev) => {
      const next = prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  }

  // Stop view: tap a stop in the list to see every route serving it + live arrivals.
  const [selectedStop, setSelectedStop] = useState<{ stopId: string; stopName: string } | null>(null);
  const [vehiclesExpanded, setVehiclesExpanded] = useState(false);
  const [stopRoutes, setStopRoutes] = useState<RouteAtStop[] | null>(null);
  useEffect(() => {
    if (!selectedStop) {
      setStopRoutes(null);
      return;
    }
    let cancelled = false;
    setStopRoutes(null);
    getRoutesServingStop(selectedStop.stopId).then((r) => {
      if (!cancelled) setStopRoutes(r);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStop?.stopId]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getRailLines().then((result) => {
      if (result.length > 0) setLines(result);
    });
  }, []);

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [nearby, setNearby] = useState<NearbyRoute[]>([]);
  const [nearbyState, setNearbyState] = useState<'idle' | 'loading' | 'error' | 'empty'>('idle');
  const [directionIdx, setDirectionIdx] = useState(0);

  const [destination, setDestination] = useState('');
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [drivingRoute, setDrivingRoute] = useState<DrivingRoute | null>(null);
  const [driveOrigin, setDriveOrigin] = useState<[number, number] | null>(null);
  const [driveDestPoint, setDriveDestPoint] = useState<[number, number] | null>(null);
  const [drivePoints, setDrivePoints] = useState<[number, number][] | null>(null);

  function startDriving() {
    if (!destination.trim()) return;
    if (!navigator.geolocation) {
      setDriveError("Couldn't get your location");
      return;
    }
    setDriveLoading(true);
    setDriveError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const origin: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        try {
          const route = await getDrivingRoute(
            { lat: origin[0], lng: origin[1] },
            destination.trim(),
          );
          if (!route.polyline) throw new Error('No route geometry returned');
          const points = decodePolyline(route.polyline);
          setDrivingRoute(route);
          setDriveOrigin(origin);
          setDriveDestPoint(points[points.length - 1]);
          setDrivePoints(points);
        } catch (e) {
          setDriveError(e instanceof Error ? e.message : 'Failed to get directions');
          setDrivingRoute(null);
        } finally {
          setDriveLoading(false);
        }
      },
      () => {
        setDriveError("Couldn't get your location");
        setDriveLoading(false);
      },
      { timeout: 10000 },
    );
  }

  function selectLine(name: string) {
    setShortName(name);
    setActiveOverlay(null);
    setDirectionIdx(0);
  }

  function clearDriving() {
    setDrivingRoute(null);
    setDriveOrigin(null);
    setDriveDestPoint(null);
    setDrivePoints(null);
    setDestination('');
    setDriveError(null);
  }

  function findNearby() {
    if (!navigator.geolocation) {
      setNearbyState('error');
      return;
    }
    setNearbyState('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const results = await getNearestRoutes(pos.coords.latitude, pos.coords.longitude);
        setNearby(results);
        setNearbyState(results.length > 0 ? 'idle' : 'empty');
      },
      () => setNearbyState('error'),
      { timeout: 10000 },
    );
  }

  const lineOptions = lines;
  const filteredOptions = search.trim()
    ? lineOptions.filter(
        (l) =>
          l.shortName.toLowerCase().includes(search.trim().toLowerCase()) ||
          l.longName?.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : lineOptions;
  const commuterLines = filteredOptions.filter((l) => l.routeType === 2);
  const lightRailLines = filteredOptions.filter((l) => l.routeType === 0 || l.routeType === 1);
  const busLines = filteredOptions.filter((l) => l.routeType === 3);
  const hasLiveService = vehicles.length > 0;
  const lineColor = color ?? '#38bdf8';
  const isBus = routeType === 3;

  // RTD doesn't publish fares in GTFS (account-based fare capping since 2024),
  // so fall back to the published flat fares: $10 airport service, $2.75 standard.
  const currentLine = lineOptions.find((l) => l.shortName === shortName);
  const isAirportRoute = shortName === 'A' || /airport|skyride/i.test(currentLine?.longName ?? '');
  const farePrice = fare?.price ?? (isAirportRoute ? 10 : 2.75);

  const dir = directions[Math.min(directionIdx, Math.max(directions.length - 1, 0))];

  // Map shows either the rail line or the driving route, never both — which one
  // depends on whether the Directions overlay is open.
  const showDriving = drivePoints && driveOrigin && driveDestPoint && (shortName == null || activeOverlay === 'directions');
  const showRail = shortName != null && activeOverlay !== 'directions';
  const dirGradient =
    directionIdx === 1
      ? 'linear-gradient(135deg, rgba(192,132,252,.18), rgba(15,23,42,.5))'
      : 'linear-gradient(135deg, rgba(56,189,248,.18), rgba(15,23,42,.5))';
  const dirBorder = directionIdx === 1 ? 'rgba(192,132,252,.4)' : 'rgba(56,189,248,.4)';

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Full-bleed live map */}
      <div className="absolute inset-0">
        <Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-slate-950 text-sm text-slate-500">Loading map…</div>}>
          <RailLineMap
            directions={showRail ? directions : []}
            vehicles={showRail ? vehicles : []}
            routeColor={color}
            drivingRoute={showDriving ? { points: drivePoints!, origin: driveOrigin!, destination: driveDestPoint! } : null}
          />
        </Suspense>
      </div>

      {/* Floating search bar — persistent "Find a Stop or Route" entry point */}
      <div className="absolute inset-x-2 top-2 z-[1001] space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 p-2 shadow-lg backdrop-blur">
          <span className="pl-1 text-slate-500">🔍</span>
          <input
            type="text"
            value={search}
            onFocus={() => setSearchOpen(true)}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchOpen(true);
            }}
            placeholder="Find a Stop or Route…"
            className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={findNearby}
            title="Find routes near my location"
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
          >
            {nearbyState === 'loading' ? '…' : '📍'}
          </button>
          {shortName != null && (
            <button
              type="button"
              onClick={() => toggleFavorite(shortName)}
              title={favorites.includes(shortName) ? 'Remove from favorites' : 'Add to favorites (loads first next visit)'}
              className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm hover:bg-slate-700"
            >
              {favorites.includes(shortName) ? '★' : '☆'}
            </button>
          )}
          {activeAlerts.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveOverlay('alerts');
                setSheetExpandTrigger((n) => n + 1);
              }}
              title="View service alerts"
              className="shrink-0 rounded-lg border border-amber-600/50 bg-amber-500/10 px-2 py-1.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/20"
            >
              ⚠️ {newAlerts.length > 0 ? newAlerts.length : activeAlerts.length}
            </button>
          )}
        </div>

        {searchOpen && (
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/90 p-2 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between px-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Routes &amp; Lines</p>
              <button type="button" onClick={() => setSearchOpen(false)} className="text-xs text-slate-500 hover:text-slate-300">
                ✕ close
              </button>
            </div>
            {nearbyState === 'error' && <p className="text-[10px] text-red-400">Couldn't get location</p>}
            {nearbyState === 'empty' && <p className="text-[10px] text-slate-500">No nearby routes found</p>}
            {nearby.length > 0 && (
              <div className="space-y-0.5 rounded border border-slate-700 bg-slate-800 p-1">
                {nearby.map((r) => (
                  <button
                    key={r.shortName}
                    type="button"
                    onClick={() => {
                      selectLine(r.shortName);
                      setNearby([]);
                      setSearchOpen(false);
                    }}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-xs text-slate-300 hover:bg-slate-700"
                    title={`${r.stopName} — ${Math.round(r.distanceMeters)}m`}
                  >
                    {r.shortName} · {Math.round(r.distanceMeters)}m
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {favorites.filter((f) => lineOptions.some((l) => l.shortName === f)).length > 0 && (
                <div>
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">★ Favorites</p>
                  {favorites
                    .filter((f) => lineOptions.some((l) => l.shortName === f))
                    .map((f) => {
                      const line = lineOptions.find((l) => l.shortName === f)!;
                      return (
                        <button
                          key={`fav-${f}`}
                          type="button"
                          onClick={() => {
                            selectLine(f);
                            setSearch('');
                            setSearchOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm text-slate-300 hover:bg-slate-800"
                        >
                          <span
                            className="flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold text-slate-950"
                            style={{ backgroundColor: line.color ?? '#38bdf8' }}
                          >
                            {f}
                          </span>
                          <span className="truncate">{line.routeType === 3 ? line.longName : `${f} Line`}</span>
                        </button>
                      );
                    })}
                </div>
              )}
              {[
                { label: 'Commuter Rail', items: commuterLines, suffix: ' Line' },
                { label: 'Light Rail', items: lightRailLines, suffix: ' Line' },
                { label: 'Bus', items: busLines, suffix: '' },
              ].map(
                ({ label, items, suffix }) =>
                  items.length > 0 && (
                    <div key={label}>
                      <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                      {items.map((line) => (
                        <button
                          key={line.shortName}
                          type="button"
                          onClick={() => {
                            selectLine(line.shortName);
                            setSearch('');
                            setSearchOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm text-slate-300 hover:bg-slate-800"
                        >
                          <span
                            className="flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold text-slate-950"
                            style={{ backgroundColor: line.color ?? '#38bdf8' }}
                          >
                            {line.shortName}
                          </span>
                          <span className="truncate">{suffix ? `${line.shortName}${suffix}` : `${line.shortName} — ${line.longName}`}</span>
                        </button>
                      ))}
                    </div>
                  ),
              )}
              {commuterLines.length === 0 && lightRailLines.length === 0 && busLines.length === 0 && (
                <p className="px-1 py-1 text-sm text-slate-500">No routes match "{search}"</p>
              )}
            </div>
          </div>
        )}

        {loading && <p className="rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-sm text-slate-400 shadow-lg backdrop-blur">Loading…</p>}
        {error && <p className="rounded-xl border border-red-900/60 bg-slate-900/90 px-3 py-2 text-sm text-red-400 shadow-lg backdrop-blur">Error: {error}</p>}
      </div>

      {/* Floating action buttons — Plan & Settings open as full-screen sheets, same as Directions/Alerts */}
      <div className="absolute bottom-4 right-4 z-[1100] flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setActiveOverlay('plan')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-lg text-slate-300 shadow-lg backdrop-blur transition-colors hover:border-sky-500"
          title="Trip Planner"
        >
          🧭
        </button>
        <button
          type="button"
          onClick={() => setActiveOverlay('settings')}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-lg text-slate-300 shadow-lg backdrop-blur transition-colors hover:border-sky-500"
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Bottom sheet — live vehicles, departure board, stop detail */}
      {!loading && (
        <BottomSheet
          expandTrigger={sheetExpandTrigger}
          initialSnap={shortName == null && !drivingRoute ? 0 : 1}
          header={
            shortName == null ? (
              <div className="w-full px-1 text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {drivingRoute ? 'Driving Directions' : 'Live Transit Map'}
                </p>
                <p className="truncate text-sm font-semibold text-slate-100">
                  {drivingRoute
                    ? `🚗 ${drivingRoute.minutes} min · ${(drivingRoute.distanceMeters / 1609.34).toFixed(1)} mi${drivingRoute.trafficPercent > 0 ? ` · +${drivingRoute.trafficPercent}% traffic` : ''}`
                    : 'Search for a route, or tap 🚗 for driving directions'}
                </p>
              </div>
            ) : (
            <div className="w-full px-1">
              <div
                className="flex items-center gap-2 rounded-xl border p-2 transition-colors"
                style={{ background: dirGradient, borderColor: dirBorder }}
              >
                {directions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDirectionIdx((i) => (i - 1 + directions.length) % directions.length)}
                    className="shrink-0 text-lg text-slate-400 hover:text-slate-100"
                    title="Previous direction"
                  >
                    ‹
                  </button>
                )}
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-slate-950 shadow-md"
                  style={{ backgroundColor: lineColor }}
                >
                  {shortName}
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {isBus ? `Route ${shortName}` : `${shortName} Line`}
                    {dir && <span className="font-normal text-slate-400"> · To {dir.headsign}</span>}
                  </p>
                  {dir && (
                    <p className="mt-0.5 truncate text-[10px] text-slate-400">
                      {routeType != null && `${routeTypeLabel(routeType)} · $${farePrice.toFixed(2)}`}
                      {dir.accessibility.wheelchairAccessible === true && ' · ♿'}
                      {dir.accessibility.bikesAllowed === true && ' · 🚲'}
                      {dir.scheduledDurationMinutes != null && ` · ~${formatDuration(dir.scheduledDurationMinutes)} trip`}
                      {dir.frequencyMinutes != null && ` · every ~${dir.frequencyMinutes} min`}
                    </p>
                  )}
                </div>
                {directions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDirectionIdx((i) => (i + 1) % directions.length)}
                    className="shrink-0 text-lg text-slate-400 hover:text-slate-100"
                    title="Next direction"
                  >
                    ›
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5">
                <div className="flex items-center gap-1">
                  {directions.length > 1 &&
                    directions.map((d, i) => (
                      <span
                        key={d.directionId}
                        className="h-1.5 rounded-full transition-all"
                        style={{
                          width: i === directionIdx ? '16px' : '6px',
                          backgroundColor: i === directionIdx ? (directionIdx === 1 ? '#c084fc' : '#38bdf8') : '#334155',
                        }}
                      />
                    ))}
                  {!loading &&
                    (hasLiveService ? (
                      <span className="ml-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">Active</span>
                    ) : serviceToday === false ? (
                      <span className="ml-1 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-400">No service today</span>
                    ) : (
                      <span className="ml-1 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-400">No live service</span>
                    ))}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveOverlay('directions')}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-sm text-slate-300 hover:bg-slate-700"
                    title="Directions"
                  >
                    🧭
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveOverlay('alerts')}
                    className="relative flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-sm text-slate-300 hover:bg-slate-700"
                    title="Alerts"
                  >
                    🔔
                    {newAlerts.length > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[9px] font-bold text-slate-950">
                        {newAlerts.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
            )
          }
        >
          {shortName == null ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Use the search bar above to pick a rail line or bus route, find one near you, or get driving directions below.
              </p>
              <div>
                <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Driving Directions</h4>
                <DirectionsPanel
                  destination={destination}
                  setDestination={setDestination}
                  driveLoading={driveLoading}
                  driveError={driveError}
                  drivingRoute={drivingRoute}
                  onGo={startDriving}
                />
                {drivingRoute && (
                  <button type="button" onClick={clearDriving} className="mt-2 text-xs text-slate-500 hover:text-slate-300">
                    ✕ clear directions
                  </button>
                )}
              </div>
              {savedTrips.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">My Commute</h4>
                  {savedTrips.map((trip) => {
                    const firstRoute = trip.chain[0];
                    const line = lineOptions.find((l) => l.shortName === firstRoute);
                    return (
                      <button
                        key={trip.name}
                        type="button"
                        onClick={() => selectLine(firstRoute)}
                        className="flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-left hover:border-sky-500"
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-slate-950"
                          style={{ backgroundColor: line?.color ?? '#38bdf8' }}
                        >
                          {firstRoute}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-200">{trip.name}</p>
                          <p className="truncate text-xs text-slate-500">{trip.chain.join(' → ')}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
          <>
          {/* Live vehicles — collapsed by default */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setVehiclesExpanded((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm"
            >
              <span className="font-medium text-slate-300">
                {isBus ? 'Live Buses' : 'Live Trains'} <span className="text-slate-500">({vehicles.length})</span>
              </span>
              <span className="text-slate-500">{vehiclesExpanded ? '▲' : '▼'}</span>
            </button>
            {vehiclesExpanded && (
              <div className="mt-1.5">
                {vehicles.length === 0 ? (
                  <p className="px-1 text-sm text-slate-500">{isBus ? 'No active buses right now.' : 'No active trains right now.'}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {vehicles.map((v, i) => {
                      const vDir = directions.find((d) => d.directionId === v.directionId);
                      const headsign = vDir?.headsign;
                      const nextStopName = v.stopId ? directions.flatMap((d) => d.stops).find((s) => s.stop_id === v.stopId)?.stop_name : undefined;
                      const dirColor = v.directionId === 1 ? '#c084fc' : '#38bdf8';
                      const delayLabel = formatDelay(v.delaySeconds);
                      const delayClass =
                        v.delaySeconds == null
                          ? 'text-slate-500'
                          : Math.abs(v.delaySeconds) < 60
                            ? 'text-emerald-400'
                            : v.delaySeconds > 0
                              ? 'text-amber-400'
                              : 'text-sky-400';
                      const statusLabel = VEHICLE_STATUS_LABELS[v.status ?? ''] ?? null;
                      return (
                        <li key={v.id} className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 p-2">
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-base"
                            style={{ backgroundColor: `${dirColor}22`, borderColor: dirColor }}
                          >
                            {isBus ? '🚌' : '🚆'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-100">
                              {isBus ? 'Bus' : 'Train'} {i + 1}
                              {headsign && <span className="font-normal text-slate-400"> → {headsign}</span>}
                            </p>
                            {nextStopName && (
                              <p className="truncate text-xs text-slate-400">
                                {v.status === 'STOPPED_AT' ? 'At ' : v.status === 'INCOMING_AT' ? 'Arriving at ' : 'Next stop: '}
                                {nextStopName}
                              </p>
                            )}
                            {v.occupancyStatus && <p className="truncate text-xs text-slate-500">👥 {formatOccupancy(v.occupancyStatus)}{v.occupancyPercentage != null && ` (${Math.min(100, v.occupancyPercentage)}%)`}</p>}
                          </div>
                          <div className="shrink-0 text-right text-xs">
                            {delayLabel ? <p className={delayClass}>{delayLabel}</p> : statusLabel ? <p className="text-slate-400">{statusLabel}</p> : <p className="text-slate-600">—</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Stop timeline — one direction at a time */}
          {!dir ? (
            <p className="text-sm text-slate-500">No stop data available.</p>
          ) : (
            <div className="relative pl-6">
              <div className="absolute bottom-2 left-[7px] top-2 w-0.5 rounded-full" style={{ backgroundColor: `${lineColor}55` }} />
              <div className="space-y-3">
                {(() => {
                  const stopIndexById = new Map(dir.stops.map((s, i) => [s.stop_id, i]));
                  return dir.stops.map((stop, idx) => {
                  const arrivals = arrivalsByStop[`${stop.stop_id}|${dir.directionId}`] ?? [];
                  const stopLabel = idx === 0 ? 'Departs' : 'Arrives';
                  const stopKey = `${stop.stop_id}|${dir.directionId}`;
                  const isSkipped = skippedStops.has(stopKey);
                  const scheduled = formatScheduledTime(stop.departure_time ?? stop.arrival_time);

                  const nowSec = now / 1000;
                  const isTerminal = idx === 0 || idx === dir.stops.length - 1;
                  const phase = isSkipped
                    ? null
                    : computeStopPhase(arrivals, nowSec, isTerminal);

                  const matched = phase?.current ? vehicleByTripId[phase.current.tripId] : undefined;
                  const vIdx = matched?.stopId != null ? stopIndexById.get(matched.stopId) : undefined;
                  const trainApproaching = matched != null && vIdx != null && vIdx < idx && matched.status === 'IN_TRANSIT_TO';
                  const trainHere = phase != null && (phase.label === 'Arrived' || phase.label === 'At Platform' || phase.label === 'Departing');

                  const dotClasses = isSkipped
                    ? 'border-red-500 bg-red-500/30'
                    : phase?.dotClass ?? 'border-slate-700 bg-slate-800';

                  let statusNode: React.ReactNode = null;
                  let timeMain: React.ReactNode;
                  let timeSub: string | null = null;

                  if (isSkipped) {
                    statusNode = <span className="text-xs font-semibold uppercase tracking-wide text-red-400">Skipping</span>;
                    timeMain = '—';
                  } else if (phase) {
                    statusNode = (
                      <span className={`text-xs font-semibold uppercase tracking-wide ${phase.labelClass} ${phase.animate === 'pulse' ? 'animate-pulse' : ''}`}>
                        {phase.label}
                      </span>
                    );
                    timeMain = (
                      <span className={`text-base font-bold ${phase.labelClass} ${phase.animate === 'bounce' ? 'animate-bounce' : phase.animate === 'pulse' ? 'animate-pulse' : ''}`}>
                        {phase.label}
                      </span>
                    );
                    timeSub = phase.sublabel ? `${phase.sublabel} · ${stopLabel}` : (scheduled ? stopLabel : null);
                  } else {
                    statusNode = <span className="text-xs text-slate-600">Scheduled</span>;
                    timeMain = <span className="text-base font-bold text-slate-500">{scheduled ?? '—'}</span>;
                    timeSub = scheduled ? stopLabel : null;
                  }

                  const expanded = selectedStop?.stopId === stop.stop_id;

                  return (
                    <div key={stop.stop_id} className={`relative ${isSkipped ? 'opacity-50' : ''}`}>
                      <span className={`absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 transition-colors duration-300 ${dotClasses}`} />
                      {trainApproaching && (
                        <button
                          type="button"
                          onClick={() => setSelectedVehicleStop((cur) => (cur === stopKey ? null : stopKey))}
                          title="Train approaching — tap for details"
                          className="absolute -left-[26px] -top-3 z-10 animate-bounce text-base leading-none"
                        >
                          {isBus ? '🚌' : '🚆'}
                        </button>
                      )}
                      {trainHere && !trainApproaching && (
                        <button
                          type="button"
                          onClick={() => setSelectedVehicleStop((cur) => (cur === stopKey ? null : stopKey))}
                          title="Train at this stop — tap for details"
                          className="absolute -left-[27px] top-0 z-10 animate-pulse text-lg leading-none"
                        >
                          {isBus ? '🚌' : '🚆'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedStop((cur) => (cur?.stopId === stop.stop_id ? null : { stopId: stop.stop_id, stopName: stop.stop_name }))}
                        className="flex w-full items-start justify-between gap-2 text-left"
                      >
                        <div className="min-w-0">
                          <span className={`truncate text-sm font-semibold ${expanded ? 'text-sky-300' : 'text-slate-100'}`}>{stop.stop_name}</span>
                          {transfersByStop[stop.stop_id]?.length > 0 && (
                            <span className="ml-2 text-xs font-semibold text-sky-400" title={`Connects to: ${transfersByStop[stop.stop_id].map((t) => t.routeLongName).join(', ')}`}>
                              ⇄ {transfersByStop[stop.stop_id].map((t) => t.routeShortName).join(', ')}
                            </span>
                          )}
                          <div>{statusNode}</div>
                          {phase && phase.upcoming.length > 0 && (
                            <p className="mt-0.5 text-xs text-slate-600">
                              then {phase.upcoming.slice(0, 2).map((a) => {
                                const d = a.time - nowSec;
                                return d > 60 ? `${Math.round(d / 60)} min` : d > 0 ? `${Math.ceil(d)}s` : 'soon';
                              }).join(', ')}
                            </p>
                          )}
                          {selectedVehicleStop === stopKey && matched && (
                            <p className="mt-1 rounded bg-slate-800/80 px-2 py-1 text-xs text-slate-300">
                              {isBus ? '🚌 Bus' : '🚆 Train'}
                              {trainApproaching ? ' approaching' : ' here'} · {formatDelay(matched.delaySeconds)}
                              {matched.occupancyStatus && ` · ${formatOccupancy(matched.occupancyStatus)}`}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {timeMain}
                          {timeSub && <p className="text-[10px] uppercase tracking-wide text-slate-600">{timeSub}</p>}
                        </div>
                      </button>

                      {expanded && (
                        <div className="mt-2 space-y-3 rounded-lg border border-sky-900/60 bg-slate-950 p-3">
                          {/* Scheduled time */}
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">Scheduled {stopLabel.toLowerCase()}</span>
                            <span className="font-semibold text-slate-200">{scheduled ?? '—'}</span>
                          </div>

                          {/* All upcoming arrivals for this route at this stop */}
                          {arrivals.length > 0 && (
                            <div className="border-t border-slate-800 pt-2">
                              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Upcoming on this line</p>
                              <div className="space-y-1">
                                {arrivals.slice(0, 4).map((a, ai) => {
                                  const d = a.time - nowSec;
                                  const isNow = d > -25 && d < 30;
                                  let countText: string;
                                  let countClass: string;
                                  if (d <= 0) { countText = 'Departed'; countClass = 'text-slate-500'; }
                                  else if (d <= 7) { countText = 'Arriving'; countClass = 'text-red-400 animate-pulse'; }
                                  else if (d <= 30) { countText = 'Arriving soon'; countClass = 'text-red-400 animate-pulse'; }
                                  else if (d <= 60) { countText = `:${String(Math.ceil(d)).padStart(2,'0')}`; countClass = 'text-red-400'; }
                                  else if (d <= 300) { countText = `${Math.ceil(d/60)} min`; countClass = 'text-yellow-400'; }
                                  else { countText = `${Math.round(d/60)} min`; countClass = 'text-sky-400'; }
                                  return (
                                    <div key={ai} className={`flex items-center justify-between text-xs ${isNow ? 'rounded bg-slate-800/60 px-1.5 py-0.5' : ''}`}>
                                      <span className="text-slate-400">{formatClockTime(a.time)}</span>
                                      <div className="flex items-center gap-2">
                                        {a.delaySeconds != null && Math.abs(a.delaySeconds) >= 60 && (
                                          <span className={a.delaySeconds > 0 ? 'text-yellow-500' : 'text-emerald-500'}>
                                            {a.delaySeconds > 0 ? '+' : ''}{Math.round(a.delaySeconds / 60)} min
                                          </span>
                                        )}
                                        <span className={`font-semibold ${countClass}`}>{countText}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Other routes at this stop */}
                          {(stopRoutes === null || stopRoutes.length > 0) && (
                            <div className="border-t border-slate-800 pt-2">
                              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Also stops here</p>
                              {stopRoutes === null ? (
                                <p className="text-xs text-slate-500">Loading…</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {stopRoutes.map((r) => {
                                    const liveArrivals = getArrivalsForStop(tripUpdates, selectedStop!.stopId).filter((a) => a.routeId === r.routeId);
                                    return (
                                      <div key={r.shortName} className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            selectLine(r.shortName);
                                            setSelectedStop(null);
                                          }}
                                          title={`Switch to ${r.longName}`}
                                          className="flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold text-slate-950 hover:opacity-80"
                                          style={{ backgroundColor: r.color ?? '#38bdf8' }}
                                        >
                                          {r.shortName}
                                        </button>
                                        <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{r.longName}</span>
                                        <span className="shrink-0 text-xs">
                                          {liveArrivals.length > 0 ? (
                                            <span className="text-sky-400">
                                              {liveArrivals.slice(0, 2).map((a) => {
                                                const d = a.time - nowSec;
                                                return d <= 60 ? `${Math.ceil(d)}s` : `${Math.round(d/60)} min`;
                                              }).join(', ')}
                                            </span>
                                          ) : (
                                            <span className="text-slate-600">no live data</span>
                                          )}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                  });
                })()}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-slate-600">
            Stop names and {isBus ? 'route' : 'station'} list come from RTD's weekly GTFS schedule export and may lag recent service changes.{' '}
            {isBus ? 'Bus' : 'Train'} positions and arrival predictions above are live.
          </p>
          </>
          )}
        </BottomSheet>
      )}

      {/* Directions overlay */}
      <div
        className={`absolute inset-0 z-[1300] flex flex-col bg-slate-950 transition-transform duration-300 ${
          activeOverlay === 'directions' ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 p-3">
          <button
            type="button"
            onClick={() => setActiveOverlay(null)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-slate-300 hover:bg-slate-800"
            title="Back"
          >
            ←
          </button>
          <h3 className="text-sm font-semibold text-slate-100">Directions</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <DirectionsPanel
            destination={destination}
            setDestination={setDestination}
            driveLoading={driveLoading}
            driveError={driveError}
            drivingRoute={drivingRoute}
            onGo={startDriving}
          />
          {drivingRoute && (
            <button type="button" onClick={clearDriving} className="mt-2 text-xs text-slate-500 hover:text-slate-300">
              ✕ clear directions
            </button>
          )}
        </div>
      </div>

      {/* Alerts overlay */}
      <div
        className={`absolute inset-0 z-[1300] flex flex-col bg-slate-950 transition-transform duration-300 ${
          activeOverlay === 'alerts' ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 p-3">
          <button
            type="button"
            onClick={() => {
              markAlertsSeen(activeAlerts);
              setActiveOverlay(null);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-slate-300 hover:bg-slate-800"
            title="Back"
          >
            ←
          </button>
          <h3 className="text-sm font-semibold text-slate-100">
            Alerts {activeAlerts.length > 0 && <span className="text-amber-400">({activeAlerts.length})</span>}
          </h3>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          <a
            href="https://www.rtd-denver.com/service-advisories"
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-sm text-emerald-300 hover:border-emerald-500"
          >
            🔗 View live service advisories on rtd-denver.com
          </a>
          {activeAlerts.length > 0 && (
            <>
              <input
                type="text"
                value={alertSearch}
                onChange={(e) => setAlertSearch(e.target.value)}
                placeholder={`Search ${activeAlerts.length} alerts (e.g. route number, station)…`}
                className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(ALERT_CATEGORY_LABELS) as AlertCategory[]).map((cat) => {
                  const count = activeAlerts.filter((a) => categorizeAlert(a) === cat).length;
                  if (count === 0) return null;
                  const isActive = alertCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setAlertCategory((c) => (c === cat ? null : cat))}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        isActive
                          ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                          : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500'
                      }`}
                    >
                      {ALERT_CATEGORY_LABELS[cat]} ({count})
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {activeAlerts.length === 0 && <p className="text-sm text-slate-500">No active service alerts.</p>}
          {(() => {
            const q = alertSearch.trim().toLowerCase();
            let filtered = activeAlerts;
            if (alertCategory) filtered = filtered.filter((a) => categorizeAlert(a) === alertCategory);
            if (q) filtered = filtered.filter((a) => `${a.header} ${a.description}`.toLowerCase().includes(q));
            if (activeAlerts.length > 0 && filtered.length === 0) {
              return <p className="text-sm text-slate-500">No alerts match this filter.</p>;
            }
            return filtered.map((alert) => {
              const routeLabel = parseRouteLabel(alert.header);
              const isNew = !seenAlertKeys.has(alertSeenKey(alert.id, alert.header));
              return (
              <div key={alert.id} className="rounded-xl border border-amber-600/40 bg-amber-500/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  {routeLabel && (
                    <button
                      type="button"
                      onClick={() => setAlertSearch(`Route ${routeLabel}`)}
                      className="mb-1 inline-block rounded-full border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300 hover:bg-amber-500/30"
                    >
                      Route {routeLabel}
                    </button>
                  )}
                  {isNew && (
                    <span className="ml-auto shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                      New
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-amber-300">
                  ⚠️ {alert.routeIds.length > 0 ? `[${alert.routeIds.join(', ')}] ` : ''}
                  {alert.header}
                  {alert.effect && (
                    <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                      {alert.effect.replace(/_/g, ' ')}
                    </span>
                  )}
                </p>
                {alert.description && <p className="mt-1 text-sm text-amber-200/80">{alert.description}</p>}
                {alert.url && (
                  <a
                    href={alert.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs font-medium text-amber-300 underline"
                  >
                    More details →
                  </a>
                )}
              </div>
              );
            });
          })()}
          {lastUpdated && <p className="text-xs text-slate-600">Last updated: {lastUpdated.toLocaleTimeString()}</p>}
        </div>
      </div>

      {/* Trip planner overlay */}
      <div
        className={`absolute inset-0 z-[1300] flex flex-col bg-slate-950 transition-transform duration-300 ${
          activeOverlay === 'plan' ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 p-3">
          <button
            type="button"
            onClick={() => setActiveOverlay(null)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-slate-300 hover:bg-slate-800"
            title="Back"
          >
            ←
          </button>
          <h3 className="text-sm font-semibold text-slate-100">Trip Planner</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {activeOverlay === 'plan' && (
            <Suspense fallback={<p className="text-sm text-slate-500">Loading planner…</p>}>
              <TripPlanner tripUpdates={tripUpdates} />
            </Suspense>
          )}
        </div>
      </div>

      {/* Settings overlay */}
      <div
        className={`absolute inset-0 z-[1300] flex flex-col bg-slate-950 transition-transform duration-300 ${
          activeOverlay === 'settings' ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 border-b border-slate-800 p-3">
          <button
            type="button"
            onClick={() => setActiveOverlay(null)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-slate-300 hover:bg-slate-800"
            title="Back"
          >
            ←
          </button>
          <h3 className="text-sm font-semibold text-slate-100">Settings</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-slate-400">
              Favorite stations, home/work addresses, and theme preferences will go here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
