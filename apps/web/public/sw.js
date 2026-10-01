/* HemCenter service worker.
   - Makes the app installable.
   - Shows Web Push notifications. They carry no message text (only the sender and the chat), see the server.
   - Caches nothing: work data must never be stored for offline reuse on a shared phone. */
importScripts('/sw-logic.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const payload = self.HC_SW.parsePayload(event.data ? event.data.text() : '');
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (!self.HC_SW.shouldShow(windows)) return;
      await self.registration.showNotification(payload.title, self.HC_SW.notificationOptions(payload));
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = self.HC_SW.safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = self.HC_SW.pickClient(windows);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(url).catch(() => undefined);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
