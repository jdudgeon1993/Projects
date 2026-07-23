/**
 * Client-side Web Push helpers.
 *
 * subscribeToPush()  — request notification permission, create a push
 *                      subscription and register it with the server.
 * updatePushRoutes() — update the route list for an existing subscription.
 * unsubscribeFromPush() — remove subscription from server + browser.
 */

const VAPID_PUBLIC_KEY_ENV = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

let cachedVapidPublicKey: string | null = null;

async function getVapidPublicKey(): Promise<string> {
  if (VAPID_PUBLIC_KEY_ENV) return VAPID_PUBLIC_KEY_ENV;
  if (cachedVapidPublicKey) return cachedVapidPublicKey;
  const res = await fetch('/api/push/vapid-key');
  if (!res.ok) throw new Error('Push notifications not configured on server');
  const { publicKey } = await res.json();
  cachedVapidPublicKey = publicKey;
  return publicKey;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function getOrCreateSubscription(): Promise<PushSubscription> {
  const vapidKey = await getVapidPublicKey();
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as ArrayBuffer,
  });
}

export async function subscribeToPush(routeShortNames: string[]): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const sub = await getOrCreateSubscription();
  const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth, routeShortNames }),
  });
}

export async function updatePushRoutes(routeShortNames: string[]): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();

  if (routeShortNames.length === 0) {
    // No favorites left — tear down the subscription entirely instead of
    // leaving a dangling row with an empty route list in Supabase.
    if (sub) await unsubscribeFromPush();
    return;
  }

  if (!sub) {
    await subscribeToPush(routeShortNames);
    return;
  }
  const { endpoint, keys } = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth, routeShortNames }),
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const { endpoint } = sub.toJSON() as { endpoint: string };
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  await sub.unsubscribe();
}
