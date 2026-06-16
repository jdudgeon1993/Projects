import { useEffect, useRef, useState } from 'react';
import { fetchGtfsRt } from './api';
import { decodeFeed, type ParsedFeed } from './gtfsrt';

export interface GtfsRtState {
  tripUpdates: ParsedFeed | null;
  vehiclePositions: ParsedFeed | null;
  alerts: ParsedFeed | null;
  lastUpdated: Date | null;
  error: string | null;
  loading: boolean;
}

const POLL_INTERVAL_MS = 30_000;

export function useGtfsRt(): GtfsRtState {
  const [state, setState] = useState<GtfsRtState>({
    tripUpdates: null,
    vehiclePositions: null,
    alerts: null,
    lastUpdated: null,
    error: null,
    loading: true,
  });
  const mounted = useRef(true);

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

      setState((prev) => ({
        tripUpdates: tu.status === 'fulfilled' ? tu.value : prev.tripUpdates,
        vehiclePositions: vp.status === 'fulfilled' ? vp.value : prev.vehiclePositions,
        alerts: al.status === 'fulfilled' ? al.value : prev.alerts,
        lastUpdated: anySuccess ? new Date() : prev.lastUpdated,
        error: errors.length > 0 ? errors.join('; ') : null,
        loading: false,
      }));
    }

    // Attempt a quick retry on initial failure before the regular 30 s cycle kicks in.
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
  }, []);

  return state;
}
