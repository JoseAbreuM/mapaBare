// lógica principal de la PWA de pozos

let map;
let currentOverlay;
const zones = {
    'bare-tradicional': 'assets/mapas/bare-tradicional.jpg',
    'bare-6-1': 'assets/mapas/bare6-1.jpg',
    'bare-6-2': 'assets/mapas/bare6-2.jpg',
    'trilla-asfaltada': 'assets/mapas/trilla-asfaltada.jpg',
};

let pozoData = [];
let markers = {};
let searchId = null;
let editId = null;

window.addEventListener('DOMContentLoaded', init);

async function init() {
    // cargar datos desde Firestore
    const docRef = db.collection('pozos').doc('data');
    const docSnap = await docRef.get();
    if (docSnap.exists) {
        pozoData = docSnap.data().pozos || [];
    } else {
        pozoData = [];
    }

    // listener para cambios en tiempo real
    docRef.onSnapshot((doc) => {
        if (doc.exists) {
            pozoData = doc.data().pozos || [];
            renderMarkers(document.getElementById('zone-select').value);
            updateDatalist();
            updateStats();
        }
    });

    setupMap();
    renderMarkers(document.getElementById('zone-select').value);
    attachControls();
}

function setupMap() {
    map = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: -2
    });

    loadZone(document.getElementById('zone-select').value);

    map.on('click', onMapClick);
}

function loadZone(zone) {
    if (currentOverlay) {
        map.removeLayer(currentOverlay);
    }
    const url = zones[zone];
    if (!url) return;
    const img = new Image();
    img.src = url;
    img.onload = () => {
        const w = img.width;
        const h = img.height;
        const bounds = [[0, 0], [h, w]];
        currentOverlay = L.imageOverlay(url, bounds).addTo(map);
        map.setMaxBounds(bounds);
        map.fitBounds(bounds);
        renderMarkers(zone);
        if (searchId && markers[searchId]) {
            const p = pozoData.find(p => p.id === searchId);
            map.flyTo(p.coords, Math.max(map.getZoom(), 2));
            markers[searchId].openPopup();
            searchId = null;
        }
    };
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

function createMarker(p) {
    const color =
        p.estado === 'activo'
            ? '#43a047'
            : p.estado === 'inactivo'
            ? '#e53935'
            : '#fb8c00';
    let marker;
    if (p.taladro) {
        // icono SVG de drill
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9c0 .6-.4 1-1 1H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9c.6 0 1 .4 1 1Z"/><path d="M18 8V5a2 2 0 0 0-2-2h-2"/><path d="M14 21v-6"/><path d="M10 21v-6"/><path d="M6 21v-6"/><path d="M10 17h4"/><path d="M4 17h2"/><path d="M20 17h2"/></svg>`;
        const icon = L.divIcon({
            className: 'taladro-icon',
            html: svg,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
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
    if (p.taladro) content += `<br>Taladro: ${p.taladro}`;
    content += `<br><button onclick="editPozo('${p.id}')">Editar</button> <button onclick="deletePozo('${p.id}')">Eliminar</button>`;
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
    await db.collection('pozos').doc('data').set({ pozos: pozoData });
    renderMarkers(document.getElementById('zone-select').value);
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
    await db.collection('pozos').doc('data').set({ pozos: pozoData });
    renderMarkers(document.getElementById('zone-select').value);
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
    await db.collection('pozos').doc('data').set({ pozos: pozoData });
    renderMarkers(pozo.zona);
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
    document.getElementById('zone-select').addEventListener('change', e => {
        loadZone(e.target.value);
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
    });

    document.getElementById('mobile-search-btn').addEventListener('click', () => {
        const id = document.getElementById('mobile-search').value.trim().toUpperCase();
        const p = pozoData.find(p => p.id === id);
        if (p) {
            searchId = id;
            document.getElementById('zone-select').value = p.zona;
            loadZone(p.zona);
        }
        document.getElementById('floating-search-input').classList.add('hidden');
        document.getElementById('mobile-search').value = '';
    });

    document.getElementById('mobile-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('mobile-search-btn').click();
        }
    });
}

// para depuración
window.debug = { pozoData, markers, map };
