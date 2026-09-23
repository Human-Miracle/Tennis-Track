/* Offline shell for Racquetback.
 *
 * Navigations are network-first so a new deploy is picked up immediately;
 * versioned assets are cache-first because their URL changes when they do.
 * Nothing here touches match data - that lives in localStorage.
 */
const CACHE = 'racquetback-v8';

// Everything needed to boot with no network. Without this the shell could be
// served from cache while its scripts 404'd offline, which renders a blank
// page - the failure mode when launching from the home screen cold.
// Keep the query strings identical to index.html; bump them together.
const PRECACHE = [
    './',
    './style.css?v=10',
    './storage.js?v=2',
    './tournament.js?v=4',
    './leaderboard.js?v=1',
    './script.js?v=10',
    './manifest.json',
    './icons/icon-192.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE).then(cache =>
            // Added one at a time: addAll() is atomic, so a single failure
            // would abort the install and leave no offline shell at all.
            Promise.all(PRECACHE.map(url => cache.add(url).catch(() => null)))
        ).catch(() => null)
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
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    // Live bracket data must always come from the network.
    if (url.pathname.startsWith('/api/')) return;

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
