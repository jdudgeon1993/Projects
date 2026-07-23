/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

// Workbox manifest injected at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Network-first for API calls
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 })],
  })
);

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data: { title?: string; body?: string; icon?: string } = {};
  try { data = event.data.json(); } catch { data = { title: 'Nexus Alert', body: event.data.text() }; }

  const title = data.title ?? 'Nexus Alert';
  const options: NotificationOptions = {
    body: data.body ?? '',
    icon: data.icon ?? '/pwa-192x192.png',
    badge: '/badge-96x96.png',
    tag: title, // collapse duplicate alerts with the same title
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(self.location.origin) && 'focus' in c);
        if (existing) return existing.focus();
        return self.clients.openWindow('/');
      })
  );
});
