const CACHE_NAME = 'pozos-cache-v4';
const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/css/leaflet.css',
    '/js/leaflet.js',
    '/js/localforage.min.js',
    '/js/lucide.min.js',
    '/js/main.js',
    '/js/sw-register.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            )
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                return cached;
            }
            return fetch(event.request).catch(() => {
                // podría retornar un offline fallback si se desea
            });
        })
    );
});
