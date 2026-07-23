const SEEN_ALERTS_KEY = 'nexus_seen_alerts';

/** Seen-key: alert id + header, so an edited/updated alert counts as "new" again. */
export function alertSeenKey(id: string, header: string): string {
  return `${id}|${header}`;
}

export function loadSeenAlerts(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_ALERTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function persistSeenAlerts(keys: Set<string>) {
  localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify([...keys]));
}
