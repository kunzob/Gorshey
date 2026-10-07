/// <reference lib="webworker" />
// Service worker. One fetch listener; every decision comes from classifyRequest (src/core/swRoute.ts).
// Never intercepted: non-GET, other origins, Range requests, audio and artwork. No skipWaiting on install
// and no clients.claim: a new version waits until the listener chooses to reload.
import { cleanupOutdatedCaches, getCacheKeyForURL, matchPrecache, precache, type PrecacheEntry } from 'workbox-precaching';
import { NetworkFirst } from 'workbox-strategies';
import {
  RUNTIME_CACHE_PREFIX,
  SKIP_WAITING,
  TRACK_MANIFEST_CACHE,
  classifyRequest,
  markCached,
} from './core/swRoute';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

precache(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Track manifest: the network always wins. The cache is read only when the network fails (offline),
// and that copy is marked so the page reloads for a fresh one once it is back online.
const trackManifest = new NetworkFirst({
  cacheName: TRACK_MANIFEST_CACHE,
  plugins: [
    {
      cachedResponseWillBeUsed: async ({ cachedResponse }) => (cachedResponse ? markCached(cachedResponse) : cachedResponse),
    },
  ],
});

async function fromPrecache(url: string, request: Request): Promise<Response> {
  return (await matchPrecache(url)) ?? fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const route = classifyRequest(
    { method: request.method, url: request.url, mode: request.mode, range: request.headers.get('range') },
    self.location.origin,
    (url) => getCacheKeyForURL(url) !== undefined,
  );
  switch (route) {
    case 'bypass':
      return; // no respondWith: the browser and the HTTP cache handle it
    case 'track-manifest':
      event.respondWith(trackManifest.handle({ event, request }));
      return;
    case 'shell':
      event.respondWith(fromPrecache('/index.html', request));
      return;
    case 'precache':
      event.respondWith(fromPrecache(request.url, request));
      return;
  }
});

self.addEventListener('message', (event) => {
  if (event.data === SKIP_WAITING) void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith(RUNTIME_CACHE_PREFIX) && n !== TRACK_MANIFEST_CACHE)
            .map((n) => caches.delete(n)),
        ),
      ),
  );
});
