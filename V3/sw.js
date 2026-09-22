/* Offline shell for Racquetback.
 *
 * Navigations are network-first so a new deploy is picked up immediately;
 * versioned assets are cache-first because their URL changes when they do.
 * Nothing here touches match data - that lives in localStorage.
 */
const CACHE = 'racquetback-v1';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.add('./')).catch(() => null)
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    if (new URL(request.url).origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put('./', copy)).catch(() => null);
                    return response;
                })
                .catch(() => caches.match('./').then(hit => hit || Response.error()))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(hit => hit || fetch(request).then(response => {
            if (response && response.ok) {
                const copy = response.clone();
                caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => null);
            }
            return response;
        }))
    );
});
