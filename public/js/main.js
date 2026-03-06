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
        const localData = await localforage.getItem('pozoData');
        if (localData) {
            pozoData = localData;
            renderMarkers(document.getElementById('zone-select').value);
            updateDatalist();
            updateStats();
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

    // Si está online, cargar desde Firestore y actualizar local
    if (navigator.onLine) {
        try {
            const docRef = db.collection('pozos').doc('data');
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                pozoData = docSnap.data().pozos || [];
                await localforage.setItem('pozoData', pozoData);
                renderMarkers(document.getElementById('zone-select').value);
                updateDatalist();
                updateStats();
            }
        } catch (e) {
            console.log('Error cargando desde Firestore', e);
        }
    }

    // Listener para actualizaciones en tiempo real si está online
    if (navigator.onLine) {
        const docRef = db.collection('pozos').doc('data');
        docRef.onSnapshot(async (doc) => {
            if (doc.exists) {
                pozoData = doc.data().pozos || [];
                await localforage.setItem('pozoData', pozoData);
                renderMarkers(document.getElementById('zone-select').value);
                updateDatalist();
                updateStats();
            }
        });
    }

    await setupMap();
    attachControls();

    // Listeners para online/offline
    window.addEventListener('online', syncData);
}

async function syncData() {
    try {
        const docRef = db.collection('pozos').doc('data');
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            pozoData = docSnap.data().pozos || [];
            await localforage.setItem('pozoData', pozoData);
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

    pozoData.filter(p => p.zona === zone).forEach(p => {
        const marker = createMarker(p);
        marker.addTo(map);
        markers[p.id] = marker;
    });
}

// Función para crear el icono de la torre con color personalizado y número opcional
function crearIconoTaladro(colorPrincipal, numero = null) {
    // Cargar el SVG del archivo oil-derrick.svg y modificarlo
    const svgDerrick = `
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 76" class="derrick-svg" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round">
            <style>
                .derrick-svg path, .derrick-svg g {
                    stroke: ${colorPrincipal} !important;
                    fill: ${colorPrincipal} !important;
                }
                .derrick-svg {
                    filter: drop-shadow(0 0 1px rgba(255,255,255,0.3));
                }
                .numero-taladro {
                    fill: white;
                    font-size: 8px;
                    font-weight: bold;
                    text-anchor: middle;
                    dominant-baseline: middle;
                }
            </style>
            <use xlink:href="#A" x=".5" y=".5"/>
            <symbol id="A" overflow="visible">
                <g class="derrick-structure">
                    <path d="M31.695 62.1l-.225-1.485h.48V62.1h-.255m-11.76 0v-1.5h9.585l.18 1.485h-9.765M8.64 62.1l.195-1.485h9.045V62.1H8.64m-3.615 0v-1.5h1.83l-.225 1.485H5.025m12.87 2.49v-8.79h2.04v8.79h-2.04m0-9.99V49.23h2.055v5.355h-2.055m0-6.555v-5.37h2.04v5.37h-2.04m0-6.57v-5.385h2.04v5.385h-2.04m0-6.555v-5.37h2.04v5.37h-2.04m0-6.555v-5.37h2.025v5.37h-2.025m0-6.54v-5.385h2.025v5.385h-2.025m0-6.57V1.965h2.025v13.29l-2.025-.015"/>
                    <path d="M27.78 7.11V5.28H10.125v1.83z"/>
                    <path d="M28.8 55.17v-.585h-.06l-.75-5.88v-.675h-.09l-.735-5.955v-.6h-.075l-.765-6.03v-.54h-.075l-.75-5.895v-.63h-.075l-.765-6v-.57h-.06l-.78-6.075v-.495h-.06l-1.05-8.385.735-.525 8.595 58.005-2.055.24L28.8 55.17M6.315 64.335l8.61-58.005.735.525-1.065 8.385h-.075v.645l-.75 5.925h-.075v.525l-.765 6.045h-.075v.54l-.75 5.985h-.09v.63l-.735 5.94h-.09v.675l-.75 5.88h-.075v.555l-.75 6H9.54v.615l-1.2 9.375-2.025-.24"/>
                    <path d="M22.23 1.425V0h-6.285v1.425h-5.82v1.77H27.78v-1.77zM14.52 16.41v-1.17h9.3v1.17h-9.3m-.825 6.555V21.81H24.66v1.155H13.695m-.84 6.57V28.38H25.5v1.155H12.855m-.84 6.555v-1.185h14.31v1.185h-14.31m-.825 6.57v-1.185h15.975v1.185H11.19m-.825 6.555V48.03H27.99v1.185H10.365m-.825 6.57v-1.2H28.8v1.2H9.54M0 64.17h38.325V75H0z"/>
                </g>
            </symbol>
    `;
    
    let fullSvg = svgDerrick;
    if (numero !== null) {
        fullSvg += `<text x="20" y="35" class="numero-taladro">${numero}</text>`;
    }
    fullSvg += `</svg>`;

    return L.divIcon({
        html: fullSvg,
        className: 'contenedor-icono-taladro',
        iconSize: [20, 20],
        iconAnchor: [10, 20],
        popupAnchor: [0, -20]
    });
}

// Función para crear el icono de gotas (droplets) para WT
function crearIconoWT() {
    const svgDroplets = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-droplets-icon lucide-droplets">
            <style>
                .lucide-droplets path {
                    stroke: #000000;
                    fill: #0066cc;
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
        iconSize: [18, 18],
        iconAnchor: [9, 18],
        popupAnchor: [0, -18]
    });
}

function createMarker(p) {
    const color =
        p.estado === 'activo'
            ? '#43a047'
            : p.estado === 'inactivo'
            ? '#e53935'
            : '#fb8c00';
    let marker;
    if (p.taladro) {
        let icon;
        if (p.taladro === 'WT') {
            icon = crearIconoWT();
        } else {
            // Mapear taladros a colores y números
            const taladroConfig = {
                'Ranger-357': { color: '#000000', numero: 7 },
                'RIG-351': { color: '#e53935', numero: 1 },
                'RIG-352': { color: '#3388ff', numero: 2 },
                'Ranger-151': { color: '#fb8c00', numero: null }
            };
            const config = taladroConfig[p.taladro] || { color: '#000000', numero: null };
            icon = crearIconoTaladro(config.color, config.numero);
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
    let content = `<strong>${p.id}</strong><br>
    Zona: ${p.zona}<br>
    Estado: ${p.estado}`;
    if (p.cabezal) content += `<br>Cabezal: ${p.cabezal}`;
    if (p.variador) content += `<br>Variador: ${p.variador}`;
    if (p.potencial) content += `<br>Potencial: ${p.potencial} barriles`;
    if (p.taladro) content += `<br>Taladro: ${p.taladro}`;
    // Solo mostrar botones de editar/eliminar en desktop
    if (window.innerWidth > 600) {
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
        document.getElementById('form-estado').value = p.estado;
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
    }
}

function closeForm() {
    console.log('Cerrando form');
    document.getElementById('form-container').classList.add('hidden');
    document.getElementById('pozo-form').reset();
    document.getElementById('form-title').textContent = 'Nuevo Pozo';
    document.getElementById('form-id').disabled = false;
    editId = null;
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
    const p = pozoData.find(p => p.id === pozoId);
    if (!p) {
        alert('Pozo no encontrado');
        return;
    }
    // quitar taladro de cualquier otro pozo y setear a activo
    pozoData.forEach(pozo => {
        if (pozo.taladro === taladro && pozo.id !== pozoId) {
            pozo.taladro = null;
            pozo.estado = 'activo';
        }
    });
    p.taladro = taladro;
    p.estado = 'inactivo';
    // Guardar en local siempre
    await localforage.setItem('pozoData', pozoData);
    // Guardar en Firestore solo si está online
    if (navigator.onLine) {
        await db.collection('pozos').doc('data').set({ pozos: pozoData });
    }
    const zone = document.getElementById('zone-select').value;
    loadZone(zone);
    renderMarkers(zone);
    updateStats();
    closeAssignForm();
}

// funciones globales para popup
window.editPozo = function(id) {
    openForm(null, null, id);
};

window.deletePozo = async function(id) {
    if (!confirm('¿Eliminar pozo ' + id + '?')) return;
    pozoData = pozoData.filter(p => p.id !== id);
    // Guardar en local siempre
    await localforage.setItem('pozoData', pozoData);
    // Guardar en Firestore solo si está online
    if (navigator.onLine) {
        await db.collection('pozos').doc('data').set({ pozos: pozoData });
    }
    const zone = document.getElementById('zone-select').value;
    loadZone(zone);
    renderMarkers(zone);
    updateStats();
    updateDatalist();
};

async function savePozo(e) {
    e.preventDefault();
    const pozo = {
        id: document.getElementById('form-id').value.trim().toUpperCase(),
        zona: document.getElementById('zone-select').value,
        coords: editId ? pozoData.find(p => p.id === editId).coords : [
            parseFloat(document.getElementById('form-lat').value),
            parseFloat(document.getElementById('form-lng').value)
        ],
        estado: document.getElementById('form-estado').value,
        cabezal: document.getElementById('form-cabezal').value || null,
        variador: document.getElementById('form-variador').value || null,
        potencial: document.getElementById('form-potencial').value || null,
        taladro: editId ? pozoData.find(p => p.id === editId).taladro : null
    };
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
    await localforage.setItem('pozoData', pozoData);
    // Guardar en Firestore solo si está online
    if (navigator.onLine) {
        await db.collection('pozos').doc('data').set({ pozos: pozoData });
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
    const counts = { activo: 0, inactivo: 0, revision: 0 };
    pozoData.forEach(p => counts[p.estado]++);
    document.getElementById('count-active').textContent = counts.activo;
    document.getElementById('count-inactive').textContent = counts.inactivo;
    document.getElementById('count-review').textContent = counts.revision;
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
    search.addEventListener('change', e => {
        const id = e.target.value.trim().toUpperCase();
        const p = pozoData.find(p => p.id === id);
        if (p) {
            searchId = id;
            document.getElementById('zone-select').value = p.zona;
            loadZone(p.zona);
        }
    });

    document.getElementById('pozo-form').addEventListener('submit', savePozo);
    document.getElementById('form-cancel').addEventListener('click', closeForm);

    document.getElementById('assign-taladro-btn').addEventListener('click', openAssignForm);
    document.getElementById('assign-taladro-form').addEventListener('submit', assignTaladro);
    document.getElementById('assign-cancel').addEventListener('click', closeAssignForm);

    // Botón flotante de búsqueda para móvil
    document.getElementById('floating-search-btn').addEventListener('click', () => {
        const inputDiv = document.getElementById('floating-search-input');
        inputDiv.classList.toggle('hidden');
        // Cerrar zona si está abierta
        document.getElementById('floating-zone-input').classList.add('hidden');
    });

    document.getElementById('mobile-search-btn').addEventListener('click', async () => {
        const id = document.getElementById('mobile-search').value.trim().toUpperCase();
        const p = pozoData.find(p => p.id === id);
        if (p) {
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
        }
        document.getElementById('floating-search-input').classList.add('hidden');
        document.getElementById('mobile-search').value = '';
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
}

// para depuración
window.debug = { pozoData, markers, map };
