const CACHE_NAME = 'pozos-cache-v18';
const BARE_TILE_BOUNDS = {
    minLat: 8.45,
    maxLat: 8.62,
    minLng: -64.15,
    maxLng: -63.93
};

function tileToLon(x, z) {
    return (x / Math.pow(2, z)) * 360 - 180;
}

function tileToLat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileIntersectsBareBounds(url) {
    const match = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (!match) return true;

    const z = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) return true;

    const west = tileToLon(x, z);
    const east = tileToLon(x + 1, z);
    const north = tileToLat(y, z);
    const south = tileToLat(y + 1, z);

    const lngOverlap = east >= BARE_TILE_BOUNDS.minLng && west <= BARE_TILE_BOUNDS.maxLng;
    const latOverlap = north >= BARE_TILE_BOUNDS.minLat && south <= BARE_TILE_BOUNDS.maxLat;
    return lngOverlap && latOverlap;
}
const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/css/styles.css?v=10',
    '/css/leaflet.css',
    // incluimos las rutas con query string para que coincidan exactamente
    '/js/leaflet.js?v=3',
    '/js/localforage.min.js?v=3',
    '/js/lucide.min.js?v=3',
    '/js/main.js?v=13',
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
        if (!tileIntersectsBareBounds(url)) {
            event.respondWith(fetch(event.request));
            return;
        }
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
