'use strict';

const express = require('express');
const path = require('path');
const webpush = require('web-push');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ---------------------------------------------------------------------------
// Web Push / Supabase configuration
// ---------------------------------------------------------------------------
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const GTFS_RT_FEEDS = {
  TripUpdate: 'https://www.rtd-denver.com/files/gtfs-rt/TripUpdate.pb',
  VehiclePosition: 'https://www.rtd-denver.com/files/gtfs-rt/VehiclePosition.pb',
  Alerts: 'https://www.rtd-denver.com/files/gtfs-rt/Alerts.pb',
};

// ---------------------------------------------------------------------------
// GTFS-RT proxy (replaces the old "hyper-api" Supabase edge function)
// ---------------------------------------------------------------------------
app.get('/api/gtfs-rt', async (req, res) => {
  const feedType = req.query.feed || 'TripUpdate';
  const feedUrl = GTFS_RT_FEEDS[feedType];

  if (!feedUrl) {
    return res.status(400).json({ error: 'Invalid feed type. Use: TripUpdate, VehiclePosition, or Alerts' });
  }

  try {
    const response = await fetch(feedUrl, { headers: { 'User-Agent': 'RTD-Transit-App/1.0' } });
    if (!response.ok) {
      throw new Error(`RTD feed returned ${response.status}: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=15');
    res.send(buffer);
  } catch (error) {
    console.error('GTFS-RT proxy error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch GTFS-RT feed' });
  }
});

// ---------------------------------------------------------------------------
// Weather (Open-Meteo, no API key required)
// ---------------------------------------------------------------------------
const WEATHER_CODE_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

app.post('/api/weather', async (req, res) => {
  try {
    // Denver, CO
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=39.7392&longitude=-104.9903&current=temperature_2m,weather_code&temperature_unit=fahrenheit';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Weather API returned ${response.status}`);
    const data = await response.json();
    const code = data.current?.weather_code;
    res.json({
      temp: Math.round(data.current?.temperature_2m),
      icon: WEATHER_CODE_ICONS[code] || '🌡️',
    });
  } catch (error) {
    console.error('Weather error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch weather' });
  }
});

// ---------------------------------------------------------------------------
// Helpers: geocode an address using the Geocoding API
// ---------------------------------------------------------------------------
async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Could not geocode "${address}" (${data.status})`);
  }
  return data.results[0].geometry.location; // { lat, lng }
}

// ---------------------------------------------------------------------------
// Search Nearby Transit (Places API New, replaces search-nearby-transit)
// ---------------------------------------------------------------------------
app.post('/api/search-nearby-transit', async (req, res) => {
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured on the server' });
  }

  const { location, radius = 0.5 } = req.body || {};
  if (!location) {
    return res.status(400).json({ error: 'location is required' });
  }

  try {
    const { lat, lng } = await geocode(location);
    const radiusMeters = Math.min(Math.max(radius * 1609.34, 1), 50000);

    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.id',
      },
      body: JSON.stringify({
        includedTypes: ['bus_station', 'bus_stop'],
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters,
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Places API returned ${response.status}`);
    }

    const stops = (data.places || []).map((place) => {
      const distanceMiles = haversineMiles(lat, lng, place.location.latitude, place.location.longitude);
      return {
        name: place.displayName?.text || 'Bus Stop',
        address: place.formattedAddress,
        distance: distanceMiles.toFixed(2),
        rating: place.rating,
        place_id: place.id,
      };
    }).sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

    res.json({ stops });
  } catch (error) {
    console.error('search-nearby-transit error:', error);
    res.status(500).json({ error: error.message || 'Failed to search nearby transit' });
  }
});

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Calculate Drive Time (Routes API, replaces calculate-drive-time)
// ---------------------------------------------------------------------------
async function computeDriveTime(originAddress, destinationAddress, avoidHighways) {
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration',
    },
    body: JSON.stringify({
      origin: { address: originAddress },
      destination: { address: destinationAddress },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      routeModifiers: { avoidHighways: !!avoidHighways },
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.routes?.length) {
    throw new Error(data.error?.message || 'No route found');
  }

  const route = data.routes[0];
  const liveSeconds = parseInt(route.duration, 10); // e.g. "1234s"
  const staticSeconds = parseInt(route.staticDuration, 10);
  const minutes = Math.round(liveSeconds / 60);
  const trafficPercent = staticSeconds > 0
    ? Math.round(((liveSeconds - staticSeconds) / staticSeconds) * 100)
    : 0;

  return { minutes, trafficPercent: Math.max(trafficPercent, 0), status: 'ok' };
}

// ---------------------------------------------------------------------------
// Driving directions (polyline + ETA) for the map overlay
// ---------------------------------------------------------------------------
app.post('/api/driving-route', async (req, res) => {
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured on the server' });
  }

  const { origin, destination } = req.body || {};
  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination are required' });
  }

  const toWaypoint = (p) =>
    typeof p === 'string' ? { address: p } : { location: { latLng: { latitude: p.lat, longitude: p.lng } } };

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.routes?.length) {
      throw new Error(data.error?.message || 'No route found');
    }

    const route = data.routes[0];
    const liveSeconds = parseInt(route.duration, 10);
    const staticSeconds = parseInt(route.staticDuration, 10);
    const trafficPercent = staticSeconds > 0
      ? Math.max(Math.round(((liveSeconds - staticSeconds) / staticSeconds) * 100), 0)
      : 0;

    res.json({
      minutes: Math.round(liveSeconds / 60),
      distanceMeters: route.distanceMeters,
      trafficPercent,
      polyline: route.polyline?.encodedPolyline ?? null,
    });
  } catch (error) {
    console.error('driving-route error:', error);
    res.status(500).json({ error: error.message || 'Failed to get driving route' });
  }
});

app.post('/api/calculate-drive-time', async (req, res) => {
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured on the server' });
  }

  const { home, work, avoidHighways = false } = req.body || {};
  if (!home || !work) {
    return res.status(400).json({ error: 'home and work are required' });
  }

  try {
    const [homeToWork, workToHome] = await Promise.all([
      computeDriveTime(home, work, avoidHighways),
      computeDriveTime(work, home, avoidHighways),
    ]);
    res.json({ homeToWork, workToHome });
  } catch (error) {
    console.error('calculate-drive-time error:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate drive time' });
  }
});

// ---------------------------------------------------------------------------
// Supabase REST helpers (no SDK — avoids adding @supabase/supabase-js to server)
// ---------------------------------------------------------------------------
async function supabaseRequest(method, path, body) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env vars not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getAllSubscriptions() {
  return supabaseRequest('GET', 'push_subscriptions?select=endpoint,p256dh,auth,route_short_names', undefined);
}

// ---------------------------------------------------------------------------
// Push subscription endpoints
// ---------------------------------------------------------------------------

// POST /api/push/subscribe — upsert subscription + routes
// DELETE /api/push/subscribe — remove subscription
app.post('/api/push/subscribe', async (req, res) => {
  const { endpoint, p256dh, auth, routeShortNames } = req.body || {};
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'endpoint, p256dh, and auth are required' });
  }
  try {
    await supabaseRequest('POST', 'push_subscriptions', {
      endpoint,
      p256dh,
      auth,
      route_short_names: routeShortNames ?? [],
      updated_at: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('push/subscribe error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/push/subscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  try {
    await supabaseRequest('DELETE', `push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, undefined);
    res.json({ ok: true });
  } catch (e) {
    console.error('push/unsubscribe error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/push/vapid-key — hand the public key to the frontend
app.get('/api/push/vapid-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ---------------------------------------------------------------------------
// Alert parsing (server-side subset of gtfsrt.ts logic)
// ---------------------------------------------------------------------------
function parseRouteShortNamesFromHeader(header) {
  const names = [];
  const busMatch = header.match(/^Route\s+([A-Z0-9]+)/i);
  if (busMatch) names.push(busMatch[1].toUpperCase());
  const railRe = /\b([A-Z][A-Z0-9]*)\s+Line\b/gi;
  let m;
  while ((m = railRe.exec(header)) !== null) names.push(m[1].toUpperCase());
  return [...new Set(names)];
}

function buildNotificationContent(header, routeNames) {
  // Subject: "A Line Alert" | "A, B, G Line Alert"
  const subject = routeNames.length === 1
    ? `${routeNames[0]} Line Alert`
    : `${routeNames.join(', ')} Line Alert`;

  // Body: strip leading route/line name(s) from the header
  let body = header;
  const patterns = routeNames.map((n) => `${n}\\s+Line`).join('|');
  const stripRe = new RegExp(`^((?:(?:${patterns})(?:,\\s*|\\s+and\\s+)*)*)`, 'i');
  body = body.replace(stripRe, '').trim().replace(/^[,\\-–—]+\\s*/, '').trim();
  if (!body) body = header;

  return { subject, body };
}

// ---------------------------------------------------------------------------
// Server-side alert poller — sends push notifications for new alerts
// ---------------------------------------------------------------------------
const GTFS_ALERTS_URL = 'https://www.rtd-denver.com/files/gtfs-rt/Alerts.pb';
const ALERT_POLL_MS = 5 * 60 * 1000; // 5 minutes

let seenAlertKeys = new Set(); // "routeId:alertId" pairs we've already notified
let pushPollerReady = false;

async function fetchAlertHeaders() {
  // We need to decode protobuf alerts. We do this by proxying through our own
  // existing /api/gtfs-rt endpoint to get raw bytes, then decode with protobuf.
  // However, protobufjs is a frontend dependency. Instead, hit the RTD feed
  // directly and use our own GTFS-RT proxy endpoint internally.
  // Simplest: call our own proxy at localhost so we don't need protobufjs here.
  const url = `http://localhost:${PORT}/api/gtfs-rt?feed=Alerts`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alert proxy ${res.status}`);
  return res.arrayBuffer();
}

async function decodeAlertsWithProxy() {
  // We can't easily use protobufjs in CommonJS server without bundling it.
  // Workaround: fetch the JSON-decoded version by calling our own protobuf proxy
  // and decoding in the same way we do in the browser.
  // Since we can't import ESM protobufjs here, we'll do a minimal binary parse
  // of the GTFS-RT alerts protobuf just for alert id + header text.
  const buf = Buffer.from(await fetchAlertHeaders());
  return parseGtfsRtAlerts(buf);
}

// Minimal GTFS-RT protobuf parser — enough to extract alert id and header text.
// GTFS-RT FeedMessage structure (all wire-type 2 = length-delimited):
//   field 1 = FeedHeader, field 2[] = FeedEntity
//   FeedEntity: field 1 = id (string), field 5 = Alert
//   Alert: field 10 = effect (varint), field 2[] = TranslatedString header_text
//   TranslatedString: field 1[] = Translation
//   Translation: field 1 = text (string)
function parseGtfsRtAlerts(buf) {
  const alerts = [];
  let pos = 0;

  function readVarint() {
    let result = 0, shift = 0;
    while (pos < buf.length) {
      const byte = buf[pos++];
      result |= (byte & 0x7f) << shift;
      shift += 7;
      if (!(byte & 0x80)) break;
    }
    return result;
  }

  function readLength() {
    const len = readVarint();
    const start = pos;
    pos += len;
    return buf.slice(start, pos);
  }

  function readString(b) {
    return b.toString('utf8');
  }

  function parseTranslation(b) {
    let p = 0, text = '';
    while (p < b.length) {
      const tag = b[p++]; // simplified: only handle low field numbers
      const fieldNum = tag >> 3;
      const wireType = tag & 0x7;
      if (wireType === 2) {
        let len = 0, shift = 0;
        while (p < b.length) { const byte = b[p++]; len |= (byte & 0x7f) << shift; shift += 7; if (!(byte & 0x80)) break; }
        const data = b.slice(p, p + len); p += len;
        if (fieldNum === 1) text = data.toString('utf8');
      } else if (wireType === 0) {
        while (p < b.length && (b[p++] & 0x80)); // skip varint
      } else { break; }
    }
    return text;
  }

  function parseTranslatedString(b) {
    let p = 0, text = '';
    while (p < b.length) {
      const tag = b[p++];
      const fieldNum = tag >> 3;
      const wireType = tag & 0x7;
      if (wireType === 2) {
        let len = 0, shift = 0;
        while (p < b.length) { const byte = b[p++]; len |= (byte & 0x7f) << shift; shift += 7; if (!(byte & 0x80)) break; }
        const data = b.slice(p, p + len); p += len;
        if (fieldNum === 1) text = parseTranslation(data); // first translation wins
      } else if (wireType === 0) {
        while (p < b.length && (b[p++] & 0x80));
      } else { break; }
    }
    return text;
  }

  function parseAlert(b) {
    let p = 0, headerText = '';
    while (p < b.length) {
      const tag = b[p++];
      const fieldNum = tag >> 3;
      const wireType = tag & 0x7;
      if (wireType === 2) {
        let len = 0, shift = 0;
        while (p < b.length) { const byte = b[p++]; len |= (byte & 0x7f) << shift; shift += 7; if (!(byte & 0x80)) break; }
        const data = b.slice(p, p + len); p += len;
        if (fieldNum === 5) headerText = parseTranslatedString(data); // header_text = field 5
      } else if (wireType === 0) {
        while (p < b.length && (b[p++] & 0x80));
      } else { break; }
    }
    return headerText;
  }

  function parseEntity(b) {
    let p = 0, id = '', alertText = '';
    while (p < b.length) {
      const tag = b[p++];
      const fieldNum = tag >> 3;
      const wireType = tag & 0x7;
      if (wireType === 2) {
        let len = 0, shift = 0;
        while (p < b.length) { const byte = b[p++]; len |= (byte & 0x7f) << shift; shift += 7; if (!(byte & 0x80)) break; }
        const data = b.slice(p, p + len); p += len;
        if (fieldNum === 1) id = data.toString('utf8'); // entity id
        else if (fieldNum === 5) alertText = parseAlert(data); // alert = field 5
      } else if (wireType === 0) {
        while (p < b.length && (b[p++] & 0x80));
      } else { break; }
    }
    return { id, header: alertText };
  }

  // Parse FeedMessage top-level entities (field 2)
  while (pos < buf.length) {
    const tag = readVarint();
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;
    if (wireType === 2) {
      const data = readLength();
      if (fieldNum === 2) { // FeedEntity
        const entity = parseEntity(data);
        if (entity.header) alerts.push(entity);
      }
    } else if (wireType === 0) {
      readVarint(); // skip
    } else {
      break; // unknown wire type — stop
    }
  }

  return alerts;
}

async function sendPushToSubscribers(subscriptions, title, body) {
  const payload = JSON.stringify({ title, body, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png' });
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  );
  // Remove expired/invalid subscriptions from Supabase
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected' && r.reason?.statusCode === 410) {
      // 410 Gone — subscription expired
      supabaseRequest('DELETE', `push_subscriptions?endpoint=eq.${encodeURIComponent(subscriptions[i].endpoint)}`, undefined)
        .catch(() => {});
    }
  }
}

async function pollAndNotify() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const alerts = await decodeAlertsWithProxy();
    const subscriptions = await getAllSubscriptions();
    if (!subscriptions?.length) return;

    for (const alert of alerts) {
      if (!alert.header) continue;
      const routeNames = parseRouteShortNamesFromHeader(alert.header);
      if (!routeNames.length) continue;

      for (const routeName of routeNames) {
        const key = `${routeName}:${alert.id}`;
        if (seenAlertKeys.has(key)) continue;
        seenAlertKeys.add(key);

        // Find subscribers who have this route favorited
        const targets = subscriptions.filter(
          (s) => s.route_short_names && s.route_short_names.includes(routeName)
        );
        if (!targets.length) continue;

        const { subject, body } = buildNotificationContent(alert.header, [routeName]);
        console.log(`[push] Notifying ${targets.length} device(s): "${subject}"`);
        await sendPushToSubscribers(targets, subject, body);
      }
    }
  } catch (e) {
    console.error('[push] pollAndNotify error:', e);
  }
}

function startPushPoller() {
  if (pushPollerReady) return;
  pushPollerReady = true;
  // Initial delay: 30 s after boot (allow server to fully start + subscribe)
  setTimeout(() => {
    pollAndNotify();
    setInterval(pollAndNotify, ALERT_POLL_MS);
  }, 30_000);
}

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
const webDist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(webDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(webDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`RTD Transit server listening on port ${PORT}`);
  startPushPoller();
});
