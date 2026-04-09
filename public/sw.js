// Service worker for Revoiced PWA
// Cache-on-visit strategy: network-first for visited pages, app shell cached on install

const CACHE_NAME = 'revoiced-v1';
const BASE = '/revoiced/';

// Offline fallback page URL
const OFFLINE_PAGE = BASE + 'offline/';

// App shell resources cached on install
const APP_SHELL = [
  BASE,
  BASE + 'manifest.json',
  OFFLINE_PAGE,
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Activate immediately without waiting for existing clients to close
  self.skipWaiting();
});

// Activate: clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for navigation and same-origin requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests under our base path
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  // Skip pagefind requests (handled by US-005)
  if (url.pathname.includes('/pagefind/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful GET responses
        if (request.method === 'GET' && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Serve offline fallback for navigation requests (HTML pages)
          if (request.mode === 'navigate') {
            return caches.match(OFFLINE_PAGE);
          }
          return cached;
        })
      )
  );
});
