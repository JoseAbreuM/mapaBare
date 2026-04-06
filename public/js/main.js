// lógica principal de la PWA de pozos

let map;
let currentOverlay;
let mapMode = 'diagram';
let osmLayer = null;
let mapaLayers = [];
let mapBounds = null;
let currentDiagramZone = null;
let diagramSizeCache = null;
const zones = {
    'bare-tradicional': 'assets/mapas/bare-tradicional.jpg',
    'bare-6': 'assets/mapas/bare6-1.jpg',
    'bare-6-norte': 'assets/mapas/bare6-2.jpg',
    'bare-este': 'assets/mapas/trilla-asfaltada.jpg',
};

let pozoData = [];
let markers = {};
let markerDecorators = [];
let searchId = null;
let editId = null;
let currentStatsFilter = 'all';
let currentCategoryFilter = 'all';
let pendingServiceAssignment = null;
let pendingDiagramAssignCoords = null;
let pendingDiagramReassignPozoId = null;
let resolvedCtIconHtml = null;
const APP_VERSION = 'v1.16';
const OFFLINE_CACHE_NAME = 'pozos-cache-v28';
const MAP_ROUTE_FILES = ['assets/mapas/Prueba1.gpx', 'assets/mapas/2do.gpx', 'assets/mapas/trillas.gpx'];
const MAP_ROUTE_STYLES = {
    'Prueba1.gpx': {
        color: '#ffb067',
        dashArray: null,
        weight: 2
    },
    '2do.gpx': {
        color: '#73cfff',
        dashArray: null,
        weight: 2
    },
    'trillas.gpx': {
        color: '#7ddf8a',
        dashArray: null,
        weight: 2.4
    }
};
const MAP_STATION_DEFINITIONS = [
    {
        id: 'bare-9',
        nombre: 'BARE 9',
        aliases: ['bare 9', 'bared 9', 'bared-9'],
        colorFondo: '#1f2a44',
        colorBorde: '#f1c40f',
        colorIcono: '#f1c40f'
    },
    {
        id: 'bare-10',
        nombre: 'BARE 10',
        aliases: ['bare 10', 'bared 10', 'bared-10'],
        colorFondo: '#123b2c',
        colorBorde: '#2ecc71',
        colorIcono: '#2ecc71'
    }
];
const SERVICE_SEARCH_CONFIG = [
    { taladro: 'Ranger-357', tags: ['357', 'ranger-357', 'ranger 357', 'servicio 357'] },
    { taladro: 'RIG-351', tags: ['351', 'rig-351', 'rig 351', 'servicio 351'] },
    { taladro: 'RIG-352', tags: ['352', 'rig-352', 'rig 352', 'servicio 352'] },
    { taladro: 'RIG-RANGER-555', tags: ['555', 'rig-ranger-555', 'rig ranger 555', 'servicio 555'] },
    { taladro: 'Ranger-151', tags: ['151', 'ranger-151', 'ranger 151', 'servicio 151'] },
    {
        taladro: 'CT',
        tags: [
            'ct',
            'coiled tubing',
            'coiled-tubing',
            'coiledtubing',
            'coiled tubbing',
            'coil tubing',
            'estimulacion',
            'estimulacion ct',
            'estimulacion de pozo'
        ]
    },
    {
        taladro: 'WT',
        tags: [
            'wt',
            'well testing',
            'wel testing',
            'well-testing',
            'wel-testing',
            'prueba liquida',
            'prueba liquida wt'
        ]
    }
];
const POZO_DATA_KEY = 'pozoData';
const MAP_MODE_KEY = 'mapMode';
const SIDEBAR_COMPACT_KEY = 'sidebarCompact';
const POZO_DIRTY_KEY = 'pozoDataDirty';
const AUTH_CONFIG_KEY = 'authConfig';
const AUTH_SESSION_KEY = 'authSession';
const AUTH_SEED_USER = {
    usuario: 'optimizacion',
    nombre: 'Optimizacion',
    passwordHash: '480a8dd811e896329ea1d0940459c6c3ecac5b3a59807214956d667ddd5202c3'
};

let isAuthenticated = false;
let authenticatedUser = null;
let authConfig = null;

const STATUS = {
    ACTIVO: 'activo',
    INACTIVO_SERVICIO: 'inactivo-servicio',
    EN_SERVICIO: 'en-servicio',
    DIAGNOSTICO: 'diagnostico',
    CANDIDATO: 'candidato',
    DIFERIDO: 'diferido'
};

const BARE_MAP_BOUNDS = {
    minLat: 8.5,
    maxLat: 8.7,
    minLng: -64.25,
    maxLng: -63.95
};

const MAP_LABEL_MIN_ZOOM = 15;
const MAP_LABEL_DENSITY_LIMIT = 90;
const MAP_SIMPLIFIED_MARKER_LIMIT = 220;
const MAP_VIEWPORT_PAD = 0.12;

let pendingMapRenderFrame = null;

function normalizeEstado(estado) {
    const value = (estado || '').toString().trim().toLowerCase();
    if (value === 'inactivo' || value === 'inactivo por servicio' || value === 'en espera de servicio' || value === 'espera de servicio') return STATUS.INACTIVO_SERVICIO;
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

function normalizeCategoria(pozo, normalizedEstado) {
    const rawCategoria = Number(pozo.categoria);
    const hasCategoria = Number.isFinite(rawCategoria);
    const estado = normalizedEstado || normalizeEstado(pozo.estado);

    if (estado === STATUS.ACTIVO) return 1;
    if (estado === STATUS.CANDIDATO || estado === STATUS.DIFERIDO) return 3;

    if (estado === STATUS.EN_SERVICIO) {
        return hasCategoria && rawCategoria === 3 ? 3 : 2;
    }

    if (estado === STATUS.INACTIVO_SERVICIO || estado === STATUS.DIAGNOSTICO) {
        if (hasCategoria && (rawCategoria === 2 || rawCategoria === 3)) {
            return rawCategoria;
        }
        return 2;
    }

    return hasCategoria ? rawCategoria : 2;
}

function normalizePozo(pozo) {
    const hasServicio = !!pozo.taladro;
    const normalizedEstado = hasServicio ? STATUS.EN_SERVICIO : normalizeEstado(pozo.estado);
    const normalizedZone = (pozo.zona || '').toString().trim().toLowerCase();
    const normalizedDiagram = (pozo.diagrama || '').toString().trim().toLowerCase();
    const knownDiagram = Object.prototype.hasOwnProperty.call(zones, normalizedDiagram);
    const diagram = knownDiagram ? normalizedDiagram : 'sin-asignar';
    const coordsMapa = isGeoCoords(pozo.coordsMapa)
        ? pozo.coordsMapa
        : (isGeoCoords(pozo.coords) ? pozo.coords : null);
    const coordsDiagrama = isDiagramCoords(pozo.coordsDiagrama)
        ? pozo.coordsDiagrama
        : (isDiagramCoords(pozo.coords) ? pozo.coords : null);
    const voRaw = pozo.velocidadOperacional ?? pozo.vo;
    const voValue = (voRaw === null || voRaw === undefined || voRaw === '')
        ? null
        : Number(voRaw);
    return {
        ...pozo,
        zona: normalizedZone || null,
        diagrama: diagram,
        estado: normalizedEstado,
        coordsMapa,
        coordsDiagrama,
        coords: coordsMapa || coordsDiagrama || pozo.coords,
        nota: (pozo.nota || '').toString().trim() || null,
        velocidadOperacional: Number.isFinite(voValue) ? voValue : null,
        fechaUltimoServicio: (pozo.fechaUltimoServicio || '').toString().trim() || null,
        altoCorteAgua: parseBooleanFlag(pozo.altoCorteAgua),
        vistaMapa: pozo.vistaMapa !== false,
        categoria: normalizeCategoria(pozo, normalizedEstado)
    };
}

function isDesktop() {
    return window.innerWidth > 768;
}

function normalizeText(value) {
    return (value || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function parseBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'si' || normalized === 'sí';
    }
    return false;
}

function hasHighWaterCut(pozo) {
    if (parseBooleanFlag(pozo.altoCorteAgua)) return true;
    const potencialRaw = pozo.potencial;
    if (potencialRaw === null || potencialRaw === undefined || potencialRaw === '') return false;
    const potencialValue = Number(potencialRaw);
    return Number.isFinite(potencialValue) && potencialValue === 0;
}

function pozoMapLabel(pozoId) {
    const raw = (pozoId || '').toString().trim();
    const numeric = raw.replace(/\D+/g, '');
    if (!numeric) return raw;
    const withoutLeadingZeros = numeric.replace(/^0+/, '');
    return withoutLeadingZeros || '0';
}

function isGeoCoords(coords) {
    if (!Array.isArray(coords) || coords.length !== 2) return false;
    const lat = Number(coords[0]);
    const lng = Number(coords[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function isDiagramCoords(coords) {
    return Array.isArray(coords)
        && coords.length === 2
        && Number.isFinite(Number(coords[0]))
        && Number.isFinite(Number(coords[1]))
        && !isGeoCoords(coords);
}

function getMapaCoords(pozo) {
    if (isGeoCoords(pozo.coordsMapa)) return pozo.coordsMapa;
    if (isGeoCoords(pozo.coords)) return pozo.coords;
    return null;
}

function getDiagramCoords(pozo) {
    if (isDiagramCoords(pozo.coordsDiagrama)) return pozo.coordsDiagrama;
    if (isDiagramCoords(pozo.coords)) return pozo.coords;
    return null;
}

function getPozoDiagram(pozo) {
    const currentDiagram = (pozo.diagrama || '').toString().trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(zones, currentDiagram)) return currentDiagram;
    return 'sin-asignar';
}

function getSelectedDiagram() {
    const zoneSelect = document.getElementById('zone-select');
    return zoneSelect ? zoneSelect.value : 'bare-tradicional';
}

function getSelectedZone() {
    return getSelectedDiagram();
}

function isKnownDiagram(value) {
    const normalized = (value || '').toString().trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(zones, normalized);
}

function loadImageSize(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

function normalizeStationName(value) {
    return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function getStationDefinitionByName(rawName) {
    const normalized = normalizeStationName(rawName);
    if (!normalized) return null;
    return MAP_STATION_DEFINITIONS.find(def =>
        def.aliases.some(alias => normalizeStationName(alias) === normalized)
    ) || null;
}

async function getDiagramSizeCache() {
    if (diagramSizeCache) return diagramSizeCache;
    const entries = await Promise.all(
        Object.entries(zones).map(async ([diagramKey, url]) => {
            const size = await loadImageSize(url);
            return [diagramKey, size];
        })
    );
    diagramSizeCache = Object.fromEntries(entries.filter(([, size]) => !!size));
    return diagramSizeCache;
}

function inferDiagramFromCoords(coords, sizeCache) {
    if (!isDiagramCoords(coords)) return null;
    const y = Number(coords[0]);
    const x = Number(coords[1]);
    const matches = Object.entries(sizeCache)
        .filter(([, size]) => {
            if (!size) return false;
            return y >= 0 && x >= 0 && y <= size.height && x <= size.width;
        })
        .map(([diagramKey]) => diagramKey);

    return matches.length === 1 ? matches[0] : null;
}

async function migrateLegacyDiagramByCoords(rawPozos) {
    if (!Array.isArray(rawPozos)) {
        return { pozos: [], changed: false };
    }

    const sizeCache = await getDiagramSizeCache();

    let changed = false;
    const migrated = rawPozos.map((pozo) => {
        const nextPozo = { ...pozo };
        const currentDiagram = (nextPozo.diagrama || '').toString().trim().toLowerCase();

        if (isKnownDiagram(currentDiagram)) {
            return nextPozo;
        }

        const diagramCoords = isDiagramCoords(nextPozo.coordsDiagrama)
            ? nextPozo.coordsDiagrama
            : (isDiagramCoords(nextPozo.coords) ? nextPozo.coords : null);
        const inferredDiagram = inferDiagramFromCoords(diagramCoords, sizeCache);
        if (inferredDiagram) {
            nextPozo.diagrama = inferredDiagram;
            changed = true;
            return nextPozo;
        }

        const legacyZone = (nextPozo.zona || '').toString().trim().toLowerCase();
        if (diagramCoords && isKnownDiagram(legacyZone)) {
            // Migración legacy de una sola vez para registros históricos de diagrama.
            nextPozo.diagrama = legacyZone;
            changed = true;
        }
        return nextPozo;
    });

    return { pozos: migrated, changed };
}

function setFormZonaValue(value) {
    const zonaSelect = document.getElementById('form-zona');
    if (!zonaSelect) return;

    const normalizedValue = (value || '').toString().trim().toLowerCase();
    const legacyOption = zonaSelect.querySelector('option[data-legacy-zone="true"]');
    if (legacyOption) {
        legacyOption.remove();
    }

    if (!normalizedValue) {
        zonaSelect.value = '';
        return;
    }

    const existingOption = Array.from(zonaSelect.options).find(option => option.value === normalizedValue);
    if (existingOption) {
        zonaSelect.value = normalizedValue;
        return;
    }

    const option = document.createElement('option');
    option.value = normalizedValue;
    option.textContent = `${normalizedValue} (legacy)`;
    option.dataset.legacyZone = 'true';
    zonaSelect.appendChild(option);
    zonaSelect.value = normalizedValue;
}

function renderActiveMarkers() {
    renderMarkers(getSelectedDiagram());
}

function getMapRenderConfig(totalPozos) {
    if (mapMode !== 'mapa' || !map) {
        return {
            simplified: false,
            showLabels: true,
            showDecorators: true
        };
    }

    const zoom = typeof map.getZoom === 'function' ? map.getZoom() : 0;
    const belowLabelZoom = zoom < MAP_LABEL_MIN_ZOOM;
    const highDensityAtCurrentZoom = totalPozos > MAP_LABEL_DENSITY_LIMIT && zoom < MAP_LABEL_MIN_ZOOM + 1;
    const tooManyMarkers = totalPozos > MAP_SIMPLIFIED_MARKER_LIMIT;
    const simplified = belowLabelZoom || highDensityAtCurrentZoom || tooManyMarkers;

    return {
        simplified,
        showLabels: !simplified,
        showDecorators: !simplified
    };
}

function scheduleMapRender() {
    if (pendingMapRenderFrame !== null) {
        cancelAnimationFrame(pendingMapRenderFrame);
    }

    pendingMapRenderFrame = requestAnimationFrame(() => {
        pendingMapRenderFrame = null;
        renderMarkers('mapa');
    });
}

function getMapViewportBounds() {
    if (mapMode !== 'mapa' || !map || typeof map.getBounds !== 'function') return null;
    return map.getBounds().pad(MAP_VIEWPORT_PAD);
}

function isCoordsInsideViewport(coords, bounds) {
    if (!bounds || !Array.isArray(coords) || coords.length !== 2) return true;
    return bounds.contains(L.latLng(Number(coords[0]), Number(coords[1])));
}

function attachMapEvents() {
    if (!map) return;
    map.on('click', onMapClick);
    map.on('moveend', () => {
        if (mapMode === 'mapa') {
            scheduleMapRender();
        }
    });
}

function closeFloatingPanels(exceptId = null) {
    ['floating-search-input', 'floating-zone-input', 'floating-legend-box'].forEach(id => {
        if (id === exceptId) return;
        const element = document.getElementById(id);
        if (element) {
            element.classList.add('hidden');
        }
    });

    const legendButton = document.getElementById('floating-legend-btn');
    if (legendButton) {
        legendButton.classList.toggle('is-hidden', exceptId === 'floating-legend-box');
    }
}

function updateResponsiveControls() {
    const body = document.body;
    const floatingViewBtn = document.getElementById('floating-view-btn');
    const floatingZoneContainer = document.getElementById('floating-zone-container');
    const mobileMapFilters = document.getElementById('mobile-map-filters');
    if (!floatingViewBtn || !floatingZoneContainer || !mobileMapFilters) return;

    const mobile = !isDesktop();
    const showingMap = mapMode === 'mapa';

    if (body) {
        body.classList.toggle('mobile-map-view', mobile && showingMap);
    }

    floatingViewBtn.textContent = showingMap ? 'DIAGR.' : 'MAPA';
    floatingViewBtn.setAttribute('aria-label', showingMap ? 'Cambiar a vista diagrama' : 'Cambiar a vista mapa');

    floatingZoneContainer.classList.toggle('hidden', !mobile || showingMap);
    mobileMapFilters.classList.toggle('hidden', !mobile || !showingMap);
}

function getRouteStyle(filePath) {
    const fileName = (filePath || '').split('/').pop() || '';
    return MAP_ROUTE_STYLES[fileName] || {
        color: '#8db8ff',
        dashArray: null,
        weight: 2
    };
}

function createRouteLayer(latlngs, style) {
    const baseStyle = {
        lineCap: 'round',
        lineJoin: 'round'
    };
    const outline = L.polyline(latlngs, {
        ...baseStyle,
        color: '#0d1117',
        weight: (style.weight || 2) + 1,
        opacity: 0.2
    });
    const route = L.polyline(latlngs, {
        ...baseStyle,
        color: style.color,
        weight: style.weight || 2,
        opacity: 0.72,
        dashArray: style.dashArray || null
    });
    return L.layerGroup([outline, route]);
}

function applySidebarMode(compact) {
    const compactEnabled = !!compact;
    document.body.classList.toggle('sidebar-compact', compactEnabled);

    const sidebarModeBtn = document.getElementById('sidebar-mode-btn');
    if (!sidebarModeBtn) return;

    sidebarModeBtn.setAttribute('aria-pressed', compactEnabled ? 'true' : 'false');
    sidebarModeBtn.textContent = compactEnabled ? 'Expandir' : 'Compactar';
    sidebarModeBtn.title = compactEnabled ? 'Cambiar a modo expandido' : 'Cambiar a modo compacto';
}

function lonToTileX(lng, zoom) {
    return Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
}

function latToTileY(lat, zoom) {
    const latRad = (lat * Math.PI) / 180;
    return Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom)
    );
}

function buildBareTileUrls(zoomLevels = [12, 13]) {
    const urls = [];
    zoomLevels.forEach(zoom => {
        const minX = lonToTileX(BARE_MAP_BOUNDS.minLng, zoom);
        const maxX = lonToTileX(BARE_MAP_BOUNDS.maxLng, zoom);
        const minY = latToTileY(BARE_MAP_BOUNDS.maxLat, zoom);
        const maxY = latToTileY(BARE_MAP_BOUNDS.minLat, zoom);

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                urls.push(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
            }
        }
    });
    return urls;
}

async function warmBareMapTiles() {
    if (!navigator.onLine || typeof fetch !== 'function') return;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection && connection.saveData) return;

    const tileUrls = buildBareTileUrls();
    await Promise.allSettled(tileUrls.map(url => fetch(url, { mode: 'no-cors' })));
}

function isInsideBareMap(coords) {
    if (!isGeoCoords(coords)) return false;
    const lat = Number(coords[0]);
    const lng = Number(coords[1]);
    return lat >= BARE_MAP_BOUNDS.minLat && lat <= BARE_MAP_BOUNDS.maxLat && lng >= BARE_MAP_BOUNDS.minLng && lng <= BARE_MAP_BOUNDS.maxLng;
}

function pozoNumericKey(value) {
    const compact = (value || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MFB/, '');
    const digits = compact.match(/\d+/g);
    if (!digits || !digits.length) return compact;
    return String(Number(digits.join('')));
}

function findPozosByInput(rawInput) {
    const typed = (rawInput || '').toString().trim().toUpperCase();
    if (!typed) return [];
    const exact = pozoData.filter(pozo => (pozo.id || '').toString().toUpperCase() === typed);
    if (exact.length) return exact;

    const key = pozoNumericKey(typed);
    if (!key) return [];
    return pozoData.filter(pozo => pozoNumericKey(pozo.id) === key);
}

function resolvePozoFromInput(rawInput, preferredZone = null) {
    const typed = (rawInput || '').toString().trim();
    if (!typed) return null;

    const matches = findPozosByInput(typed);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
        const normalizedTyped = normalizeText(typed);
        const exact = matches.find(pozo => normalizeText(pozo.id) === normalizedTyped);
        if (exact) return exact;
        if (preferredZone) {
            const byZone = matches.find(pozo => getPozoDiagram(pozo) === preferredZone);
            if (byZone) return byZone;
        }
        return matches[0];
    }

    const key = pozoNumericKey(typed);
    if (!key) return null;
    const fallbackMatches = pozoData.filter(pozo => {
        const pozoKey = pozoNumericKey(pozo.id);
        return pozoKey === key || pozoKey.endsWith(key) || key.endsWith(pozoKey);
    });
    if (!fallbackMatches.length) return null;
    if (preferredZone) {
        const byZone = fallbackMatches.find(pozo => getPozoDiagram(pozo) === preferredZone);
        if (byZone) return byZone;
    }
    return fallbackMatches[0];
}

function isAssignedToDiagram(pozo) {
    return !!getDiagramCoords(pozo) && getPozoDiagram(pozo) !== 'sin-asignar';
}

function validatePozoForServiceAssignment(pozo) {
    const hasMapAssignment = !!getMapaCoords(pozo) && pozo.vistaMapa !== false;
    const hasDiagramAssignment = isAssignedToDiagram(pozo);

    if (hasMapAssignment && hasDiagramAssignment) {
        return { isValid: true, message: '' };
    }

    if (hasMapAssignment && !hasDiagramAssignment) {
        return {
            isValid: false,
            message: `El pozo ${pozo.id} esta en vista mapa, pero no esta asignado en el diagrama. Asignalo al diagrama antes de asignar el servicio.`
        };
    }

    if (!hasMapAssignment && hasDiagramAssignment) {
        return {
            isValid: false,
            message: `El pozo ${pozo.id} esta en diagrama, pero no esta creado en vista mapa. Debe existir en ambas vistas para asignar servicio.`
        };
    }

    return {
        isValid: false,
        message: `El pozo ${pozo.id} no esta creado en vista mapa ni en vista diagrama. Debe existir en ambas vistas para asignar servicio.`
    };
}

function getAssignablePozosForDiagram() {
    return pozoData
        .filter(pozo => {
            const mapCoords = getMapaCoords(pozo);
            return !!mapCoords && pozo.vistaMapa !== false && !isAssignedToDiagram(pozo);
        })
        .sort((a, b) => pozoNumericKey(a.id).localeCompare(pozoNumericKey(b.id), undefined, { numeric: true }));
}

function closeAssignDiagramForm() {
    const container = document.getElementById('assign-diagram-form-container');
    const form = document.getElementById('assign-diagram-form');
    if (container) container.classList.add('hidden');
    if (form) form.reset();
    pendingDiagramAssignCoords = null;
    pendingDiagramReassignPozoId = null;
}

function openAssignDiagramForm(lat, lng) {
    const input = document.getElementById('assign-diagram-pozo-input');
    const list = document.getElementById('assign-diagram-pozo-list');
    const pointLabel = document.getElementById('assign-diagram-point-label');
    const remaining = document.getElementById('assign-diagram-remaining');
    if (!input || !list || !pointLabel || !remaining) return;

    const reassignPozo = pendingDiagramReassignPozoId
        ? pozoData.find(pozo => pozo.id === pendingDiagramReassignPozoId)
        : null;
    const assignable = reassignPozo ? [reassignPozo] : getAssignablePozosForDiagram();
    list.innerHTML = '';
    input.value = '';
    if (!assignable.length) {
        input.disabled = true;
        input.placeholder = 'No hay pozos pendientes por asignar';
    } else {
        assignable.forEach(pozo => {
            const opt = document.createElement('option');
            opt.value = pozo.id;
            const diagram = getPozoDiagram(pozo);
            const zona = pozo.zona || 'sin zona';
            opt.label = `Diagrama: ${diagram === 'sin-asignar' ? 'sin asignar' : diagram} | Zona: ${zona}`;
            list.appendChild(opt);
        });
        input.disabled = false;
        input.placeholder = 'Ej: 857';
    }

    pointLabel.textContent = `Punto seleccionado: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    if (reassignPozo) {
        remaining.textContent = `Reasignando pozo: ${reassignPozo.id} (se actualiza solo su ubicacion en diagrama)`;
        input.value = reassignPozo.id;
        input.disabled = true;
    } else {
        remaining.textContent = `Pendientes por asignar al diagrama: ${assignable.length}`;
    }
    pendingDiagramAssignCoords = [lat, lng];
    document.getElementById('assign-diagram-form-container').classList.remove('hidden');
}

async function startDiagramReassignFromEdit() {
    if (!requireCrudAuth()) return;
    if (!editId) return;

    const pozo = pozoData.find(p => p.id === editId);
    if (!pozo) {
        alert('Pozo no encontrado');
        return;
    }

    pendingDiagramReassignPozoId = pozo.id;
    closeForm();

    const assignMode = document.getElementById('assign-existing-mode');
    if (assignMode) {
        assignMode.checked = true;
    }
    const editMode = document.getElementById('edit-mode');
    if (editMode) {
        editMode.checked = false;
    }

    if (mapMode !== 'diagram') {
        await applyViewMode('diagram');
    }

    const targetDiagram = getPozoDiagram(pozo);
    if (targetDiagram !== 'sin-asignar') {
        const zoneSelect = document.getElementById('zone-select');
        const mobileZoneSelect = document.getElementById('mobile-zone-select');
        if (zoneSelect) zoneSelect.value = targetDiagram;
        if (mobileZoneSelect) mobileZoneSelect.value = targetDiagram;
        await loadZone(targetDiagram);
        renderMarkers(targetDiagram);
    }

    alert(`Haz click en el nuevo punto del diagrama para reasignar el pozo ${pozo.id}.`);
}

function ensureMapForMode() {
    const mapContainer = document.getElementById('map');
    if (map) {
        map.off();
        map.remove();
        map = null;
    }

    if (mapMode === 'diagram') {
        map = L.map(mapContainer, {
            crs: L.CRS.Simple,
            minZoom: -2,
            maxZoom: 4,
            zoomSnap: 0.25,
            zoomDelta: 0.25
        });
        return;
    }

    map = L.map(mapContainer, {
        minZoom: 11,
        maxZoom: 18,
        preferCanvas: true,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false
    });
}

function buildServiceAliasSet() {
    const map = new Map();
    SERVICE_SEARCH_CONFIG.forEach(item => {
        map.set(normalizeText(item.taladro), item.taladro);
        item.tags.forEach(tag => map.set(normalizeText(tag), item.taladro));
    });
    return map;
}

const serviceAliasMap = buildServiceAliasSet();

function matchServicioFromInput(rawTerm) {
    const term = normalizeText(rawTerm);
    if (!term) return null;

    if (serviceAliasMap.has(term)) {
        return serviceAliasMap.get(term);
    }

    for (const [alias, taladro] of serviceAliasMap.entries()) {
        if (alias.includes(term) || term.includes(alias)) {
            return taladro;
        }
    }
    return null;
}

function findPozoByServicio(taladro) {
    return pozoData.find(pozo => (pozo.taladro || '').toLowerCase() === (taladro || '').toLowerCase()) || null;
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(rawPassword) {
    const value = (rawPassword || '').toString();
    const data = new TextEncoder().encode(value);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(hashBuffer));
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

async function loadAuthConfigFromDb() {
    if (!navigator.onLine || !isDbReady()) return null;
    try {
        const userRef = window.db.collection('usuarios').doc(AUTH_SEED_USER.usuario);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
            const data = userSnap.data() || {};
            if (data.usuario && data.passwordHash) {
                return {
                    usuario: data.usuario,
                    nombre: data.nombre || data.usuario,
                    passwordHash: data.passwordHash
                };
            }
        }
        await userRef.set({
            usuario: AUTH_SEED_USER.usuario,
            nombre: AUTH_SEED_USER.nombre,
            passwordHash: AUTH_SEED_USER.passwordHash
        });
    } catch (e) {
        console.log('No se pudo cargar/crear usuario en Firestore', e);
    }
    return null;
}

async function ensureAuthConfig() {
    const localConfig = await localforage.getItem(AUTH_CONFIG_KEY);
    if (localConfig && localConfig.usuario && localConfig.passwordHash) {
        authConfig = localConfig;
    } else {
        authConfig = { ...AUTH_SEED_USER };
        await localforage.setItem(AUTH_CONFIG_KEY, authConfig);
    }

    const remoteConfig = await loadAuthConfigFromDb();
    if (remoteConfig) {
        authConfig = remoteConfig;
        await localforage.setItem(AUTH_CONFIG_KEY, authConfig);
    }
}

function encodeSessionPayload(payload) {
    return btoa(JSON.stringify(payload));
}

function decodeSessionPayload(encodedPayload) {
    try {
        const json = atob(encodedPayload);
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

async function createSessionToken(usuario) {
    const payload = {
        usuario,
        iat: Date.now()
    };
    const encodedPayload = encodeSessionPayload(payload);
    const signature = await hashPassword(`${encodedPayload}.${authConfig.passwordHash}`);
    return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token) {
    if (!token || typeof token !== 'string' || !authConfig) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const encodedPayload = parts[0];
    const incomingSignature = parts[1];
    const expectedSignature = await hashPassword(`${encodedPayload}.${authConfig.passwordHash}`);
    if (incomingSignature !== expectedSignature) return null;
    return decodeSessionPayload(encodedPayload);
}

async function restoreSession() {
    const session = await localforage.getItem(AUTH_SESSION_KEY);
    if (!session || !session.token || !authConfig) {
        isAuthenticated = false;
        authenticatedUser = null;
        return;
    }
    const payload = await verifySessionToken(session.token);
    if (!payload || payload.usuario !== authConfig.usuario) {
        isAuthenticated = false;
        authenticatedUser = null;
        await localforage.removeItem(AUTH_SESSION_KEY);
        return;
    }
    isAuthenticated = true;
    authenticatedUser = {
        usuario: payload.usuario,
        nombre: session.nombre || authConfig.nombre || payload.usuario
    };
}

function updateAuthUi() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userLabel = document.getElementById('auth-user-label');
    const editSwitch = document.querySelector('.switch');
    const assignButton = document.getElementById('assign-taladro-btn');
    const assignExistingToggle = document.getElementById('assign-existing-toggle');
    const assignExistingMode = document.getElementById('assign-existing-mode');

    if (isDesktop()) {
        if (isAuthenticated && authenticatedUser) {
            loginBtn.classList.add('hidden');
            logoutBtn.classList.remove('hidden');
            userLabel.classList.remove('hidden');
            userLabel.textContent = authenticatedUser.nombre;
            editSwitch.classList.remove('hidden');
            assignButton.classList.remove('hidden');
            assignExistingToggle.classList.remove('hidden');
        } else {
            loginBtn.classList.remove('hidden');
            logoutBtn.classList.add('hidden');
            userLabel.classList.add('hidden');
            userLabel.textContent = '';
            editSwitch.classList.add('hidden');
            assignButton.classList.add('hidden');
            assignExistingToggle.classList.add('hidden');
            document.getElementById('edit-mode').checked = false;
            if (assignExistingMode) assignExistingMode.checked = false;
            closeForm();
            closeAssignForm();
            closeAssignDiagramForm();
            pendingServiceAssignment = null;
            closeServiceVerification();
        }
        return;
    }

    loginBtn.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    userLabel.classList.add('hidden');
    editSwitch.classList.add('hidden');
    assignButton.classList.add('hidden');
    assignExistingToggle.classList.add('hidden');
    document.getElementById('edit-mode').checked = false;
    if (assignExistingMode) assignExistingMode.checked = false;
    closeAssignDiagramForm();
}

async function initAuth() {
    await ensureAuthConfig();
    await restoreSession();
    updateAuthUi();
}

function showLoginError(message) {
    const errorEl = document.getElementById('login-error');
    if (!message) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
        return;
    }
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

function openLoginForm() {
    showLoginError('');
    document.getElementById('login-form-container').classList.remove('hidden');
    document.getElementById('login-username').focus();
}

function closeLoginForm() {
    document.getElementById('login-form-container').classList.add('hidden');
    document.getElementById('login-form').reset();
    showLoginError('');
}

async function submitLogin(e) {
    e.preventDefault();
    if (!authConfig) {
        showLoginError('No hay configuración de usuario disponible');
        return;
    }

    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const incomingHash = await hashPassword(password);

    const isUserMatch = username === (authConfig.usuario || '').toLowerCase();
    const isPasswordMatch = incomingHash === authConfig.passwordHash;
    if (!isUserMatch || !isPasswordMatch) {
        showLoginError('Usuario o contraseña inválidos');
        return;
    }

    isAuthenticated = true;
    authenticatedUser = {
        usuario: authConfig.usuario,
        nombre: authConfig.nombre || authConfig.usuario
    };

    const token = await createSessionToken(authenticatedUser.usuario);
    await localforage.setItem(AUTH_SESSION_KEY, {
        token,
        nombre: authenticatedUser.nombre,
        loginAt: Date.now()
    });

    closeLoginForm();
    updateAuthUi();
    renderMarkers(document.getElementById('zone-select').value);
}

async function logout() {
    isAuthenticated = false;
    authenticatedUser = null;
    await localforage.removeItem(AUTH_SESSION_KEY);
    closeLoginForm();
    updateAuthUi();
    renderMarkers(document.getElementById('zone-select').value);
}

function requireCrudAuth() {
    if (!isDesktop()) {
        return false;
    }
    if (isAuthenticated) {
        return true;
    }
    openLoginForm();
    alert('Debes iniciar sesión para usar funciones de edición');
    return false;
}

async function init() {
    // garantizar que localforage esté listo antes de intentar usarlo
    await ensureLocalForage();
    await initAuth();

    // Cargar datos desde local storage primero
    try {
        const localData = await localforage.getItem(POZO_DATA_KEY);
        if (localData && Array.isArray(localData)) {
            const migration = await migrateLegacyDiagramByCoords(localData);
            pozoData = migration.pozos.map(normalizePozo);
            if (migration.changed) {
                await localforage.setItem(POZO_DATA_KEY, pozoData);
                await markDataDirty();
            }
        } else if (Array.isArray(window.POZOS_SEED) && window.POZOS_SEED.length > 0) {
            // Fallback opcional: snapshot embebido para primer uso offline.
            const migration = await migrateLegacyDiagramByCoords(window.POZOS_SEED);
            pozoData = migration.pozos.map(normalizePozo);
            await localforage.setItem(POZO_DATA_KEY, pozoData);
            if (migration.changed) {
                await markDataDirty();
            } else {
                await clearDataDirty();
            }
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
    const savedMode = await localforage.getItem(MAP_MODE_KEY);
    if (savedMode === 'mapa') {
        mapMode = 'mapa';
    }
    const savedSidebarCompact = await localforage.getItem(SIDEBAR_COMPACT_KEY);
    applySidebarMode(savedSidebarCompact === true);
    attachControls();
    await applyViewMode(mapMode, true);

    // Render inicial usando lo que ya esté en memoria local/remota
    renderActiveMarkers();
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
                const migration = await migrateLegacyDiagramByCoords(doc.data().pozos || []);
                pozoData = migration.pozos.map(normalizePozo);
                await localforage.setItem(POZO_DATA_KEY, pozoData);
                renderActiveMarkers();
                updateDatalist();
                updateStats();
            }
        });
    }

    // Listeners para online/offline
    window.addEventListener('online', syncData);
    window.addEventListener('resize', () => {
        updateAuthUi();
        updateResponsiveControls();
        renderActiveMarkers();
    });

        // Precalentar cache para que la app instalada abra offline de forma robusta.
        warmOfflineResources();

    setupUpdateUi();
}

    async function warmOfflineResources() {
        if (!('caches' in window)) return;
        const resources = [
            '/index.html',
            '/css/styles.css?v=21',
            '/css/leaflet.css',
            '/js/leaflet.js?v=3',
            '/js/localforage.min.js?v=3',
            '/js/main.js?v=28',
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
            '/assets/mapas/Prueba1.gpx',
            '/assets/mapas/2do.gpx',
            '/assets/mapas/trillas.gpx',
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
            'https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js',
            'https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js'
        ];
        try {
            const cache = await caches.open(OFFLINE_CACHE_NAME);
            await Promise.allSettled(resources.map(url => cache.add(url)));
            const scheduleWarmTiles = window.requestIdleCallback
                ? () => window.requestIdleCallback(() => { warmBareMapTiles().catch(() => {}); }, { timeout: 2500 })
                : () => window.setTimeout(() => { warmBareMapTiles().catch(() => {}); }, 1200);
            scheduleWarmTiles();
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
            const migration = await migrateLegacyDiagramByCoords(docSnap.data().pozos || []);
            if (migration.changed) {
                await docRef.set({ pozos: migration.pozos });
            }
            pozoData = migration.pozos.map(normalizePozo);
            await localforage.setItem(POZO_DATA_KEY, pozoData);
            renderActiveMarkers();
            updateDatalist();
            updateStats();
        }
    } catch (e) {
        console.log('Error sincronizando', e);
    }
}

async function setupMap() {
    ensureMapForMode();
    attachMapEvents();
}

async function applyViewMode(mode, skipPersist = false) {
    const nextMode = mode === 'mapa' ? 'mapa' : 'diagram';
    const modeChanged = nextMode !== mapMode;
    mapMode = nextMode;
    const select = document.getElementById('view-mode-select');
    if (select) {
        select.value = mapMode;
    }
    if (!skipPersist) {
        await localforage.setItem(MAP_MODE_KEY, mapMode);
    }
    if (!isDesktop() && mapMode !== 'mapa') {
        currentStatsFilter = 'all';
        currentCategoryFilter = 'all';
    }
    updateStatsFilterUi();
    updateResponsiveControls();

    if (modeChanged) {
        ensureMapForMode();
        attachMapEvents();
        markers = {};
        currentOverlay = null;
    }

    if (mapMode === 'diagram') {
        const diagram = getSelectedDiagram();
        await loadZone(diagram, true);
        renderMarkers(diagram);
        return;
    }

    await loadRealMap();
    renderMarkers('mapa');
}

function clearMapaLayers() {
    mapaLayers.forEach(layer => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    mapaLayers = [];
}

function clearDiagramOverlay() {
    if (currentOverlay && map.hasLayer(currentOverlay)) {
        map.removeLayer(currentOverlay);
    }
    currentOverlay = null;
}

async function loadRealMap() {
    clearDiagramOverlay();

    if (!osmLayer) {
        osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap contributors'
        });
    }
    if (!map.hasLayer(osmLayer)) {
        osmLayer.addTo(map);
    }

    const bounds = L.latLngBounds(
        [BARE_MAP_BOUNDS.minLat, BARE_MAP_BOUNDS.minLng],
        [BARE_MAP_BOUNDS.maxLat, BARE_MAP_BOUNDS.maxLng]
    );
    map.setMaxBounds(bounds.pad(0.2));

    if (!mapaLayers.length) {
        await loadGpxLayers();
    }

    if (mapBounds) {
        map.fitBounds(mapBounds, { padding: [24, 24] });
    } else {
        map.fitBounds(bounds, { padding: [24, 24] });
    }
}

async function loadGpxLayers() {
    const bounds = L.latLngBounds([]);
    const stationsById = new Map();
    try {
        for (let i = 0; i < MAP_ROUTE_FILES.length; i++) {
            const file = MAP_ROUTE_FILES[i];
            const routeStyle = getRouteStyle(file);
            const response = await fetch(file);
            if (!response.ok) {
                console.warn(`No se pudo cargar GPX para vista MAPA: ${file}`);
                continue;
            }
            const xmlText = await response.text();
            const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');

            const trkpts = Array.from(xmlDoc.getElementsByTagName('trkpt'));
            if (trkpts.length) {
                const latlngs = trkpts
                    .map(node => {
                        const lat = Number(node.getAttribute('lat'));
                        const lng = Number(node.getAttribute('lon'));
                        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                        return [lat, lng];
                    })
                    .filter(Boolean);
                if (latlngs.length) {
                    const routeLayer = createRouteLayer(latlngs, routeStyle);
                    routeLayer.addTo(map);
                    mapaLayers.push(routeLayer);
                    bounds.extend(L.latLngBounds(latlngs));
                }
            }

            const waypoints = Array.from(xmlDoc.getElementsByTagName('wpt'));
            waypoints.forEach(node => {
                const lat = Number(node.getAttribute('lat'));
                const lng = Number(node.getAttribute('lon'));
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                const nameNode = node.getElementsByTagName('name')[0];
                const waypointName = nameNode ? (nameNode.textContent || '').trim() : '';
                const stationDef = getStationDefinitionByName(waypointName);
                if (!stationDef || stationsById.has(stationDef.id)) return;
                stationsById.set(stationDef.id, {
                    id: stationDef.id,
                    nombre: stationDef.nombre,
                    coords: [lat, lng],
                    fuente: waypointName || file,
                    colorFondo: stationDef.colorFondo,
                    colorBorde: stationDef.colorBorde,
                    colorIcono: stationDef.colorIcono
                });
            });
        }

        MAP_STATION_DEFINITIONS.forEach(def => {
            const station = stationsById.get(def.id);
            if (!station) return;
            const stationMarker = createStationMarker(station);
            stationMarker.addTo(map);
            mapaLayers.push(stationMarker);
            bounds.extend(station.coords);
        });
    } catch (e) {
        console.log('Error cargando GPX en vista MAPA', e);
    }

    if (bounds.isValid()) {
        mapBounds = bounds;
    }
}

function loadZone(zone, forceReload = false) {
    return new Promise((resolve) => {
        if (mapMode !== 'diagram') {
            resolve();
            return;
        }
        if (!forceReload && currentDiagramZone === zone && currentOverlay) {
            resolve();
            return;
        }
        if (osmLayer && map.hasLayer(osmLayer)) {
            map.removeLayer(osmLayer);
        }
        clearMapaLayers();
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
            map.setMaxBounds([[0 - h * 0.15, 0 - w * 0.15], [h * 1.15, w * 1.15]]);
            map.fitBounds(bounds);
            currentDiagramZone = zone;
            resolve();
        };
    });
}

function updateDatalist(filter = '') {
    const term = normalizeText(filter);
    const list = document.getElementById('pozos-list');
    list.innerHTML = '';

    const pozoMatches = pozoData
        .filter(p => {
            if (!term) return true;
            const inputKey = pozoNumericKey(filter || '');
            return pozoNumericKey(p.id) === inputKey;
        })
        .slice(0, 20);

    const seenValues = new Set();
    pozoMatches.forEach(p => {
        const numeric = pozoNumericKey(p.id);
        if (!numeric || seenValues.has(numeric)) return;
        seenValues.add(numeric);
        const opt = document.createElement('option');
        opt.value = numeric;
        opt.label = `Pozo ${numeric} (${p.id})`;
        list.appendChild(opt);
    });

    SERVICE_SEARCH_CONFIG.forEach(service => {
        const matchesService = !term || service.tags.some(tag => normalizeText(tag).includes(term)) || normalizeText(service.taladro).includes(term);
        if (!matchesService) return;
        const opt = document.createElement('option');
        const primaryAlias = service.tags[0];
        opt.value = `servicio ${primaryAlias}`;
        if (service.taladro === 'WT') {
            opt.label = 'Servicio WT (Well Testing)';
        } else if (service.taladro === 'CT') {
            opt.label = 'Servicio CT (Coiled Tubing / Estimulacion)';
        } else {
            opt.label = `Servicio ${service.taladro}`;
        }
        list.appendChild(opt);
    });
}

function renderMarkers(zone) {
    // eliminar anteriores
    Object.values(markers).forEach(m => map.removeLayer(m));
    markerDecorators.forEach(layer => map.removeLayer(layer));
    markers = {};
    markerDecorators = [];
    const viewportBounds = getMapViewportBounds();

    const visiblePozos = pozoData
        .filter(p => {
            if (mapMode === 'mapa') {
                const coords = getMapaCoords(p);
                return !!coords
                    && isInsideBareMap(coords)
                    && p.vistaMapa !== false
                    && isCoordsInsideViewport(coords, viewportBounds);
            }
            const coords = getDiagramCoords(p);
            return !!coords && getPozoDiagram(p) === zone;
        })
        .filter(matchesCurrentFilter)
        .filter(matchesCurrentCategoryFilter);
    const mapRenderConfig = getMapRenderConfig(visiblePozos.length);

    visiblePozos.forEach(p => {
        const markerCoords = mapMode === 'mapa' ? getMapaCoords(p) : getDiagramCoords(p);
        if (!markerCoords) return;
        const marker = createMarker(p, markerCoords, mapRenderConfig);
        marker.addTo(map);
        const decorators = createMarkerDecorators(p, marker, markerCoords, mapRenderConfig);
        decorators.forEach(layer => {
            layer.addTo(map);
            markerDecorators.push(layer);
        });
        markers[p.id] = marker;
    });
}

function matchesCurrentFilter(pozo) {
    if (currentStatsFilter === 'all') return true;
    if (currentStatsFilter === STATUS.EN_SERVICIO) return !!pozo.taladro;
    return normalizeEstado(pozo.estado) === currentStatsFilter;
}

function matchesCurrentCategoryFilter(pozo) {
    if (currentCategoryFilter === 'all') return true;
    const value = Number(pozo.categoria);
    if (Number.isFinite(value)) {
        return String(value) === currentCategoryFilter;
    }
    const derived = normalizeCategoria(pozo, pozo.taladro ? STATUS.EN_SERVICIO : normalizeEstado(pozo.estado));
    return String(derived) === currentCategoryFilter;
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

function crearIconoCT() {
    if (!resolvedCtIconHtml) {
        const iconClasses = ['fa-flask', 'fa-flask-vial'];
        let selectedClass = null;

        if (typeof document !== 'undefined' && document.body) {
            for (const className of iconClasses) {
                const probe = document.createElement('i');
                probe.className = `fa-solid ${className}`;
                probe.style.position = 'absolute';
                probe.style.opacity = '0';
                probe.style.pointerEvents = 'none';
                document.body.appendChild(probe);
                const content = window.getComputedStyle(probe, '::before').content;
                document.body.removeChild(probe);
                if (content && content !== 'none' && content !== '""') {
                    selectedClass = className;
                    break;
                }
            }
        }

        if (selectedClass) {
            resolvedCtIconHtml = `<i class="fa-solid ${selectedClass}" aria-hidden="true"></i>`;
        } else {
            resolvedCtIconHtml = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 2h4v2l-1 1v4.5l5.2 8.2A2 2 0 0 1 16.5 21h-9a2 2 0 0 1-1.7-3.3L11 9.5V5l-1-1V2zm1.4 9-4 6.3a.5.5 0 0 0 .4.7h8.4a.5.5 0 0 0 .4-.7L12.6 11h-1.2z"/></svg>';
        }
    }

    return L.divIcon({
        html: resolvedCtIconHtml,
        className: 'contenedor-icono-ct',
        iconSize: [16, 16],
        iconAnchor: [8, 16],
        popupAnchor: [0, -16]
    });
}

function createMapNumberIcon(pozoId, color) {
    const label = pozoMapLabel(pozoId);
    return L.divIcon({
        html: `<span class="map-number-marker" style="--marker-color:${color};">${label}</span>`,
        className: 'map-number-marker-wrapper',
        iconSize: [28, 20],
        iconAnchor: [14, 10],
        popupAnchor: [0, -10]
    });
}

function createMarker(p, markerCoords, mapRenderConfig = null) {
    const normalizedEstado = normalizeEstado(p.estado);
    const color =
        normalizedEstado === STATUS.ACTIVO
            ? '#43a047'
            : normalizedEstado === STATUS.INACTIVO_SERVICIO
            ? '#1e88e5'
            : normalizedEstado === STATUS.DIAGNOSTICO
            ? '#f9a825'
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
        } else if (p.taladro === 'CT') {
            icon = crearIconoCT();
        } else {
            // Mapear servicios a colores y números
            const servicioConfig = {
                'Ranger-357': { color: '#000000', numero: 7, borde: '#ffcc00', numeroColor: '#ffcc00' },
                'RIG-351': { color: '#e53935', numero: 1, borde: '#000000', numeroColor: '#ffffff' },
                'RIG-352': { color: '#3388ff', numero: 2, borde: '#000000', numeroColor: '#ffffff' },
                'RIG-RANGER-555': { color: '#00BD3E', numero: null, borde: '#000000', numeroColor: '#ffffff' },
                'Ranger-151': { color: '#ffcc00', numero: null, borde: '#000000', numeroColor: '#ffffff' }
            };
            const config = servicioConfig[p.taladro] || { color: '#000000', numero: null, borde: '#000000', numeroColor: '#ffffff' };
            icon = crearIconoServicio(config.color, config.numero, config.borde, config.numeroColor);
        }
        marker = L.marker(markerCoords, { icon });
    } else {
        if (mapMode === 'mapa') {
            if (mapRenderConfig && mapRenderConfig.showLabels) {
                marker = L.marker(markerCoords, { icon: createMapNumberIcon(p.id, color) });
            } else {
                marker = L.circleMarker(markerCoords, {
                    radius: 5,
                    color: '#ffffff',
                    weight: 1,
                    fillColor: color,
                    fillOpacity: 0.92
                });
            }
        } else {
            // Hacer los marcadores de pozos más sutiles
            marker = L.circleMarker(markerCoords, {
                radius: 4,
                color: color,
                fillColor: color,
                fillOpacity: 0.6,
                weight: 1
            });
        }
    }
    marker.bindPopup(popupContent(p));
    return marker;
}

function createMarkerDecorators(p, marker, markerCoords, mapRenderConfig = null) {
    const layers = [];

    if (mapMode === 'mapa' && mapRenderConfig && !mapRenderConfig.showDecorators) {
        return layers;
    }

    if (hasHighWaterCut(p)) {
        const highWaterCutIcon = L.divIcon({
            html: '<span class="high-water-cut-icon" aria-hidden="true"><svg class="high-water-cut-svg" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 2.6C9.3 6 5.3 10.7 5.3 14.4A6.7 6.7 0 0 0 12 21a6.7 6.7 0 0 0 6.7-6.6c0-3.7-4-8.4-6.7-11.8z"/></svg></span>',
            className: 'high-water-cut-wrapper',
            iconSize: [16, 16],
            iconAnchor: [20, 8]
        });
        const highWaterCutMarker = L.marker(markerCoords, {
            icon: highWaterCutIcon,
            interactive: false,
            keyboard: false,
            zIndexOffset: 1400
        });
        highWaterCutMarker.on('click', () => marker.openPopup());
        layers.push(highWaterCutMarker);
    }

    return layers;
}

function createStationMarker(station) {
    const style = `--station-bg:${station.colorFondo || '#1f2a44'};--station-border:${station.colorBorde || '#f1c40f'};--station-icon:${station.colorIcono || '#f1c40f'};`;
    const icon = L.divIcon({
        html: `<div class="station-marker-icon" style="${style}"><i class="fa-solid fa-industry" aria-hidden="true"></i></div>`,
        className: 'station-marker-wrapper',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
    });

    const marker = L.marker(station.coords, { icon, zIndexOffset: 2000 });
    marker.bindPopup(`<strong>Estacion ${station.nombre}</strong><br>Fuente: ${station.fuente}`);
    return marker;
}

function popupContent(p) {
    const estadoLabelMap = {
        [STATUS.ACTIVO]: 'Activo',
        [STATUS.INACTIVO_SERVICIO]: 'En espera de servicio',
        [STATUS.EN_SERVICIO]: 'En servicio',
        [STATUS.DIAGNOSTICO]: 'En diagnostico',
        [STATUS.CANDIDATO]: 'Candidato',
        [STATUS.DIFERIDO]: 'Diferido'
    };
    const estadoLabel = estadoLabelMap[normalizeEstado(p.estado)] || p.estado;
    const categoriaValue = Number.isFinite(Number(p.categoria)) ? Number(p.categoria) : 'N/A';
    const diagramLabel = getPozoDiagram(p);
    const zonaLabel = p.zona || 'sin zona';
    let content = `<strong>${p.id}</strong><br>
    Diagrama: ${diagramLabel}<br>
    Zona: ${zonaLabel}<br>
    Estado: ${estadoLabel}<br>
    Categoria: ${categoriaValue}`;
    if (p.cabezal) content += `<br>Cabezal: ${p.cabezal}`;
    if (p.variador) content += `<br>Variador: ${p.variador}`;
    if (p.velocidadOperacional !== null && p.velocidadOperacional !== undefined && p.velocidadOperacional !== '') {
        content += `<br>VO: ${p.velocidadOperacional}`;
    }
    if (p.potencial) content += `<br>Potencial: ${p.potencial} barriles`;
    if (hasHighWaterCut(p)) content += '<br>Alto corte de agua: si';
    if (p.taladro) content += `<br>Servicio: ${p.taladro}`;
    if (p.fechaUltimoServicio) content += `<br>Fecha de arranque: ${p.fechaUltimoServicio}`;
    if (p.nota) content += `<br>Nota: ${p.nota}`;
    if (normalizeEstado(p.estado) === STATUS.DIFERIDO && p.causaDiferido) content += `<br>Causa diferido: ${p.causaDiferido}`;
    // Solo mostrar botones CRUD en desktop autenticado
    if (isDesktop() && isAuthenticated) {
        content += `<br><button onclick="editPozo('${p.id}')">Editar</button> <button onclick="deletePozo('${p.id}')">Eliminar</button>`;
    }
    return content;
}

function onMapClick(e) {
    if (mapMode !== 'diagram') return;
    const assignMode = document.getElementById('assign-existing-mode');
    if (assignMode && assignMode.checked) {
        if (!requireCrudAuth()) {
            assignMode.checked = false;
            closeAssignDiagramForm();
            return;
        }
        const { lat, lng } = e.latlng;
        openAssignDiagramForm(lat, lng);
        return;
    }
    if (!document.getElementById('edit-mode').checked) return;
    if (!requireCrudAuth()) return;
    const { lat, lng } = e.latlng;
    openForm(lat, lng);
}

function openForm(lat = null, lng = null, id = null) {
    if (!requireCrudAuth()) return;
    document.getElementById('form-container').classList.remove('hidden');
    const reassignBtn = document.getElementById('form-reassign-diagram');
    const unassignBtn = document.getElementById('form-unassign-diagram');
    const toggleHighWaterCutBtn = document.getElementById('form-toggle-alto-corte');
    if (id) {
        editId = id;
        document.getElementById('form-title').textContent = 'Editar Pozo';
        const p = pozoData.find(p => p.id === id);
        document.getElementById('form-id').value = p.id;
        document.getElementById('form-id').disabled = true;
        const normalizedEstado = p.taladro ? STATUS.EN_SERVICIO : normalizeEstado(p.estado);
        document.getElementById('form-estado').value = normalizedEstado;
        document.getElementById('form-diferido-cause').value = normalizedEstado === STATUS.DIFERIDO ? (p.causaDiferido || '') : '';
        setFormZonaValue(p.zona || '');
        document.getElementById('form-diagrama').value = getPozoDiagram(p);
        document.getElementById('form-nota').value = p.nota || '';
        togglePozoDiferidoCause();
        document.getElementById('form-cabezal').value = p.cabezal || '';
        document.getElementById('form-variador').value = p.variador || '';
        document.getElementById('form-vo').value = p.velocidadOperacional ?? '';
        document.getElementById('form-potencial').value = p.potencial || '';
        document.getElementById('form-alto-corte-agua').checked = !!p.altoCorteAgua;
        document.getElementById('form-fecha-ultimo-servicio').value = p.fechaUltimoServicio || '';
        if (reassignBtn) reassignBtn.classList.remove('hidden');
        if (unassignBtn) unassignBtn.classList.remove('hidden');
        if (toggleHighWaterCutBtn) toggleHighWaterCutBtn.classList.remove('hidden');
        syncHighWaterCutButtonLabel();
        // no setear coords para edición
    } else {
        editId = null;
        document.getElementById('form-title').textContent = 'Nuevo Pozo';
        document.getElementById('form-id').disabled = false;
        document.getElementById('form-lat').value = lat;
        document.getElementById('form-lng').value = lng;
        document.getElementById('form-diferido-cause').value = '';
        setFormZonaValue('');
        document.getElementById('form-diagrama').value = getSelectedDiagram();
        document.getElementById('form-nota').value = '';
        document.getElementById('form-vo').value = '';
        document.getElementById('form-alto-corte-agua').checked = false;
        document.getElementById('form-fecha-ultimo-servicio').value = '';
        if (reassignBtn) reassignBtn.classList.add('hidden');
        if (unassignBtn) unassignBtn.classList.add('hidden');
        if (toggleHighWaterCutBtn) toggleHighWaterCutBtn.classList.add('hidden');
        syncHighWaterCutButtonLabel();
        togglePozoDiferidoCause();
    }
}

function syncHighWaterCutButtonLabel() {
    const toggleHighWaterCutBtn = document.getElementById('form-toggle-alto-corte');
    const highWaterCutInput = document.getElementById('form-alto-corte-agua');
    if (!toggleHighWaterCutBtn || !highWaterCutInput) return;
    toggleHighWaterCutBtn.textContent = highWaterCutInput.checked
        ? 'Quitar gota alto corte'
        : 'Agregar gota alto corte';
}

function toggleHighWaterCutFromEdit() {
    const highWaterCutInput = document.getElementById('form-alto-corte-agua');
    if (!highWaterCutInput) return;
    highWaterCutInput.checked = !highWaterCutInput.checked;
    syncHighWaterCutButtonLabel();
}

function closeForm() {
    console.log('Cerrando form');
    document.getElementById('form-container').classList.add('hidden');
    document.getElementById('pozo-form').reset();
    document.getElementById('form-title').textContent = 'Nuevo Pozo';
    document.getElementById('form-id').disabled = false;
    document.getElementById('form-diferido-cause').value = '';
    setFormZonaValue('');
    document.getElementById('form-diagrama').value = 'sin-asignar';
    document.getElementById('form-nota').value = '';
    document.getElementById('form-vo').value = '';
    document.getElementById('form-alto-corte-agua').checked = false;
    document.getElementById('form-fecha-ultimo-servicio').value = '';
    const reassignBtn = document.getElementById('form-reassign-diagram');
    const unassignBtn = document.getElementById('form-unassign-diagram');
    const toggleHighWaterCutBtn = document.getElementById('form-toggle-alto-corte');
    if (reassignBtn) reassignBtn.classList.add('hidden');
    if (unassignBtn) unassignBtn.classList.add('hidden');
    if (toggleHighWaterCutBtn) toggleHighWaterCutBtn.classList.add('hidden');
    syncHighWaterCutButtonLabel();
    togglePozoDiferidoCause();
    editId = null;
}

async function unassignPozoFromDiagramFromEdit() {
    if (!requireCrudAuth()) return;
    if (!editId) return;

    const pozo = pozoData.find(p => p.id === editId);
    if (!pozo) {
        alert('Pozo no encontrado');
        return;
    }

    const currentDiagram = getPozoDiagram(pozo);
    if (currentDiagram === 'sin-asignar') {
        alert(`El pozo ${pozo.id} ya está sin asignar en diagrama.`);
        return;
    }

    const confirmed = confirm(`¿Desasignar el pozo ${pozo.id} del diagrama ${currentDiagram}?\n\nEl pozo no se eliminará del sistema ni del mapa.`);
    if (!confirmed) {
        return;
    }

    const mapCoords = getMapaCoords(pozo);
    pozo.diagrama = 'sin-asignar';
    pozo.coordsDiagrama = null;
    pozo.coords = mapCoords || null;
    if (mapCoords) {
        pozo.coordsMapa = mapCoords;
    }
    Object.assign(pozo, normalizePozo(pozo));

    await persistPozosAndRefresh();
    updateDatalist();
    closeForm();
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
    if (!requireCrudAuth()) return;
    document.getElementById('assign-form-container').classList.remove('hidden');
}

function closeAssignForm() {
    document.getElementById('assign-form-container').classList.add('hidden');
    document.getElementById('assign-taladro-form').reset();
}

async function assignTaladro(e) {
    e.preventDefault();
    if (!requireCrudAuth()) return;
    const pozoId = document.getElementById('assign-pozo-id').value.trim();
    const taladro = document.getElementById('assign-taladro-select').value;
    const p = resolvePozoFromInput(pozoId, getSelectedDiagram());
    if (!p) {
        alert('Pozo no encontrado');
        return;
    }

    const assignmentValidation = validatePozoForServiceAssignment(p);
    if (!assignmentValidation.isValid) {
        alert(assignmentValidation.message);
        return;
    }

    const previousPozo = pozoData.find(pozo => pozo.taladro === taladro && pozo.id !== p.id);
    if (previousPozo) {
        pendingServiceAssignment = { pozoId: p.id, taladro, previousPozoId: previousPozo.id };
        openServiceVerification(previousPozo.id);
        return;
    }

    p.taladro = taladro;
    p.estado = STATUS.EN_SERVICIO;
    p.causaDiferido = null;
    Object.assign(p, normalizePozo(p));

    await persistPozosAndRefresh();
    closeAssignForm();
}

function unassignTaladroFromAssignForm() {
    if (!requireCrudAuth()) return;
    const pozoId = document.getElementById('assign-pozo-id').value.trim();
    const p = resolvePozoFromInput(pozoId, getSelectedDiagram());
    if (!p) {
        alert('Pozo no encontrado');
        return;
    }

    if (!p.taladro) {
        alert(`El pozo ${p.id} no tiene servicio asignado.`);
        return;
    }

    pendingServiceAssignment = { mode: 'manual-unassign', previousPozoId: p.id };
    openServiceVerification(p.id);
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
    if (!requireCrudAuth()) return;
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

    const { pozoId, taladro, previousPozoId, mode } = pendingServiceAssignment;
    const currentPozo = pozoData.find(pozo => pozo.id === pozoId);
    const previousPozo = pozoData.find(pozo => pozo.id === previousPozoId);

    if (mode === 'manual-unassign') {
        if (!previousPozo) {
            alert('Pozo con servicio no encontrado');
            pendingServiceAssignment = null;
            closeServiceVerification();
            return;
        }

        previousPozo.taladro = null;
        previousPozo.estado = selectedEstado;
        previousPozo.causaDiferido = selectedEstado === STATUS.DIFERIDO ? cause : null;
        Object.assign(previousPozo, normalizePozo(previousPozo));

        pendingServiceAssignment = null;
        await persistPozosAndRefresh();
        closeServiceVerification();
        closeAssignForm();
        return;
    }

    if (!currentPozo) {
        alert('Pozo destino no encontrado');
        pendingServiceAssignment = null;
        closeServiceVerification();
        return;
    }

    const assignmentValidation = validatePozoForServiceAssignment(currentPozo);
    if (!assignmentValidation.isValid) {
        alert(assignmentValidation.message);
        pendingServiceAssignment = null;
        closeServiceVerification();
        return;
    }

    if (previousPozo) {
        previousPozo.taladro = null;
        previousPozo.estado = selectedEstado;
        previousPozo.causaDiferido = selectedEstado === STATUS.DIFERIDO ? cause : null;
        Object.assign(previousPozo, normalizePozo(previousPozo));
    }

    currentPozo.taladro = taladro;
    currentPozo.estado = STATUS.EN_SERVICIO;
    currentPozo.causaDiferido = null;
    Object.assign(currentPozo, normalizePozo(currentPozo));

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
    const diagram = document.getElementById('zone-select').value;
    loadZone(diagram);
    renderMarkers(diagram);
    updateStats();
}

async function submitAssignDiagramForm(e) {
    e.preventDefault();
    if (!requireCrudAuth()) return;
    if (!pendingDiagramAssignCoords) {
        closeAssignDiagramForm();
        return;
    }

    const isReassignFromEdit = !!pendingDiagramReassignPozoId;
    const input = document.getElementById('assign-diagram-pozo-input');
    const typedPozoId = (input && input.value) ? input.value.trim() : '';
    const selectedPozoId = pendingDiagramReassignPozoId || typedPozoId;
    const targetDiagram = getSelectedDiagram();
    const assignable = getAssignablePozosForDiagram();
    const assignableIds = new Set(assignable.map(p => p.id));
    const exactPozo = pozoData.find(p => (p.id || '').toString().toUpperCase() === selectedPozoId.toUpperCase()) || null;
    const resolvedPozo = exactPozo || resolvePozoFromInput(selectedPozoId, targetDiagram) || resolvePozoFromInput(selectedPozoId) || null;
    const pozo = isReassignFromEdit
        ? (pozoData.find(p => p.id === selectedPozoId) || null)
        : (resolvedPozo && assignableIds.has(resolvedPozo.id) ? resolvedPozo : null);

    if (!pozo) {
        alert('Pozo no encontrado en la lista de pendientes. Escribe o selecciona un pozo pendiente valido.');
        return;
    }
    if (!Object.prototype.hasOwnProperty.call(zones, targetDiagram)) {
        alert('Zona inválida');
        return;
    }

    if (isReassignFromEdit) {
        const currentDiagram = getPozoDiagram(pozo);
        const currentCoords = getDiagramCoords(pozo);
        const currentCoordsLabel = currentCoords
            ? `${Number(currentCoords[0]).toFixed(6)}, ${Number(currentCoords[1]).toFixed(6)}`
            : 'sin coordenadas';
        const nextCoordsLabel = `${Number(pendingDiagramAssignCoords[0]).toFixed(6)}, ${Number(pendingDiagramAssignCoords[1]).toFixed(6)}`;
        const diagramLabel = targetDiagram === 'sin-asignar' ? 'sin asignar' : targetDiagram;
        const confirmMessage = `Vas a mover el pozo ${pozo.id}.\n\nOrigen: ${currentDiagram} (${currentCoordsLabel})\nDestino: ${diagramLabel} (${nextCoordsLabel})\n\n¿Confirmas la reasignación?`;
        if (!confirm(confirmMessage)) {
            return;
        }
    }

    pozo.diagrama = targetDiagram;
    pozo.coordsDiagrama = [pendingDiagramAssignCoords[0], pendingDiagramAssignCoords[1]];
    if (pozo.vistaMapa === undefined) {
        pozo.vistaMapa = true;
    }
    Object.assign(pozo, normalizePozo(pozo));

    await persistPozosAndRefresh();
    document.getElementById('zone-select').value = targetDiagram;
    document.getElementById('mobile-zone-select').value = targetDiagram;
    if (mapMode === 'diagram') {
        await loadZone(targetDiagram);
        renderMarkers(targetDiagram);
    }
    closeAssignDiagramForm();
}

// funciones globales para popup
window.editPozo = function(id) {
    if (!requireCrudAuth()) return;
    openForm(null, null, id);
};

window.deletePozo = async function(id) {
    if (!requireCrudAuth()) return;
    if (!confirm('¿Eliminar pozo ' + id + '?')) return;
    pozoData = pozoData.filter(p => p.id !== id);
    // Guardar en local siempre
    await localforage.setItem(POZO_DATA_KEY, pozoData);
    await markDataDirty();
    // Guardar en Firestore solo si está online
    if (navigator.onLine && isDbReady()) {
        await syncData();
    }
    const diagram = document.getElementById('zone-select').value;
    loadZone(diagram);
    renderMarkers(diagram);
    updateStats();
    updateDatalist();
};

async function savePozo(e) {
    e.preventDefault();
    if (!requireCrudAuth()) return;
    const previousPozo = editId ? pozoData.find(p => p.id === editId) : null;
    const formEstado = normalizeEstado(document.getElementById('form-estado').value);
    const formCausaDiferido = document.getElementById('form-diferido-cause').value.trim();
    const formZona = document.getElementById('form-zona').value.trim();
    const formDiagrama = document.getElementById('form-diagrama').value;
    const formNota = document.getElementById('form-nota').value.trim();
    const formVoRaw = document.getElementById('form-vo').value;
    const formVo = formVoRaw === '' ? null : Number(formVoRaw);
    const formHighWaterCut = document.getElementById('form-alto-corte-agua').checked;
    const targetDiagram = Object.prototype.hasOwnProperty.call(zones, formDiagrama) ? formDiagrama : 'sin-asignar';
    const pozo = {
        id: document.getElementById('form-id').value.trim().toUpperCase(),
        zona: formZona || null,
        diagrama: targetDiagram,
        coords: previousPozo ? previousPozo.coords : [
            parseFloat(document.getElementById('form-lat').value),
            parseFloat(document.getElementById('form-lng').value)
        ],
        coordsDiagrama: previousPozo ? (previousPozo.coordsDiagrama || null) : [
            parseFloat(document.getElementById('form-lat').value),
            parseFloat(document.getElementById('form-lng').value)
        ],
        coordsMapa: previousPozo ? (previousPozo.coordsMapa || (isGeoCoords(previousPozo.coords) ? previousPozo.coords : null)) : null,
        estado: formEstado,
        cabezal: document.getElementById('form-cabezal').value || null,
        variador: document.getElementById('form-variador').value || null,
        velocidadOperacional: Number.isFinite(formVo) ? formVo : null,
        potencial: document.getElementById('form-potencial').value || null,
        altoCorteAgua: formHighWaterCut,
        fechaUltimoServicio: document.getElementById('form-fecha-ultimo-servicio').value || null,
        nota: formNota || null,
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
    const normalizedPozo = normalizePozo(pozo);

    if (editId) {
        const index = pozoData.findIndex(p => p.id === editId);
        pozoData[index] = normalizedPozo;
    } else {
        pozoData.push(normalizedPozo);
    }
    // Guardar en local siempre
    await localforage.setItem(POZO_DATA_KEY, pozoData);
    await markDataDirty();
    // Guardar en Firestore solo si está online
    if (navigator.onLine && isDbReady()) {
        await syncData();
    }
    const savedDiagram = getPozoDiagram(normalizedPozo);
    if (savedDiagram !== 'sin-asignar') {
        loadZone(savedDiagram);
        renderMarkers(savedDiagram);
        document.getElementById('zone-select').value = savedDiagram;
        document.getElementById('mobile-zone-select').value = savedDiagram;
    } else {
        renderActiveMarkers();
    }
    updateDatalist();
    updateStats();
    console.log('Pozo guardado:', normalizedPozo);
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
        diferido: 0,
        categoria1: 0,
        categoria2: 0,
        categoria3: 0
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

        const categoria = Number(p.categoria);
        if (categoria === 1) counts.categoria1++;
        if (categoria === 2) counts.categoria2++;
        if (categoria === 3) counts.categoria3++;
    });

    document.getElementById('count-total').textContent = counts.total;
    document.getElementById('count-active').textContent = counts.activo;
    document.getElementById('count-inactive-service').textContent = counts['inactivo-servicio'];
    document.getElementById('count-in-service').textContent = counts['en-servicio'];
    document.getElementById('count-diagnostic').textContent = counts.diagnostico;
    document.getElementById('count-candidate').textContent = counts.candidato;
    document.getElementById('count-deferred').textContent = counts.diferido;
    const countCategory1 = document.getElementById('count-category-1');
    const countCategory2 = document.getElementById('count-category-2');
    const countCategory3 = document.getElementById('count-category-3');
    if (countCategory1) countCategory1.textContent = counts.categoria1;
    if (countCategory2) countCategory2.textContent = counts.categoria2;
    if (countCategory3) countCategory3.textContent = counts.categoria3;
    updateFloatingLegendCounts(counts);
}

function updateFloatingLegendCounts(counts) {
    const statusCountMap = {
        activo: counts.activo,
        'inactivo-servicio': counts['inactivo-servicio'],
        'en-servicio': counts['en-servicio'],
        diagnostico: counts.diagnostico,
        candidato: counts.candidato,
        diferido: counts.diferido
    };

    Object.entries(statusCountMap).forEach(([status, value]) => {
        const item = document.querySelector(`[data-legend-status="${status}"] .legend-count`);
        if (item) item.textContent = `(${value})`;
    });

    const categoryCountMap = {
        1: counts.categoria1,
        2: counts.categoria2,
        3: counts.categoria3
    };

    Object.entries(categoryCountMap).forEach(([category, value]) => {
        const item = document.querySelector(`[data-legend-category="${category}"] .legend-count`);
        if (item) item.textContent = `(${value})`;
    });
}

function updateStatsFilterUi() {
    document.querySelectorAll('[data-filter-type="status"]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.filter === currentStatsFilter);
    });
    document.querySelectorAll('[data-filter-type="category"]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.category === currentCategoryFilter);
    });
    updateResponsiveControls();
}

function applyStatsFilter(filter) {
    currentStatsFilter = filter;
    updateStatsFilterUi();
    renderActiveMarkers();
}

function applyCategoryFilter(filter) {
    currentCategoryFilter = filter;
    updateStatsFilterUi();
    renderActiveMarkers();
}

async function runSearchById(rawId, clearMobileInput = false) {
    const rawValue = (rawId || '').trim();
    const typedValue = rawValue.toUpperCase();
    if (!rawValue) return;

    const isServiceHint = normalizeText(rawValue).startsWith('servicio ');
    const cleanedForService = isServiceHint ? rawValue.replace(/^\s*servicio\s+/i, '') : rawValue;

    let targetPozo = null;
    if (!isServiceHint) {
        const matches = findPozosByInput(typedValue);
        if (matches.length > 1) {
            const currentZone = document.getElementById('zone-select').value;
            targetPozo = matches.find(pozo => getPozoDiagram(pozo) === currentZone) || matches[0];
        } else {
            targetPozo = matches[0] || null;
        }
    }

    if (!targetPozo) {
        const taladro = matchServicioFromInput(cleanedForService);
        if (taladro) {
            targetPozo = findPozoByServicio(taladro);
            if (!targetPozo) {
                alert(`No hay pozo asignado al servicio ${taladro}`);
            }
        }
    }

    if (!targetPozo) {
        return;
    }

    searchId = targetPozo.id;
    if (currentStatsFilter !== 'all' && !matchesCurrentFilter(targetPozo)) {
        currentStatsFilter = 'all';
        updateStatsFilterUi();
    }
    if (currentCategoryFilter !== 'all' && !matchesCurrentCategoryFilter(targetPozo)) {
        currentCategoryFilter = 'all';
        updateStatsFilterUi();
    }
    if (mapMode === 'diagram') {
        const targetDiagram = getPozoDiagram(targetPozo);
        if (targetDiagram !== 'sin-asignar') {
            document.getElementById('zone-select').value = targetDiagram;
            document.getElementById('mobile-zone-select').value = targetDiagram;
            await loadZone(targetDiagram);
            renderMarkers(targetDiagram);
        } else {
            renderActiveMarkers();
        }
    } else {
        await loadRealMap();
        renderMarkers('mapa');
    }

    if (markers[searchId]) {
        const targetCoords = mapMode === 'mapa' ? getMapaCoords(targetPozo) : getDiagramCoords(targetPozo);
        if (targetCoords) {
            const targetZoom = mapMode === 'mapa' ? Math.max(map.getZoom(), 15) : Math.max(map.getZoom(), 2);
            map.flyTo(targetCoords, targetZoom);
        }
        markers[searchId].openPopup();
    }

    searchId = null;

    if (clearMobileInput) {
        document.getElementById('floating-search-input').classList.add('hidden');
        document.getElementById('mobile-search').value = '';
    }
}

function setupUpdateUi() {
    const UPDATE_APPLIED_KEY = 'sw-update-applied-version';
    const toast = document.getElementById('update-toast');
    const updateText = document.getElementById('update-toast-text');
    const updateNowBtn = document.getElementById('update-now-btn');
    const updateLaterBtn = document.getElementById('update-later-btn');
    const updateFab = document.getElementById('update-fab');

    if (!toast || !updateNowBtn || !updateLaterBtn || !updateFab) {
        return;
    }

    updateText.textContent = `Nueva actualización disponible (${APP_VERSION}). ¿Desea actualizar ahora?`;
    updateFab.textContent = `Actualización disponible (${APP_VERSION})`;

    const showToast = (message) => {
        if (message) {
            updateText.textContent = message;
        }
        toast.classList.remove('hidden');
        updateFab.classList.add('hidden');
    };

    const showFab = () => {
        toast.classList.add('hidden');
        updateFab.classList.remove('hidden');
    };

    const applyUpdate = () => {
        sessionStorage.setItem(UPDATE_APPLIED_KEY, APP_VERSION);
        if (typeof window.__applyServiceWorkerUpdate === 'function') {
            window.__applyServiceWorkerUpdate();
            return;
        }
        window.location.reload();
    };

    const showUpdatedToast = (version) => {
        updateNowBtn.classList.add('hidden');
        updateLaterBtn.classList.add('hidden');
        updateFab.classList.add('hidden');
        showToast(`Aplicación actualizada correctamente (${version}).`);
        window.setTimeout(() => {
            toast.classList.add('hidden');
        }, 3500);
    };

    const showPromptActions = () => {
        updateNowBtn.classList.remove('hidden');
        updateLaterBtn.classList.remove('hidden');
    };

    const appliedVersion = sessionStorage.getItem(UPDATE_APPLIED_KEY);
    if (appliedVersion) {
        sessionStorage.removeItem(UPDATE_APPLIED_KEY);
        showUpdatedToast(appliedVersion);
    }

    updateNowBtn.addEventListener('click', applyUpdate);
    updateLaterBtn.addEventListener('click', showFab);
    updateFab.addEventListener('click', () => showToast());

    const handleUpdateAvailable = () => {
        showPromptActions();
        showToast(`Nueva actualización disponible (${APP_VERSION}). ¿Desea actualizar ahora?`);
    };

    window.addEventListener('sw-update-available', handleUpdateAvailable);

    if (window.__swUpdateAvailable) {
        handleUpdateAvailable();
    }
}

function attachControls() {
    const sidebarModeBtn = document.getElementById('sidebar-mode-btn');
    if (sidebarModeBtn) {
        sidebarModeBtn.addEventListener('click', async () => {
            const compactEnabled = !document.body.classList.contains('sidebar-compact');
            applySidebarMode(compactEnabled);
            await localforage.setItem(SIDEBAR_COMPACT_KEY, compactEnabled);
        });
    }

    document.getElementById('zone-select').addEventListener('change', async e => {
        if (mapMode !== 'diagram') return;
        await loadZone(e.target.value);
        renderMarkers(e.target.value);
    });

    const viewModeSelect = document.getElementById('view-mode-select');
    if (viewModeSelect) {
        viewModeSelect.addEventListener('change', async (e) => {
            await applyViewMode(e.target.value);
        });
    }

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
    document.getElementById('form-toggle-alto-corte').addEventListener('click', toggleHighWaterCutFromEdit);
    document.getElementById('form-alto-corte-agua').addEventListener('change', syncHighWaterCutButtonLabel);

    document.getElementById('edit-mode').addEventListener('change', (e) => {
        if (e.target.checked && !requireCrudAuth()) {
            e.target.checked = false;
        }
    });

    document.getElementById('assign-taladro-btn').addEventListener('click', openAssignForm);
    document.getElementById('assign-taladro-form').addEventListener('submit', assignTaladro);
    document.getElementById('assign-unassign-btn').addEventListener('click', unassignTaladroFromAssignForm);
    document.getElementById('assign-cancel').addEventListener('click', closeAssignForm);
    const assignExistingMode = document.getElementById('assign-existing-mode');
    if (assignExistingMode) {
        assignExistingMode.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (!requireCrudAuth()) {
                    e.target.checked = false;
                    return;
                }
                document.getElementById('edit-mode').checked = false;
            }
            if (!e.target.checked) {
                closeAssignDiagramForm();
            }
        });
    }
    document.getElementById('assign-diagram-form').addEventListener('submit', submitAssignDiagramForm);
    document.getElementById('assign-diagram-cancel').addEventListener('click', closeAssignDiagramForm);
    document.getElementById('form-reassign-diagram').addEventListener('click', startDiagramReassignFromEdit);
    document.getElementById('form-unassign-diagram').addEventListener('click', unassignPozoFromDiagramFromEdit);
    document.getElementById('service-verification-form').addEventListener('submit', submitServiceVerification);
    document.getElementById('verification-cancel').addEventListener('click', () => {
        pendingServiceAssignment = null;
        closeServiceVerification();
    });
    document.querySelectorAll('input[name="verification-estado"]').forEach(input => {
        input.addEventListener('change', toggleVerificationCause);
    });

    document.getElementById('login-btn').addEventListener('click', openLoginForm);
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('login-form').addEventListener('submit', submitLogin);
    document.getElementById('login-cancel').addEventListener('click', closeLoginForm);

    // Botón flotante de búsqueda para móvil
    document.getElementById('floating-search-btn').addEventListener('click', () => {
        const inputDiv = document.getElementById('floating-search-input');
        const shouldShow = inputDiv.classList.contains('hidden');
        closeFloatingPanels(shouldShow ? 'floating-search-input' : null);
        inputDiv.classList.toggle('hidden', !shouldShow);
    });

    document.getElementById('mobile-search-btn').addEventListener('click', async () => {
        await runSearchById(document.getElementById('mobile-search').value, true);
    });

    document.getElementById('mobile-search').addEventListener('input', (e) => {
        updateDatalist(e.target.value);
    });

    document.getElementById('mobile-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('mobile-search-btn').click();
        }
    });

    // Botón flotante de zona para móvil
    document.getElementById('floating-zone-btn').addEventListener('click', () => {
        const inputDiv = document.getElementById('floating-zone-input');
        const shouldShow = inputDiv.classList.contains('hidden');
        closeFloatingPanels(shouldShow ? 'floating-zone-input' : null);
        inputDiv.classList.toggle('hidden', !shouldShow);
    });

    const floatingViewBtn = document.getElementById('floating-view-btn');
    if (floatingViewBtn) {
        floatingViewBtn.addEventListener('click', async () => {
            closeFloatingPanels();
            await applyViewMode(mapMode === 'mapa' ? 'diagram' : 'mapa');
        });
    }

    const floatingLegendBtn = document.getElementById('floating-legend-btn');
    const floatingLegendBox = document.getElementById('floating-legend-box');

    floatingLegendBtn.addEventListener('click', () => {
        const shouldShow = floatingLegendBox.classList.contains('hidden');
        if (shouldShow) {
            closeFloatingPanels('floating-legend-box');
            floatingLegendBox.classList.remove('hidden');
            return;
        }
        floatingLegendBox.classList.add('hidden');
        floatingLegendBtn.classList.remove('is-hidden');
    });

    const hideFloatingLegend = () => {
        floatingLegendBox.classList.add('hidden');
        floatingLegendBtn.classList.remove('is-hidden');
    };

    floatingLegendBox.addEventListener('click', hideFloatingLegend);
    floatingLegendBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            hideFloatingLegend();
        }
    });

    document.getElementById('mobile-zone-select').addEventListener('change', async (e) => {
        if (mapMode !== 'diagram') return;
        const zona = e.target.value;
        document.getElementById('zone-select').value = zona;
        await loadZone(zona);
        renderMarkers(zona);
        document.getElementById('floating-zone-input').classList.add('hidden');
    });

    document.querySelectorAll('[data-filter-type="status"]').forEach(btn => {
        btn.addEventListener('click', () => {
            applyStatsFilter(btn.dataset.filter || 'all');
        });
    });

    document.querySelectorAll('[data-filter-type="category"]').forEach(btn => {
        btn.addEventListener('click', () => {
            applyCategoryFilter(btn.dataset.category || 'all');
        });
    });

    updateStatsFilterUi();
    updateResponsiveControls();
}

// para depuración
window.debug = { pozoData, markers, map };
