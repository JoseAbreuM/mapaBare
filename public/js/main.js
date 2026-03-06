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
    // Definimos el SVG dentro de una cadena de texto (template literal)
    let svgTorre = `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="svg-taladro">
            <style>
                .svg-taladro path, .svg-taladro line, .svg-taladro rect {
                    stroke: ${colorPrincipal};
                    fill: none;
                }
                .svg-taladro rect {
                    fill: ${colorPrincipal};
                }
                .svg-taladro {
                    filter: drop-shadow(0 0 2px rgba(255,255,255,0.5));
                }
                .numero-taladro {
                    fill: white;
                    font-size: 12px;
                    font-weight: bold;
                    text-anchor: middle;
                }
            </style>
            <path d="M10 90 L40 10 L60 10 L90 90 Z" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="25" y1="50" x2="75" y2="50" stroke-width="4"/>
            <line x1="18" y1="70" x2="82" y2="70" stroke-width="4"/>
            <rect x="5" y="85" width="90" height="10" rx="2" stroke-width="4"/>
            <rect x="42" y="5" width="16" height="8" rx="1" stroke-width="2"/>
    `;
    
    if (numero !== null) {
        svgTorre += `<text x="50" y="75" class="numero-taladro">${numero}</text>`;
    }
    
    svgTorre += `</svg>`;

    return L.divIcon({
        html: svgTorre,
        className: 'contenedor-icono-taladro',
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
    });
}

// Función para crear el icono de gotas (droplets) para WT
function crearIconoWT() {
    const svgDroplets = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="svg-wt">
            <style>
                .svg-wt path {
                    fill: #000000;
                }
                .svg-wt {
                    filter: drop-shadow(0 0 2px rgba(255,255,255,0.5));
                }
            </style>
            <path d="M12 21.5c.5 0 .9-.4.9-.9V18c0-.5-.4-.9-.9-.9s-.9.4-.9.9v2.6c0 .5.4.9.9.9z"/>
            <path d="M12 2.5c-2.8 0-5 2.2-5 5 0 1.4.6 2.7 1.7 3.6L12 16l3.3-4.9c1.1-.9 1.7-2.2 1.7-3.6 0-2.8-2.2-5-5-5z"/>
            <path d="M7 9.5c-.5 0-.9.4-.9.9s.4.9.9.9c.8 0 1.5-.7 1.5-1.5S7.8 9.5 7 9.5z"/>
            <path d="M17 9.5c-.8 0-1.5.7-1.5 1.5s.7 1.5 1.5 1.5c.5 0 .9-.4.9-.9s-.4-.9-.9-.9z"/>
        </svg>
    `;

    return L.divIcon({
        html: svgDroplets,
        className: 'contenedor-icono-wt',
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -30]
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
        marker = L.circleMarker(p.coords, {
            radius: 6,
            color: color,
            fillColor: color,
            fillOpacity: 1
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
