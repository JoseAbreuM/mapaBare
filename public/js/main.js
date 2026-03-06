// lógica principal de la PWA de pozos

let map;
let currentOverlay;
const zones = {
    'bare-tradicional': 'assets/mapas/bare-tradicional.jpg',
    'bare-6': 'assets/mapas/bare6-1.jpg',
    'bare-6-norte': 'assets/mapas/bare6-2.jpg',
    'bare-este': 'assets/mapas/trilla-asfaltada.jpg',
};

let pozoData = [];
let markers = {};
let searchId = null;
let editId = null;
let currentStatsFilter = 'all';
let pendingServiceAssignment = null;
const POZO_DATA_KEY = 'pozoData';
const POZO_DIRTY_KEY = 'pozoDataDirty';

const STATUS = {
    ACTIVO: 'activo',
    INACTIVO_SERVICIO: 'inactivo-servicio',
    EN_SERVICIO: 'en-servicio',
    DIAGNOSTICO: 'diagnostico',
    CANDIDATO: 'candidato',
    DIFERIDO: 'diferido'
};

function normalizeEstado(estado) {
    const value = (estado || '').toString().trim().toLowerCase();
    if (value === 'inactivo' || value === 'inactivo por servicio') return STATUS.INACTIVO_SERVICIO;
    if (value === 'revision' || value === 'revisión' || value === 'en revision' || value === 'en revisión' || value === 'diagnostico' || value === 'diagnóstico') {
        return STATUS.DIAGNOSTICO;
    }
    if (value === 'diferido') return STATUS.DIFERIDO;
    if (value === 'en servicio') return STATUS.EN_SERVICIO;
    if (value === STATUS.ACTIVO || value === STATUS.INACTIVO_SERVICIO || value === STATUS.EN_SERVICIO || value === STATUS.DIAGNOSTICO || value === STATUS.CANDIDATO || value === STATUS.DIFERIDO) {
        return value;
    }
    return STATUS.ACTIVO;
}

function normalizePozo(pozo) {
    const hasServicio = !!pozo.taladro;
    return {
        ...pozo,
        estado: hasServicio ? STATUS.EN_SERVICIO : normalizeEstado(pozo.estado)
    };
}

function isDesktop() {
    return window.innerWidth > 768;
}

window.addEventListener('DOMContentLoaded', init);

// antes de usar localforage asegurarnos de que existe (posible carga desde CDN)
async function ensureLocalForage() {
    if (typeof localforage !== 'undefined') return;
    // esperamos un corto periodo para ver si el script externo termina de cargar
    for (let i = 0; i < 20; i++) {
        if (typeof localforage !== 'undefined') return;
        await new Promise(r => setTimeout(r, 100));
    }
    // si aún no está definido hacemos un envoltorio mínimo usando localStorage
    if (typeof localforage === 'undefined') {
        console.warn('localforage no disponible; usando localStorage como respaldo');
        window.localforage = {
            getItem: async function(key) {
                const v = localStorage.getItem(key);
                return v ? JSON.parse(v) : null;
            },
            setItem: async function(key, value) {
                localStorage.setItem(key, JSON.stringify(value));
                return value;
            },
            removeItem: async function(key) {
                localStorage.removeItem(key);
            }
        };
    }
}

async function init() {
    // garantizar que localforage esté listo antes de intentar usarlo
    await ensureLocalForage();

    // Cargar datos desde local storage primero
    try {
        const localData = await localforage.getItem(POZO_DATA_KEY);
        if (localData && Array.isArray(localData)) {
            pozoData = localData.map(normalizePozo);
        } else if (Array.isArray(window.POZOS_SEED) && window.POZOS_SEED.length > 0) {
            // Fallback opcional: snapshot embebido para primer uso offline.
            pozoData = window.POZOS_SEED.map(normalizePozo);
            await localforage.setItem(POZO_DATA_KEY, pozoData);
            await clearDataDirty();
        } else if (!navigator.onLine) {
            // Primera carga sin internet
            document.getElementById('map').innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; font-size:18px;">Requiere conexión a internet para la primera carga</div>';
            return; // No continuar
        }
    } catch (e) {
        console.log('No hay datos locales', e);
        if (!navigator.onLine) {
            document.getElementById('map').innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; font-size:18px;">Requiere conexión a internet para la primera carga</div>';
            return;
        }
    }

    await setupMap();
    attachControls();

    // Render inicial usando lo que ya esté en memoria local/remota
    renderMarkers(document.getElementById('zone-select').value);
    updateDatalist();
    updateStats();

    // Si está online y Firestore está disponible, sincronizar en arranque.
    if (navigator.onLine && isDbReady()) {
        try {
            await syncData();
        } catch (e) {
            console.log('Error cargando desde Firestore', e);
        }
    }

    // Listener en tiempo real solo cuando Firestore está disponible.
    if (navigator.onLine && isDbReady()) {
        const docRef = getPozosDocRef();
        docRef.onSnapshot(async (doc) => {
            if (doc.exists) {
                const isDirty = await localforage.getItem(POZO_DIRTY_KEY);
                if (isDirty) return; // evita pisar cambios locales pendientes
                pozoData = (doc.data().pozos || []).map(normalizePozo);
                await localforage.setItem(POZO_DATA_KEY, pozoData);
                renderMarkers(document.getElementById('zone-select').value);
                updateDatalist();
                updateStats();
            }
        });
    }

    // Listeners para online/offline
    window.addEventListener('online', syncData);

        // Precalentar cache para que la app instalada abra offline de forma robusta.
        warmOfflineResources();
}

    async function warmOfflineResources() {
        if (!('caches' in window)) return;
        const resources = [
            '/index.html',
            '/css/styles.css',
            '/css/leaflet.css',
            '/js/leaflet.js?v=3',
            '/js/localforage.min.js?v=3',
            '/js/main.js?v=5',
            '/js/sw-register.js?v=3',
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
        try {
            const cache = await caches.open('pozos-cache-v11');
            await Promise.allSettled(resources.map(url => cache.add(url)));
        } catch (e) {
            console.log('No se pudo completar warmup de cache offline', e);
        }
}

function isDbReady() {
    return typeof window.db !== 'undefined' && window.db;
}

function getPozosDocRef() {
    return window.db.collection('pozos').doc('data');
}

async function markDataDirty() {
    await localforage.setItem(POZO_DIRTY_KEY, true);
}

async function clearDataDirty() {
    await localforage.setItem(POZO_DIRTY_KEY, false);
}

async function syncData() {
    if (!navigator.onLine || !isDbReady()) return;
    try {
        const docRef = getPozosDocRef();
        const isDirty = await localforage.getItem(POZO_DIRTY_KEY);
        if (isDirty) {
            await docRef.set({ pozos: pozoData });
            await clearDataDirty();
        }
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            pozoData = (docSnap.data().pozos || []).map(normalizePozo);
            await localforage.setItem(POZO_DATA_KEY, pozoData);
            renderMarkers(document.getElementById('zone-select').value);
            updateDatalist();
            updateStats();
        }
    } catch (e) {
        console.log('Error sincronizando', e);
    }
}

async function setupMap() {
    map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -2
    });

    await loadZone(document.getElementById('zone-select').value);
    renderMarkers(document.getElementById('zone-select').value);

    map.on('click', onMapClick);
}

function loadZone(zone) {
    return new Promise((resolve) => {
        if (currentOverlay) {
            map.removeLayer(currentOverlay);
        }
        const url = zones[zone];
        if (!url) {
            resolve();
            return;
        }
        const img = new Image();
        img.src = url;
        img.onload = () => {
            const w = img.width;
            const h = img.height;
            const bounds = [[0, 0], [h, w]];
            currentOverlay = L.imageOverlay(url, bounds).addTo(map);
            map.setMaxBounds(bounds);
            map.fitBounds(bounds);
            resolve();
        };
    });
}

function updateDatalist(filter = '') {
    const list = document.getElementById('pozos-list');
    list.innerHTML = '';
    pozoData
        .filter(p => p.id.includes(filter.toUpperCase()))
        .forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            list.appendChild(opt);
        });
}

function renderMarkers(zone) {
    // eliminar anteriores
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};

    pozoData
        .filter(p => p.zona === zone)
        .filter(matchesCurrentFilter)
        .forEach(p => {
        const marker = createMarker(p);
        marker.addTo(map);
        markers[p.id] = marker;
        });
}

function matchesCurrentFilter(pozo) {
    if (!isDesktop()) return true;
    if (currentStatsFilter === 'all') return true;
    if (currentStatsFilter === STATUS.EN_SERVICIO) return !!pozo.taladro;
    return normalizeEstado(pozo.estado) === currentStatsFilter;
}

// Función para crear el icono de servicio con color personalizado, número opcional y borde
function crearIconoServicio(colorPrincipal, numero = null, colorBorde = '#000000', colorNumero = '#ffffff') {
    // Se usan atributos inline para que cada icono conserve su color sin ser sobrescrito por otro marcador.
    let fullSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" style="filter: drop-shadow(0 0 1px rgba(255,255,255,0.3));">
            <path fill="${colorPrincipal}" stroke="${colorBorde}" stroke-width="8" d="M91.6 73.8C79.3 68.8 65.3 74.7 60.4 87C47.2 119.5 40 154.9 40 192C40 229.1 47.2 264.5 60.4 297C65.4 309.3 79.4 315.2 91.7 310.2C104 305.2 109.9 291.2 104.9 278.9C94 252.2 88 222.8 88 192C88 161.2 94 131.8 104.9 105C109.9 92.7 103.9 78.7 91.7 73.7zM548.4 73.8C536.1 78.8 530.2 92.8 535.2 105.1C546.1 131.9 552.1 161.3 552.1 192.1C552.1 222.9 546.1 252.3 535.2 279.1C530.2 291.4 536.2 305.4 548.4 310.4C560.6 315.4 574.7 309.4 579.7 297.2C592.8 264.7 600.1 229.3 600.1 192.2C600.1 155.1 592.9 119.7 579.7 87.2C574.7 74.9 560.7 69 548.4 74zM372.1 229.2C379.6 218.7 384 205.9 384 192C384 156.7 355.3 128 320 128C284.7 128 256 156.7 256 192C256 205.9 260.4 218.7 267.9 229.2L130.9 530.8C123.6 546.9 130.7 565.9 146.8 573.2C162.9 580.5 181.9 573.4 189.2 557.3L209.8 512.1L430.4 512.1L451 557.3C458.3 573.4 477.3 580.5 493.4 573.2C509.5 565.9 516.6 546.9 509.3 530.8L372.1 229.2zM408.5 464L231.5 464L253.3 416L386.6 416L408.4 464zM320 269.3L364.8 368L275.1 368L319.9 269.3zM195.3 137.6C200.6 125.5 195.1 111.3 182.9 106C170.7 100.7 156.6 106.2 151.3 118.4C141.5 141 136 165.9 136 192C136 218.1 141.5 243 151.3 265.6C156.6 277.7 170.8 283.3 182.9 278C195 272.7 200.6 258.5 195.3 246.4C188 229.8 184 211.4 184 192C184 172.6 188 154.2 195.3 137.6zM488.7 118.4C483.4 106.3 469.2 100.7 457.1 106C445 111.3 439.4 125.5 444.7 137.6C452 154.2 456 172.6 456 192C456 211.4 452 229.8 444.7 246.4C439.4 258.5 444.9 272.7 457.1 278C469.3 283.3 483.4 277.8 488.7 265.6C498.5 243 504 218.1 504 192C504 165.9 498.5 141 488.7 118.4z"/>
    `;
    
    if (numero !== null) {
        fullSvg += `<text x="320" y="200" fill="${colorNumero}" font-size="60" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${numero}</text>`;
    }
    fullSvg += `</svg>`;

    return L.divIcon({
        html: fullSvg,
        className: 'contenedor-icono-servicio',
        iconSize: [23, 23],
        iconAnchor: [11, 23],
        popupAnchor: [0, -23]
    });
}

// Función para crear el icono de gotas (droplets) para WT
function crearIconoWT() {
    const svgDroplets = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-droplets-icon lucide-droplets">
            <style>
                .lucide-droplets path {
                    stroke: #000000;
                    fill: #27E4F5;
                }
                .lucide-droplets {
                    filter: drop-shadow(0 0 1px rgba(255,255,255,0.3));
                }
            </style>
            <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/>
            <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>
        </svg>
    `;

    return L.divIcon({
        html: svgDroplets,
        className: 'contenedor-icono-wt',
        iconSize: [14, 14],
        iconAnchor: [7, 14],
        popupAnchor: [0, -14]
    });
}

function createMarker(p) {
    const normalizedEstado = normalizeEstado(p.estado);
    const color =
        normalizedEstado === STATUS.ACTIVO
            ? '#43a047'
            : normalizedEstado === STATUS.INACTIVO_SERVICIO
            ? '#1e88e5'
            : normalizedEstado === STATUS.CANDIDATO
            ? '#e53935'
            : normalizedEstado === STATUS.DIFERIDO
            ? '#7f8c8d'
            : '#fb8c00';
    let marker;
    if (p.taladro) {
        let icon;
        if (p.taladro === 'WT') {
            icon = crearIconoWT();
        } else {
            // Mapear servicios a colores y números
            const servicioConfig = {
                'Ranger-357': { color: '#000000', numero: 7, borde: '#ffcc00', numeroColor: '#ffcc00' },
                'RIG-351': { color: '#e53935', numero: 1, borde: '#000000', numeroColor: '#ffffff' },
                'RIG-352': { color: '#3388ff', numero: 2, borde: '#000000', numeroColor: '#ffffff' },
                'Ranger-151': { color: '#ffcc00', numero: null, borde: '#000000', numeroColor: '#ffffff' }
            };
            const config = servicioConfig[p.taladro] || { color: '#000000', numero: null, borde: '#000000', numeroColor: '#ffffff' };
            icon = crearIconoServicio(config.color, config.numero, config.borde, config.numeroColor);
        }
        marker = L.marker(p.coords, { icon });
    } else {
        // Hacer los marcadores de pozos más sutiles
        marker = L.circleMarker(p.coords, {
            radius: 4,
            color: color,
            fillColor: color,
            fillOpacity: 0.6,
            weight: 1
        });
    }
    marker.bindPopup(popupContent(p));
    return marker;
}

function popupContent(p) {
    const estadoLabelMap = {
        [STATUS.ACTIVO]: 'Activo',
        [STATUS.INACTIVO_SERVICIO]: 'Inactivo por servicio',
        [STATUS.EN_SERVICIO]: 'En servicio',
        [STATUS.DIAGNOSTICO]: 'En diagnostico',
        [STATUS.CANDIDATO]: 'Candidato',
        [STATUS.DIFERIDO]: 'Diferido'
    };
    const estadoLabel = estadoLabelMap[normalizeEstado(p.estado)] || p.estado;
    let content = `<strong>${p.id}</strong><br>
    Zona: ${p.zona}<br>
    Estado: ${estadoLabel}`;
    if (p.cabezal) content += `<br>Cabezal: ${p.cabezal}`;
    if (p.variador) content += `<br>Variador: ${p.variador}`;
    if (p.potencial) content += `<br>Potencial: ${p.potencial} barriles`;
    if (p.taladro) content += `<br>Servicio: ${p.taladro}`;
    if (normalizeEstado(p.estado) === STATUS.DIFERIDO && p.causaDiferido) content += `<br>Causa diferido: ${p.causaDiferido}`;
    // Solo mostrar botones de editar/eliminar en desktop
    if (isDesktop()) {
        content += `<br><button onclick="editPozo('${p.id}')">Editar</button> <button onclick="deletePozo('${p.id}')">Eliminar</button>`;
    }
    return content;
}

function onMapClick(e) {
    if (!document.getElementById('edit-mode').checked) return;
    const { lat, lng } = e.latlng;
    openForm(lat, lng);
}

function openForm(lat = null, lng = null, id = null) {
    document.getElementById('form-container').classList.remove('hidden');
    if (id) {
        editId = id;
        document.getElementById('form-title').textContent = 'Editar Pozo';
        const p = pozoData.find(p => p.id === id);
        document.getElementById('form-id').value = p.id;
        document.getElementById('form-id').disabled = true;
        const normalizedEstado = p.taladro ? STATUS.EN_SERVICIO : normalizeEstado(p.estado);
        document.getElementById('form-estado').value = normalizedEstado;
        document.getElementById('form-diferido-cause').value = normalizedEstado === STATUS.DIFERIDO ? (p.causaDiferido || '') : '';
        togglePozoDiferidoCause();
        document.getElementById('form-cabezal').value = p.cabezal || '';
        document.getElementById('form-variador').value = p.variador || '';
        document.getElementById('form-potencial').value = p.potencial || '';
        // no setear coords para edición
    } else {
        editId = null;
        document.getElementById('form-title').textContent = 'Nuevo Pozo';
        document.getElementById('form-id').disabled = false;
        document.getElementById('form-lat').value = lat;
        document.getElementById('form-lng').value = lng;
        document.getElementById('form-diferido-cause').value = '';
        togglePozoDiferidoCause();
    }
}

function closeForm() {
    console.log('Cerrando form');
    document.getElementById('form-container').classList.add('hidden');
    document.getElementById('pozo-form').reset();
    document.getElementById('form-title').textContent = 'Nuevo Pozo';
    document.getElementById('form-id').disabled = false;
    document.getElementById('form-diferido-cause').value = '';
    togglePozoDiferidoCause();
    editId = null;
}

function togglePozoDiferidoCause() {
    const estado = normalizeEstado(document.getElementById('form-estado').value);
    const causeWrapper = document.getElementById('form-diferido-cause-wrapper');
    if (estado === STATUS.DIFERIDO) {
        causeWrapper.classList.remove('hidden');
        return;
    }
    causeWrapper.classList.add('hidden');
}

function openAssignForm() {
    document.getElementById('assign-form-container').classList.remove('hidden');
}

function closeAssignForm() {
    document.getElementById('assign-form-container').classList.add('hidden');
    document.getElementById('assign-taladro-form').reset();
}

async function assignTaladro(e) {
    e.preventDefault();
    const pozoId = document.getElementById('assign-pozo-id').value.trim().toUpperCase();
    const taladro = document.getElementById('assign-taladro-select').value;
    const p = pozoData.find(pozo => pozo.id === pozoId);
    if (!p) {
        alert('Pozo no encontrado');
        return;
    }
    const previousPozo = pozoData.find(pozo => pozo.taladro === taladro && pozo.id !== pozoId);
    if (previousPozo) {
        pendingServiceAssignment = { pozoId, taladro, previousPozoId: previousPozo.id };
        openServiceVerification(previousPozo.id);
        return;
    }

    p.taladro = taladro;
    p.estado = STATUS.EN_SERVICIO;
    p.causaDiferido = null;

    await persistPozosAndRefresh();
    closeAssignForm();
}

function openServiceVerification(previousPozoId) {
    document.getElementById('verification-pozo-label').textContent = `Pozo saliente: ${previousPozoId}`;
    document.querySelector('input[name="verification-estado"][value="activo"]').checked = true;
    document.getElementById('verification-cause').value = '';
    document.getElementById('verification-cause-wrapper').classList.add('hidden');
    document.getElementById('service-verification-container').classList.remove('hidden');
}

function closeServiceVerification() {
    document.getElementById('service-verification-container').classList.add('hidden');
    document.getElementById('service-verification-form').reset();
    document.getElementById('verification-cause-wrapper').classList.add('hidden');
}

async function submitServiceVerification(e) {
    e.preventDefault();
    if (!pendingServiceAssignment) {
        closeServiceVerification();
        return;
    }

    const selectedEstadoInput = document.querySelector('input[name="verification-estado"]:checked');
    const selectedEstado = normalizeEstado(selectedEstadoInput ? selectedEstadoInput.value : STATUS.ACTIVO);
    const causeInput = document.getElementById('verification-cause');
    const cause = causeInput.value.trim();

    if (selectedEstado === STATUS.DIFERIDO && !cause) {
        alert('Indique la causa para estado diferido');
        causeInput.focus();
        return;
    }

    const { pozoId, taladro, previousPozoId } = pendingServiceAssignment;
    const currentPozo = pozoData.find(pozo => pozo.id === pozoId);
    const previousPozo = pozoData.find(pozo => pozo.id === previousPozoId);

    if (!currentPozo) {
        alert('Pozo destino no encontrado');
        pendingServiceAssignment = null;
        closeServiceVerification();
        return;
    }

    if (previousPozo) {
        previousPozo.taladro = null;
        previousPozo.estado = selectedEstado;
        previousPozo.causaDiferido = selectedEstado === STATUS.DIFERIDO ? cause : null;
    }

    currentPozo.taladro = taladro;
    currentPozo.estado = STATUS.EN_SERVICIO;
    currentPozo.causaDiferido = null;

    pendingServiceAssignment = null;
    await persistPozosAndRefresh();
    closeServiceVerification();
    closeAssignForm();
}

function toggleVerificationCause() {
    const selectedEstadoInput = document.querySelector('input[name="verification-estado"]:checked');
    const selectedEstado = selectedEstadoInput ? selectedEstadoInput.value : STATUS.ACTIVO;
    const causeWrapper = document.getElementById('verification-cause-wrapper');
    if (selectedEstado === STATUS.DIFERIDO) {
        causeWrapper.classList.remove('hidden');
        return;
    }
    causeWrapper.classList.add('hidden');
}

async function persistPozosAndRefresh() {
    // Guardar en local siempre
    await localforage.setItem(POZO_DATA_KEY, pozoData);
    await markDataDirty();
    // Guardar en Firestore solo si está online
    if (navigator.onLine && isDbReady()) {
        await syncData();
    }
    const zone = document.getElementById('zone-select').value;
    loadZone(zone);
    renderMarkers(zone);
    updateStats();
}

// funciones globales para popup
window.editPozo = function(id) {
    openForm(null, null, id);
};

window.deletePozo = async function(id) {
    if (!confirm('¿Eliminar pozo ' + id + '?')) return;
    pozoData = pozoData.filter(p => p.id !== id);
    // Guardar en local siempre
    await localforage.setItem(POZO_DATA_KEY, pozoData);
    await markDataDirty();
    // Guardar en Firestore solo si está online
    if (navigator.onLine && isDbReady()) {
        await syncData();
    }
    const zone = document.getElementById('zone-select').value;
    loadZone(zone);
    renderMarkers(zone);
    updateStats();
    updateDatalist();
};

async function savePozo(e) {
    e.preventDefault();
    const previousPozo = editId ? pozoData.find(p => p.id === editId) : null;
    const formEstado = normalizeEstado(document.getElementById('form-estado').value);
    const formCausaDiferido = document.getElementById('form-diferido-cause').value.trim();
    const pozo = {
        id: document.getElementById('form-id').value.trim().toUpperCase(),
        zona: document.getElementById('zone-select').value,
        coords: previousPozo ? previousPozo.coords : [
            parseFloat(document.getElementById('form-lat').value),
            parseFloat(document.getElementById('form-lng').value)
        ],
        estado: formEstado,
        cabezal: document.getElementById('form-cabezal').value || null,
        variador: document.getElementById('form-variador').value || null,
        potencial: document.getElementById('form-potencial').value || null,
        taladro: previousPozo ? previousPozo.taladro : null,
        causaDiferido: formEstado === STATUS.DIFERIDO ? formCausaDiferido : null
    };
    if (pozo.taladro) {
        pozo.estado = STATUS.EN_SERVICIO;
        pozo.causaDiferido = null;
    }
    if (pozo.estado !== STATUS.DIFERIDO) {
        pozo.causaDiferido = null;
    }
    if (!pozo.taladro && pozo.estado === STATUS.DIFERIDO && !pozo.causaDiferido) {
        alert('Debe indicar la causa para estado diferido');
        document.getElementById('form-diferido-cause').focus();
        return;
    }
    if (!pozo.id) {
        alert('Debe indicar un ID');
        return;
    }
    if (!editId && pozoData.find(p => p.id === pozo.id)) {
        alert('ID ya existe');
        return;
    }
    if (editId) {
        const index = pozoData.findIndex(p => p.id === editId);
        pozoData[index] = pozo;
    } else {
        pozoData.push(pozo);
    }
    // Guardar en local siempre
    await localforage.setItem(POZO_DATA_KEY, pozoData);
    await markDataDirty();
    // Guardar en Firestore solo si está online
    if (navigator.onLine && isDbReady()) {
        await syncData();
    }
    loadZone(pozo.zona);
    renderMarkers(pozo.zona);
    document.getElementById('zone-select').value = pozo.zona;
    updateDatalist();
    updateStats();
    console.log('Pozo guardado:', pozo);
    closeForm();
}

function updateStats() {
    const counts = {
        total: pozoData.length,
        activo: 0,
        'inactivo-servicio': 0,
        'en-servicio': 0,
        diagnostico: 0,
        candidato: 0,
        diferido: 0
    };

    pozoData.forEach(p => {
        const normalizedEstado = p.taladro ? STATUS.EN_SERVICIO : normalizeEstado(p.estado);
        if (normalizedEstado === STATUS.EN_SERVICIO) {
            counts['en-servicio']++;
            return;
        }
        if (Object.prototype.hasOwnProperty.call(counts, normalizedEstado)) {
            counts[normalizedEstado]++;
        }
    });

    document.getElementById('count-total').textContent = counts.total;
    document.getElementById('count-active').textContent = counts.activo;
    document.getElementById('count-inactive-service').textContent = counts['inactivo-servicio'];
    document.getElementById('count-in-service').textContent = counts['en-servicio'];
    document.getElementById('count-diagnostic').textContent = counts.diagnostico;
    document.getElementById('count-candidate').textContent = counts.candidato;
    document.getElementById('count-deferred').textContent = counts.diferido;
}

function updateStatsFilterUi() {
    document.querySelectorAll('.stats-item').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.filter === currentStatsFilter);
    });
}

function applyStatsFilter(filter) {
    currentStatsFilter = filter;
    updateStatsFilterUi();
    renderMarkers(document.getElementById('zone-select').value);
}

async function runSearchById(rawId, clearMobileInput = false) {
    const id = (rawId || '').trim().toUpperCase();
    if (!id) return;

    const p = pozoData.find(pozo => pozo.id === id);
    if (!p) return;

    searchId = id;
    document.getElementById('zone-select').value = p.zona;
    document.getElementById('mobile-zone-select').value = p.zona;

    await loadZone(p.zona);
    renderMarkers(p.zona);

    if (markers[searchId]) {
        map.flyTo(p.coords, Math.max(map.getZoom(), 2));
        markers[searchId].openPopup();
    }

    searchId = null;

    if (clearMobileInput) {
        document.getElementById('floating-search-input').classList.add('hidden');
        document.getElementById('mobile-search').value = '';
    }
}

function attachControls() {
    document.getElementById('zone-select').addEventListener('change', async e => {
        await loadZone(e.target.value);
        renderMarkers(e.target.value);
    });

    const search = document.getElementById('search-input');
    search.addEventListener('input', e => {
        updateDatalist(e.target.value);
    });
    search.addEventListener('change', async e => {
        await runSearchById(e.target.value);
    });
    search.addEventListener('keydown', async e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            await runSearchById(e.target.value);
        }
    });

    document.getElementById('pozo-form').addEventListener('submit', savePozo);
    document.getElementById('form-cancel').addEventListener('click', closeForm);
    document.getElementById('form-estado').addEventListener('change', togglePozoDiferidoCause);

    document.getElementById('assign-taladro-btn').addEventListener('click', openAssignForm);
    document.getElementById('assign-taladro-form').addEventListener('submit', assignTaladro);
    document.getElementById('assign-cancel').addEventListener('click', closeAssignForm);
    document.getElementById('service-verification-form').addEventListener('submit', submitServiceVerification);
    document.getElementById('verification-cancel').addEventListener('click', () => {
        pendingServiceAssignment = null;
        closeServiceVerification();
    });
    document.querySelectorAll('input[name="verification-estado"]').forEach(input => {
        input.addEventListener('change', toggleVerificationCause);
    });

    // Botón flotante de búsqueda para móvil
    document.getElementById('floating-search-btn').addEventListener('click', () => {
        const inputDiv = document.getElementById('floating-search-input');
        inputDiv.classList.toggle('hidden');
        // Cerrar zona si está abierta
        document.getElementById('floating-zone-input').classList.add('hidden');
    });

    document.getElementById('mobile-search-btn').addEventListener('click', async () => {
        await runSearchById(document.getElementById('mobile-search').value, true);
    });

    document.getElementById('mobile-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('mobile-search-btn').click();
        }
    });

    // Botón flotante de zona para móvil
    document.getElementById('floating-zone-btn').addEventListener('click', () => {
        const inputDiv = document.getElementById('floating-zone-input');
        inputDiv.classList.toggle('hidden');
        // Cerrar búsqueda si está abierta
        document.getElementById('floating-search-input').classList.add('hidden');
    });

    document.getElementById('mobile-zone-select').addEventListener('change', async (e) => {
        const zona = e.target.value;
        document.getElementById('zone-select').value = zona;
        await loadZone(zona);
        renderMarkers(zona);
        document.getElementById('floating-zone-input').classList.add('hidden');
    });

    // Filtro por estadísticas solo en desktop
    document.querySelectorAll('.stats-item').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!isDesktop()) return;
            applyStatsFilter(btn.dataset.filter || 'all');
        });
    });

    updateStatsFilterUi();
}

// para depuración
window.debug = { pozoData, markers, map };
