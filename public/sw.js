const CACHE_NAME = 'pozos-cache-v9';
const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/css/leaflet.css',
    // incluimos las rutas con query string para que coincidan exactamente
    '/js/leaflet.js?v=3',
    '/js/localforage.min.js?v=3',
    '/js/lucide.min.js?v=3',
    '/js/main.js?v=3',
    '/js/sw-register.js?v=3',
    '/js/firebase-init.js?v=3',
    '/manifest.json',
    '/icons/icono.png',
    '/assets/mapas/bare-tradicional.jpg',
    '/assets/mapas/bare6-1.jpg',
    '/assets/mapas/bare6-2.jpg',
    '/assets/mapas/trilla-asfaltada.jpg',
    'https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js'
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
    // Cachear tiles del mapa
    if (event.request.url.includes('tile.openstreetmap.org')) {
        event.respondWith(
            // ignorar parámetros de búsqueda para que ej. main.js?v=3 coincida
            caches.match(event.request, {ignoreSearch: true}).then(cached => {
                if (cached) {
                    return cached;
                }
                return fetch(event.request).then(response => {
                    // Cachear la respuesta
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                });
            })
        );
    } else {
        event.respondWith(
            caches.match(event.request, {ignoreSearch: true}).then(cached => {
                if (cached) {
                    return cached;
                }
                return fetch(event.request).catch(() => {
                    // podría retornar un offline fallback si se desea
                });
            })
        );
    }
});
