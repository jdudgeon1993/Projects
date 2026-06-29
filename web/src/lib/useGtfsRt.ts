import { useEffect, useRef, useState } from 'react';
import { fetchGtfsRt } from './api';
import { decodeFeed, type ParsedFeed } from './gtfsrt';

export interface GtfsRtState {
  tripUpdates: ParsedFeed | null;
  vehiclePositions: ParsedFeed | null;
  alerts: ParsedFeed | null;
  // Per-vehicle: how many consecutive polls the GPS fix has been identical
  vehicleStuckPolls: Map<string, number>;
  lastUpdated: Date | null;
  error: string | null;
  loading: boolean;
}

const POLL_INTERVAL_MS = 30_000;

interface VehicleSnapshot {
  lat: number;
  lon: number;
  fixTimestamp: number; // VehiclePosition.timestamp (unix s)
}

export function useGtfsRt(): GtfsRtState {
  const [state, setState] = useState<GtfsRtState>({
    tripUpdates: null,
    vehiclePositions: null,
    alerts: null,
    vehicleStuckPolls: new Map(),
    lastUpdated: null,
    error: null,
    loading: true,
  });
  const mounted = useRef(true);
  // Last known GPS snapshot per vehicle id, used to detect position stability
  const posCache = useRef<Map<string, VehicleSnapshot>>(new Map());

  useEffect(() => {
    mounted.current = true;

    async function poll() {
      const labels = ['TripUpdate', 'VehiclePosition', 'Alerts'] as const;
      const results = await Promise.allSettled(
        labels.map((feed) => fetchGtfsRt(feed).then(decodeFeed)),
      );
      if (!mounted.current) return;

      const [tu, vp, al] = results;
      const errors = results
        .map((r, i) => (r.status === 'rejected' ? `${labels[i]}: ${r.reason?.message ?? r.reason}` : null))
        .filter(Boolean);
      const anySuccess = results.some((r) => r.status === 'fulfilled');

      // Build stuck-poll counts from position stability
      const stuckPolls = new Map<string, number>(
        // carry forward existing counts so they accumulate across polls
        state.vehicleStuckPolls,
      );
      if (vp.status === 'fulfilled') {
        const seenIds = new Set<string>();
        for (const entity of vp.value?.entity ?? []) {
          const v = entity.vehicle;
          if (!v) continue;
          const id: string = entity.id;
          const lat: number | undefined = v.position?.latitude;
          const lon: number | undefined = v.position?.longitude;
          const fix: number | undefined = v.timestamp != null ? Number(v.timestamp) : undefined;
          seenIds.add(id);
          if (lat == null || lon == null || fix == null) { stuckPolls.delete(id); continue; }
          const prev = posCache.current.get(id);
          if (prev && prev.fixTimestamp === fix) {
            // GPS fix timestamp hasn't advanced — position unchanged
            stuckPolls.set(id, (stuckPolls.get(id) ?? 0) + 1);
          } else {
            // New fix — vehicle moved or fix refreshed
            stuckPolls.set(id, 0);
            posCache.current.set(id, { lat, lon, fixTimestamp: fix });
          }
        }
        // Remove vehicles no longer in feed
        for (const id of stuckPolls.keys()) {
          if (!seenIds.has(id)) stuckPolls.delete(id);
        }
      }

      setState((prev) => ({
        tripUpdates: tu.status === 'fulfilled' ? tu.value : prev.tripUpdates,
        vehiclePositions: vp.status === 'fulfilled' ? vp.value : prev.vehiclePositions,
        alerts: al.status === 'fulfilled' ? al.value : prev.alerts,
        vehicleStuckPolls: new Map(stuckPolls),
        lastUpdated: anySuccess ? new Date() : prev.lastUpdated,
        error: errors.length > 0 ? errors.join('; ') : null,
        loading: false,
      }));
    }

    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    poll().catch(() => {
      if (mounted.current) retryTimeout = setTimeout(poll, 5_000);
    });
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
