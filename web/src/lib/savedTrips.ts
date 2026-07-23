const SAVED_TRIPS_KEY = 'nexus_saved_trips';

export interface SavedTrip {
  name: string;
  chain: string[];
  boardStopId: string;
  exitStopId: string;
}

export function loadSavedTrips(): SavedTrip[] {
  try {
    const raw = localStorage.getItem(SAVED_TRIPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistSavedTrips(trips: SavedTrip[]) {
  try {
    localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(trips));
  } catch {
    // localStorage unavailable (private mode) — presets just won't persist.
  }
}
