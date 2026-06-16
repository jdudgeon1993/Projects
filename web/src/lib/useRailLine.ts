import { useEffect, useMemo, useState } from 'react';
import { useGtfsRt } from './useGtfsRt';
import { getSkippedStops, getTripDelay, getUpcomingArrivalsByStop, type UpcomingArrival } from './gtfsrt';
import { getFrequencyMinutes, getRouteFare, getRouteId, getScheduledDurationMinutes, getShapePoints, getStopsForRoute, getTransfersForStops, isRouteServiceToday, type RailStop, type RouteFare, type ShapePoint, type StopTransfer, type TripAccessibility } from './schedule';

export interface LiveVehicle {
  id: string;
  lat?: number;
  lon?: number;
  bearing?: number;
  status?: string;
  tripId?: string;
  directionId?: number;
  stopId?: string;
  delaySeconds: number | null;
  occupancyStatus?: string;
  occupancyPercentage?: number;
  feedTimestamp?: number; // unix seconds when this vehicle fix was recorded
}

export interface DirectionInfo {
  directionId: number;
  headsign: string;
  stops: RailStop[];
  scheduledDurationMinutes: number | null;
  shape: ShapePoint[];
  accessibility: TripAccessibility;
  frequencyMinutes: number | null;
}

export function useRailLine(shortName: string | null) {
  const { tripUpdates, vehiclePositions, alerts, lastUpdated, error, loading } = useGtfsRt();
  const [routeId, setRouteId] = useState<string | null>(null);
  const [routeType, setRouteType] = useState<number | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [directions, setDirections] = useState<DirectionInfo[]>([]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [fare, setFare] = useState<RouteFare | null>(null);
  const [transfersByStop, setTransfersByStop] = useState<Record<string, StopTransfer[]>>({});
  const [serviceToday, setServiceToday] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (shortName == null) {
      setRouteId(null);
      setRouteType(null);
      setColor(null);
      setDirections([]);
      setFare(null);
      setTransfersByStop({});
      setServiceToday(null);
      setScheduleError(null);
      setScheduleLoading(false);
      return;
    }

    (async () => {
      try {
        setScheduleLoading(true);
        setScheduleError(null);
        setDirections([]);
        setFare(null);
        setTransfersByStop({});
        setServiceToday(null);
        const route = await getRouteId(shortName);
        const rid = route?.routeId ?? shortName;
        if (cancelled) return;
        setRouteId(rid);
        setRouteType(route?.routeType ?? null);
        setColor(route?.color ?? null);

        const [dir0, dir1] = await Promise.all([getStopsForRoute(rid, 0), getStopsForRoute(rid, 1)]);
        if (cancelled) return;

        const [shape0, shape1, freq0, freq1, routeFare] = await Promise.all([
          dir0.shapeId ? getShapePoints(dir0.shapeId) : Promise.resolve([]),
          dir1.shapeId ? getShapePoints(dir1.shapeId) : Promise.resolve([]),
          dir0.tripId ? getFrequencyMinutes(dir0.tripId) : Promise.resolve(null),
          dir1.tripId ? getFrequencyMinutes(dir1.tripId) : Promise.resolve(null),
          getRouteFare(rid),
        ]);
        if (cancelled) return;

        setFare(routeFare);

        const dirs: DirectionInfo[] = [];
        if (dir0.stops.length > 0) {
          dirs.push({
            directionId: 0,
            headsign: dir0.stops[dir0.stops.length - 1].stop_name,
            stops: dir0.stops,
            scheduledDurationMinutes: getScheduledDurationMinutes(dir0.stops),
            shape: shape0,
            accessibility: dir0.accessibility,
            frequencyMinutes: freq0,
          });
        }
        if (dir1.stops.length > 0) {
          dirs.push({
            directionId: 1,
            headsign: dir1.stops[dir1.stops.length - 1].stop_name,
            stops: dir1.stops,
            scheduledDurationMinutes: getScheduledDurationMinutes(dir1.stops),
            shape: shape1,
            accessibility: dir1.accessibility,
            frequencyMinutes: freq1,
          });
        }
        setDirections(dirs);

        const allStopIds = [...new Set(dirs.flatMap((d) => d.stops.map((s) => s.stop_id)))];
        getTransfersForStops(allStopIds, shortName).then((t) => {
          if (!cancelled) setTransfersByStop(t);
        });
        isRouteServiceToday(rid).then((s) => {
          if (!cancelled) setServiceToday(s);
        });
      } catch (e) {
        if (!cancelled) setScheduleError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shortName]);

  const effectiveRouteId = routeId ?? shortName;

  const vehicles: LiveVehicle[] = useMemo(() => {
    // Don't show vehicles until the real routeId is resolved — shortName may not
    // match the internal route_id in the feed and would silently show nothing or
    // accidentally match a different route.
    if (!routeId) return [];
    return (vehiclePositions?.entity ?? [])
      .filter((e: any) => e.vehicle?.trip?.routeId === routeId)
      .map((e: any) => {
        const v = e.vehicle;
        const { delaySeconds } = getTripDelay(tripUpdates, {
          trip_id: v.trip?.tripId,
          route_id: v.trip?.routeId,
          direction_id: v.trip?.directionId != null ? Number(v.trip.directionId) : undefined,
          // TripDescriptor.start_time is stable across mid-day trip_id rotations.
          start_time: v.trip?.startTime,
        });

        return {
          id: e.id,
          lat: v.position?.latitude,
          lon: v.position?.longitude,
          bearing: v.position?.bearing,
          status: v.currentStatus,
          tripId: v.trip?.tripId,
          directionId: v.trip?.directionId != null ? Number(v.trip.directionId) : undefined,
          stopId: v.stopId,
          delaySeconds,
          occupancyStatus: v.occupancyStatus && v.occupancyStatus !== 'NO_DATA_AVAILABLE' ? v.occupancyStatus : undefined,
          occupancyPercentage: v.occupancyPercentage,
          feedTimestamp: v.timestamp != null ? Number(v.timestamp) : undefined,
        };
      });
  }, [vehiclePositions, tripUpdates, routeId]);

  const arrivalsByStop: Record<string, UpcomingArrival[]> = useMemo(
    () => getUpcomingArrivalsByStop(tripUpdates, effectiveRouteId ?? ''),
    [tripUpdates, effectiveRouteId]
  );
  const skippedStops: Set<string> = useMemo(
    () => getSkippedStops(tripUpdates, effectiveRouteId ?? ''),
    [tripUpdates, effectiveRouteId]
  );

  const vehicleByTripId: Record<string, LiveVehicle> = useMemo(() => {
    const map: Record<string, LiveVehicle> = {};
    for (const v of vehicles) {
      if (v.tripId) map[v.tripId] = v;
    }
    return map;
  }, [vehicles]);

  return {
    routeId,
    routeType,
    color,
    fare,
    transfersByStop,
    serviceToday,
    directions,
    arrivalsByStop,
    skippedStops,
    vehicleByTripId,
    vehicles,
    tripUpdates,
    vehiclePositions,
    alerts,
    lastUpdated,
    loading: loading || scheduleLoading,
    error: error || scheduleError,
  };
}
