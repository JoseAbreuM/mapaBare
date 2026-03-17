const CACHE_NAME = 'pozos-cache-v14';
const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/css/styles.css?v=8',
    '/css/leaflet.css',
    // incluimos las rutas con query string para que coincidan exactamente
    '/js/leaflet.js?v=3',
    '/js/localforage.min.js?v=3',
    '/js/lucide.min.js?v=3',
    '/js/main.js?v=9',
    '/js/sw-register.js?v=4',
    '/js/firebase-init.js?v=3',
    '/js/pozos-data.js?v=1',
    '/manifest.json',
    '/icons/icono.png',
    '/icons/header.png',
    '/assets/mapas/bare-tradicional.jpg',
    '/assets/mapas/bare6-1.jpg',
    '/assets/mapas/bare6-2.jpg',
    '/assets/mapas/trilla-asfaltada.jpg',
    'https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js',
    'https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // No romper la instalación completa si un recurso falla.
            await Promise.allSettled(FILES_TO_CACHE.map(file => cache.add(file)));
        })
    );
});

self.addEventListener('message', event => {
    const isLegacyMessage = !!event.data && event.data.type === 'SKIP_WAITING';
    const isStringMessage = event.data === 'skipWaiting';
    if (!isLegacyMessage && !isStringMessage) return;
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
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isFirebaseCdn = url.origin === 'https://www.gstatic.com' && url.pathname.includes('/firebasejs/');
    const isSameOrigin = url.origin === self.location.origin;

    // Cachear tiles del mapa
    if (url.hostname.includes('tile.openstreetmap.org')) {
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
                }).catch(() => caches.match(event.request, {ignoreSearch: true}));
            })
        );
        return;
    }

    // Navegación: intentar red, luego cache, y fallback a index offline.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put('/index.html', responseClone);
                    });
                    return response;
                })
                .catch(async () => {
                    const cachedPage = await caches.match('/index.html', {ignoreSearch: true});
                    return cachedPage;
                })
        );
        return;
    }

    // Runtime cache para recursos del mismo origen y SDK de Firebase.
    if (isSameOrigin || isFirebaseCdn) {
        event.respondWith(
            caches.match(event.request, {ignoreSearch: true}).then(cached => {
                if (cached) return cached;
                return fetch(event.request)
                    .then(response => {
                        if (response && response.status === 200) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, responseClone);
                            });
                        }
                        return response;
                    })
                    .catch(() => caches.match(event.request, {ignoreSearch: true}));
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request, {ignoreSearch: true}).then(cached => {
            if (cached) return cached;
            return fetch(event.request);
        })
    );
});
