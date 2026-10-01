/* Minimal service worker: makes the app installable. It deliberately caches nothing —
   work data must never be stored for offline reuse on a shared phone. Web Push handlers are added in stage 2. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
