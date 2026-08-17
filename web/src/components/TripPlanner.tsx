import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  getRailLines,
  getRouteOverview,
  getRoutesServingStop,
  routeTypeLabel,
  searchStops,
  type RailLineOption,
  type RouteAtStop,
  type RouteOverview,
  type StopSearchResult,
} from '../lib/schedule';
import { planChain, type Itinerary, type ItineraryLeg } from '../lib/planner';
import { loadSavedTrips, persistSavedTrips, type SavedTrip } from '../lib/savedTrips';
import type { ParsedFeed } from '../lib/gtfsrt';

const ChainMap = lazy(() => import('./ChainMap'));
const ExpressLaneTolls = lazy(() => import('./ExpressLaneTolls'));

const TRANSFER_ESTIMATE_MINUTES = 5;

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Formats a scheduled GTFS time string "HH:MM:SS" → "9:15 AM". */
function formatGtfsTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const hour24 = h % 24;
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Returns the live-adjusted time string when delay is known, otherwise the scheduled string. */
function formatLiveTime(scheduledTime: string, delaySeconds: number | null): string {
  if (!delaySeconds) return formatGtfsTime(scheduledTime);
  const [h, m, s] = scheduledTime.split(':').map(Number);
  const baseMinutes = h * 60 + m + (s ?? 0) / 60 + delaySeconds / 60;
  const hour24 = Math.floor(baseMinutes / 60) % 24;
  const min = Math.round(baseMinutes % 60);
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(min).padStart(2, '0')} ${period}`;
}

/** How many minutes from now until a scheduled+delayed departure. */
function minutesUntil(gtfsTime: string, delaySeconds: number | null, nowMinutes: number): number {
  const [h, m] = gtfsTime.split(':').map(Number);
  const scheduled = (h % 24) * 60 + m;
  const live = scheduled + (delaySeconds ?? 0) / 60;
  return Math.round(live - nowMinutes);
}

function RouteBadge({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-slate-950"
      style={{ backgroundColor: color ?? '#38bdf8' }}
    >
      {name}
    </span>
  );
}

function LegCard({ leg, waitMinutes, nowMinutes }: { leg: ItineraryLeg; waitMinutes?: number; nowMinutes: number }) {
  const liveBoard = formatLiveTime(leg.boardTime, leg.delaySeconds);
  const liveAlight = formatLiveTime(leg.alightTime, leg.delaySeconds);
  const isLate = leg.delaySeconds != null && leg.delaySeconds >= 60;
  const isEarly = leg.delaySeconds != null && leg.delaySeconds <= -60;
  const until = minutesUntil(leg.boardTime, leg.delaySeconds, nowMinutes);
  const showCountdown = until >= 0 && until <= 60;

  return (
    <div>
      {waitMinutes != null && (
        <div className={`mb-1.5 ml-8 flex items-center gap-1.5 text-xs ${waitMinutes < 5 ? 'text-amber-400' : waitMinutes > 25 ? 'text-slate-500' : 'text-sky-400'}`}>
          <span>⏱</span>
          <span>
            {waitMinutes < 1 ? 'Immediate transfer' : `${Math.round(waitMinutes)} min transfer wait`}
          </span>
        </div>
      )}
      <div className="flex items-start gap-2.5">
        <RouteBadge name={leg.routeShortName} color={leg.routeColor} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-slate-100">
              {liveBoard}
              {isLate && <span className="ml-1 text-xs text-yellow-400">+{Math.round(leg.delaySeconds! / 60)} min late</span>}
              {isEarly && <span className="ml-1 text-xs text-emerald-400">{Math.round(-leg.delaySeconds! / 60)} min early</span>}
            </span>
            {showCountdown && (
              <span className={`text-xs font-medium ${until <= 3 ? 'text-red-400' : until <= 10 ? 'text-amber-400' : 'text-slate-400'}`}>
                {until === 0 ? 'Departing now' : `in ${until} min`}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Board <span className="text-slate-300">{leg.boardStopName}</span>
            {leg.headsign ? <span className="text-slate-500"> · toward {leg.headsign}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {routeTypeLabel(leg.routeType)} · ride to <span className="text-slate-400">{leg.alightStopName}</span> · arr {liveAlight}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "Not sure which route?" helper: search a stop, see which routes serve it, tap to add to the chain. */
function RouteFinder({ onPick }: { onPick: (shortName: string) => void }) {
  const [query, setQuery] = useState('');
  const [stops, setStops] = useState<StopSearchResult[]>([]);
  const [picked, setPicked] = useState<StopSearchResult | null>(null);
  const [routes, setRoutes] = useState<RouteAtStop[] | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setStops([]);
      return;
    }
    debounce.current = setTimeout(() => searchStops(query).then(setStops), 300);
    return () => clearTimeout(debounce.current);
  }, [query]);

  useEffect(() => {
    if (!picked) {
      setRoutes(null);
      return;
    }
    let cancelled = false;
    setRoutes(null);
    getRoutesServingStop(picked.stopId).then((r) => {
      if (!cancelled) setRoutes(r.routes);
    });
    return () => {
      cancelled = true;
    };
  }, [picked?.stopId]);

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-950 p-2 text-sm">
      <summary className="cursor-pointer text-slate-400">Not sure which route? Search a stop near you</summary>
      <div className="relative mt-2 space-y-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
          }}
          placeholder="Search stop name…"
          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
        />
        {!picked && stops.length > 0 && (
          <div className="absolute z-10 max-h-44 w-full overflow-y-auto rounded border border-slate-700 bg-slate-800 shadow-lg">
            {stops.map((s) => (
              <button
                key={s.stopId}
                type="button"
                onClick={() => {
                  setPicked(s);
                  setQuery(s.stopName);
                  setStops([]);
                }}
                className="block w-full truncate px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-700"
              >
                {s.stopName}
              </button>
            ))}
          </div>
        )}
        {picked && routes === null && <p className="text-xs text-slate-500">Loading routes…</p>}
        {picked && routes !== null && routes.length === 0 && (
          <p className="text-xs text-slate-500">No routes found at this stop.</p>
        )}
        {picked && routes && routes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {routes.map((r) => (
              <button
                key={r.routeId}
                type="button"
                onClick={() => onPick(r.shortName)}
                className="flex items-center gap-1.5 rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                title={r.longName}
              >
                <RouteBadge name={r.shortName} color={r.color} />
                <span>{r.longName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export default function TripPlanner({ tripUpdates }: { tripUpdates: ParsedFeed | null }) {
  const [allLines, setAllLines] = useState<RailLineOption[]>([]);
  const [chain, setChain] = useState<string[]>([]);
  const [showRoutePicker, setShowRoutePicker] = useState(false);
  const [routeQuery, setRouteQuery] = useState('');
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>(loadSavedTrips);
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  function persistTrips(next: SavedTrip[]) {
    setSavedTrips(next);
    persistSavedTrips(next);
  }

  function saveCurrentTrip() {
    const name = window.prompt('Name this trip (e.g. "Work", "Home"):', chain.join(' → '));
    if (!name) return;
    const trip: SavedTrip = { name: name.trim(), chain, boardStopId, exitStopId };
    persistTrips([...savedTrips.filter((t) => t.name !== trip.name), trip]);
  }

  function loadTrip(trip: SavedTrip) {
    pendingStops.current = { board: trip.boardStopId, exit: trip.exitStopId };
    setChain(trip.chain);
    setItineraries([]);
    setIssues([]);
    setState('idle');
  }

  const [firstOverview, setFirstOverview] = useState<RouteOverview | null>(null);
  const [lastOverview, setLastOverview] = useState<RouteOverview | null>(null);
  const [boardStopId, setBoardStopId] = useState('');
  const [exitStopId, setExitStopId] = useState('');

  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [fallbackRoutes, setFallbackRoutes] = useState<RouteOverview[]>([]);
  const [showingDayStart, setShowingDayStart] = useState(false);

  const [timeMode, setTimeMode] = useState<'now' | 'depart' | 'arrive'>('now');
  const [timeValue, setTimeValue] = useState('');

  function timeValueToMinutes(): number | null {
    const [h, m] = timeValue.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }

  useEffect(() => {
    getRailLines().then(setAllLines);
  }, []);

  const firstRoute = chain[0] ?? null;
  const lastRoute = chain[chain.length - 1] ?? null;

  const pendingStops = useRef<{ board?: string; exit?: string }>({});

  useEffect(() => {
    setBoardStopId(pendingStops.current.board ?? '');
    pendingStops.current.board = undefined;
    if (!firstRoute) {
      setFirstOverview(null);
      return;
    }
    let cancelled = false;
    setFirstOverview(null);
    getRouteOverview(firstRoute).then((o) => {
      if (!cancelled) setFirstOverview(o);
    });
    return () => {
      cancelled = true;
    };
  }, [firstRoute]);

  useEffect(() => {
    setExitStopId(pendingStops.current.exit ?? '');
    pendingStops.current.exit = undefined;
    if (!lastRoute) {
      setLastOverview(null);
      return;
    }
    if (lastRoute === firstRoute) return;
    let cancelled = false;
    setLastOverview(null);
    getRouteOverview(lastRoute).then((o) => {
      if (!cancelled) setLastOverview(o);
    });
    return () => {
      cancelled = true;
    };
  }, [lastRoute, firstRoute]);

  const exitOverview = lastRoute === firstRoute ? firstOverview : lastOverview;

  const q = routeQuery.trim().toLowerCase();
  const filteredForPicker = q.length > 0
    ? allLines.filter(
        (l) => !chain.includes(l.shortName) &&
          (l.shortName.toLowerCase().includes(q) || l.longName?.toLowerCase().includes(q)),
      )
    : allLines.filter((l) => !chain.includes(l.shortName));

  const pickerRail = filteredForPicker.filter((l) => l.routeType === 0 || l.routeType === 1 || l.routeType === 2);
  const pickerBus = filteredForPicker.filter((l) => l.routeType === 3).slice(0, 30);

  function addRoute(shortName: string) {
    setChain((prev) => (prev.includes(shortName) || prev.length >= 5 ? prev : [...prev, shortName]));
    setRouteQuery('');
    setShowRoutePicker(false);
  }

  async function plan() {
    if (chain.length === 0) return;
    setState('loading');
    setIssues([]);
    setFallbackRoutes([]);
    setShowingDayStart(false);
    try {
      const picked = timeValueToMinutes();
      const opts =
        timeMode === 'depart' && picked != null
          ? { startMinutes: picked }
          : timeMode === 'arrive' && picked != null
            ? { startMinutes: 0, arriveByMinutes: picked }
            : {};
      let result = await planChain(boardStopId || null, exitStopId || null, chain, tripUpdates, opts);

      if (result.itineraries.length === 0 && timeMode === 'now') {
        const dayStart = await planChain(boardStopId || null, exitStopId || null, chain, tripUpdates, {
          startMinutes: 0,
        });
        if (dayStart.itineraries.length > 0) {
          result = { itineraries: dayStart.itineraries, issues: result.issues };
          setShowingDayStart(true);
        }
      }

      setItineraries(result.itineraries);
      setIssues(result.issues);

      if (result.itineraries.length === 0) {
        const overviews = await Promise.all(chain.map((name) => getRouteOverview(name)));
        setFallbackRoutes(overviews.filter((o): o is RouteOverview => o !== null));
      }
      setState('done');
    } catch {
      setState('error');
    }
  }

  const fallbackEstimate =
    fallbackRoutes.length > 0 && fallbackRoutes.every((r) => r.durationMinutes != null)
      ? fallbackRoutes.reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0) +
        (fallbackRoutes.length - 1) * TRANSFER_ESTIMATE_MINUTES
      : null;

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div>
        <h3 className="text-lg font-semibold">Trip Planner</h3>
        <p className="text-xs text-slate-500">
          Pick your routes in order — bus, rail, or both (e.g. 120L then N). Transfers are found automatically
          wherever the routes come within a short walk.
        </p>
      </div>

      {/* Saved trips */}
      {savedTrips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {savedTrips.map((trip) => (
            <span key={trip.name} className="flex items-center gap-1 rounded-full bg-slate-800 py-0.5 pl-2 pr-1 text-xs">
              <button
                type="button"
                onClick={() => loadTrip(trip)}
                className="text-sky-300 hover:text-sky-200"
                title={trip.chain.join(' → ')}
              >
                ★ {trip.name}
              </button>
              <button
                type="button"
                onClick={() => persistTrips(savedTrips.filter((t) => t.name !== trip.name))}
                className="text-slate-500 hover:text-slate-300"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Step 1: route chain */}
      <div className="relative">
        <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">1 · Your routes, in order</label>
        <div className="flex flex-wrap items-center gap-1.5">
          {chain.map((name, i) => {
            const line = allLines.find((l) => l.shortName === name);
            return (
              <span key={name} className="flex items-center gap-1 rounded-full bg-slate-800 py-0.5 pl-1 pr-2 text-sm">
                <RouteBadge name={name} color={line?.color ?? null} />
                {i < chain.length - 1 && <span className="text-slate-500">→</span>}
                <button
                  type="button"
                  onClick={() => setChain((prev) => prev.filter((c) => c !== name))}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              </span>
            );
          })}
          {chain.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                pendingStops.current = { board: exitStopId, exit: boardStopId };
                setChain((prev) => [...prev].reverse());
                setItineraries([]);
                setIssues([]);
                setState('idle');
              }}
              className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-300"
              title="Reverse the trip — plan the ride home"
            >
              ⇄ Reverse
            </button>
          )}
          {chain.length >= 1 && (
            <button
              type="button"
              onClick={saveCurrentTrip}
              className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-300"
              title="Save this combo as a one-tap preset"
            >
              ☆ Save
            </button>
          )}
          {chain.length < 5 && (
            <button
              type="button"
              onClick={() => { setShowRoutePicker((v) => !v); setRouteQuery(''); }}
              className="rounded-full border border-slate-700 bg-slate-800 px-3 py-0.5 text-xs text-sky-300 hover:border-sky-500"
            >
              + Add route
            </button>
          )}
        </div>

        {/* Route picker panel */}
        {showRoutePicker && (
          <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
            <input
              type="text"
              value={routeQuery}
              onChange={(e) => setRouteQuery(e.target.value)}
              placeholder="Search by name or number…"
              autoFocus
              className="mb-3 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
            />

            {pickerRail.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Rail &amp; Light Rail</p>
                <div className="flex flex-wrap gap-2">
                  {pickerRail.map((l) => (
                    <button
                      key={l.shortName}
                      type="button"
                      onClick={() => addRoute(l.shortName)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:border-sky-500 hover:bg-slate-700"
                      title={l.longName ?? l.shortName}
                    >
                      <RouteBadge name={l.shortName} color={l.color} />
                      <span className="max-w-[120px] truncate">{l.longName ?? l.shortName}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pickerBus.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Bus</p>
                <div className="flex flex-wrap gap-2">
                  {pickerBus.map((l) => (
                    <button
                      key={l.shortName}
                      type="button"
                      onClick={() => addRoute(l.shortName)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:border-sky-500 hover:bg-slate-700"
                      title={l.longName ?? l.shortName}
                    >
                      <RouteBadge name={l.shortName} color={l.color} />
                      <span className="max-w-[120px] truncate">{l.longName ?? l.shortName}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pickerRail.length === 0 && pickerBus.length === 0 && (
              <p className="text-xs text-slate-500">No routes match "{routeQuery}"</p>
            )}
          </div>
        )}
      </div>

      <RouteFinder onPick={addRoute} />

      {/* Step 2: optional boarding/exit stops */}
      {chain.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
              2 · Board {firstRoute} at
            </label>
            <select
              value={boardStopId}
              onChange={(e) => setBoardStopId(e.target.value)}
              disabled={!firstOverview}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 disabled:opacity-50"
            >
              <option value="">{firstOverview ? 'Anywhere on the route' : 'Loading stops…'}</option>
              {firstOverview?.stops.map((s) => (
                <option key={s.stop_id} value={s.stop_id}>
                  {s.stop_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
              3 · Exit {lastRoute} at
            </label>
            <select
              value={exitStopId}
              onChange={(e) => setExitStopId(e.target.value)}
              disabled={!exitOverview}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200 disabled:opacity-50"
            >
              <option value="">{exitOverview ? 'End of the line' : 'Loading stops…'}</option>
              {exitOverview?.stops.map((s) => (
                <option key={s.stop_id} value={s.stop_id}>
                  {s.stop_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Step 3: when to travel */}
      {chain.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-500">4 · When</label>
          <div className="flex overflow-hidden rounded border border-slate-700 text-xs">
            {(
              [
                ['now', 'Leave now'],
                ['depart', 'Depart at'],
                ['arrive', 'Arrive by'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTimeMode(mode)}
                className={`px-2.5 py-1.5 ${timeMode === mode ? 'bg-sky-600 font-medium text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {timeMode !== 'now' && (
            <input
              type="time"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
            />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={plan}
        disabled={chain.length === 0 || state === 'loading' || (timeMode !== 'now' && timeValueToMinutes() == null)}
        className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
      >
        {state === 'loading'
          ? 'Planning…'
          : chain.length === 0
            ? 'Add a route to plan'
            : timeMode !== 'now' && timeValueToMinutes() == null
              ? 'Pick a time'
              : 'Plan trip'}
      </button>

      {state === 'error' && <p className="text-sm text-red-400">Something went wrong planning the trip.</p>}
      {issues.map((msg, i) => (
        <p key={i} className="text-sm text-amber-400">
          {msg}
        </p>
      ))}

      {showingDayStart && itineraries.length > 0 && (
        <p className="text-sm text-sky-400">
          No more departures today — showing the first trips of tomorrow's service day:
        </p>
      )}

      {itineraries.map((it, idx) => {
        const firstLeg = it.legs[0];
        const lastLeg = it.legs[it.legs.length - 1];
        // Effective total minutes accounting for any known delays on first/last leg.
        const effectiveDepart = (it.departMinutes) + (firstLeg.delaySeconds ?? 0) / 60;
        const effectiveArrive = (it.arriveMinutes) + (lastLeg.delaySeconds ?? 0) / 60;
        const effectiveTotal = Math.round(effectiveArrive - effectiveDepart);
        const hasLiveData = it.legs.some((l) => l.delaySeconds != null);

        return (
          <div key={idx} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            {/* Card header: depart → arrive + duration */}
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-100">
                  {formatLiveTime(firstLeg.boardTime, firstLeg.delaySeconds)}
                  <span className="mx-1.5 text-slate-500">→</span>
                  {formatLiveTime(lastLeg.alightTime, lastLeg.delaySeconds)}
                </p>
                <p className="text-xs text-slate-500">
                  {it.transfers === 0 ? 'Direct' : `${it.transfers} transfer${it.transfers > 1 ? 's' : ''}`}
                  {hasLiveData ? ` · ${formatDuration(effectiveTotal)} (live)` : ` · ${formatDuration(it.totalMinutes)} scheduled`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {it.legs.map((l, j) => (
                  <RouteBadge key={j} name={l.routeShortName} color={l.routeColor} />
                ))}
              </div>
            </div>

            {/* Leg detail */}
            <div className="space-y-3">
              {it.legs.map((leg, j) => (
                <LegCard
                  key={j}
                  leg={leg}
                  waitMinutes={j > 0 && it.transferWaits?.[j - 1] != null ? it.transferWaits[j - 1] : undefined}
                  nowMinutes={nowMinutes}
                />
              ))}
            </div>

            {/* Live delay warnings */}
            {(it.warnings ?? []).map((w, j) => (
              <p key={j} className="mt-2 flex items-start gap-1 text-xs text-red-400">
                <span>⚠</span>
                <span>{w}</span>
              </p>
            ))}
          </div>
        );
      })}

      {/* Fallback: no scheduled itinerary — show routes on map */}
      {state === 'done' && itineraries.length === 0 && fallbackRoutes.length > 0 && (
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-300">Route overview</span>
            {fallbackEstimate != null && (
              <span className="text-slate-400">
                est. ~{formatDuration(fallbackEstimate)} end-to-end{fallbackRoutes.length > 1 ? ' incl. transfers' : ''}
              </span>
            )}
          </div>
          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-sm text-slate-500">
                Loading map…
              </div>
            }
          >
            <ChainMap routes={fallbackRoutes} />
          </Suspense>
          <p className="text-xs text-slate-500">
            No scheduled departures matched for today. Here's both routes on the map — where the lines come close is
            your transfer point. The estimate uses each route's typical end-to-end time.
          </p>
        </div>
      )}

      <p className="text-[10px] text-slate-600">
        Times from RTD's schedule for today's service. Live delay shown when a matching vehicle is reporting.
        Transfers connect stops within {' '} a 400m walk.
      </p>

      {/* Driving alternative: I-25 Central Express Lane toll estimator */}
      <details className="rounded-lg border border-slate-800 bg-slate-950">
        <summary className="cursor-pointer px-3 py-2 text-sm text-slate-400 hover:text-slate-300">
          🛣️ Driving instead? I-25 Central Express Lane tolls (Downtown ↔ US-36)
        </summary>
        <div className="p-3 pt-0">
          <Suspense fallback={<p className="text-xs text-slate-500">Loading toll schedule…</p>}>
            <ExpressLaneTolls />
          </Suspense>
        </div>
      </details>
    </div>
  );
}
