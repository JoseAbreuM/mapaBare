const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const admin = require('firebase-admin');

const EXCEL_FILE = path.join(__dirname, '..', 'public', 'assets', 'excel', 'pocitos.xlsx');
const DEFAULT_ZONE = 'sin-asignar';
const COLLECTION = 'pozos';
const DOC_ID = 'data';

function getArgValue(flagName) {
    const idx = process.argv.findIndex((arg) => arg === flagName);
    if (idx === -1) return null;
    return process.argv[idx + 1] || null;
}

function normalizeText(value) {
    return (value || '')
        .toString()
        .trim()
        .toUpperCase();
}

function normalizeId(value) {
    const raw = normalizeText(value);
    if (!raw) return '';

    const compact = raw.replace(/[^A-Z0-9]/g, '');
    const parsed = compact.match(/^([A-Z]+)(\d+)([A-Z]*)$/);
    if (!parsed) {
        return raw.replace(/\s+/g, '-');
    }

    const prefix = parsed[1];
    const numeric = String(Number(parsed[2]));
    const suffix = parsed[3] || '';
    return `${prefix}-${numeric}${suffix}`;
}

function buildIdKey(value) {
    const compact = normalizeText(value).replace(/[^A-Z0-9]/g, '');
    const parsed = compact.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
    if (!parsed) {
        return compact;
    }

    const prefix = parsed[1];
    const numeric = String(Number(parsed[2]));
    const suffix = parsed[3] || '';
    return `${prefix}${numeric}${suffix}`;
}

function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const cleaned = value.toString().trim().replace(',', '.');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
}

function dmsToDecimal(degrees, minutes, seconds) {
    const d = toNumber(degrees);
    const m = toNumber(minutes);
    const s = toNumber(seconds);
    if (d === null || m === null || s === null) return null;

    const sign = d < 0 ? -1 : 1;
    const abs = Math.abs(d) + (Math.abs(m) / 60) + (Math.abs(s) / 3600);
    return sign * abs;
}

function mapCampoToZone(campoRaw) {
    const campo = normalizeText(campoRaw);
    if (!campo) return DEFAULT_ZONE;
    if (campo.includes('BARE 6-NORTE') || campo.includes('BARE 6 NORTE')) return 'bare-6-norte';
    if (campo.includes('BARE 6')) return 'bare-6';
    if (campo.includes('BARE ESTE')) return 'bare-este';
    if (campo.includes('BARE OESTE') || campo.includes('BARE TRADICIONAL')) return 'bare-tradicional';
    return DEFAULT_ZONE;
}

function pickFirst(row, aliases) {
    for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== undefined && row[alias] !== null && row[alias] !== '') {
            return row[alias];
        }
    }
    return null;
}

function mapRowToPozo(row) {
    const idRaw = pickFirst(row, ['id', 'ID', 'pozo', 'Pozo', 'POZO']);
    const id = normalizeText(idRaw);
    if (!id) return null;

    const lat = toNumber(pickFirst(row, ['latitud', 'LATITUD', 'lat', 'LAT']));
    const lng = toNumber(pickFirst(row, ['longitud', 'LONGITUD', 'lon', 'LON', 'lng', 'LNG']));
    const zonaRaw = pickFirst(row, ['zona', 'ZONA', 'vista', 'VISTA']);
    const zona = zonaRaw ? zonaRaw.toString().trim().toLowerCase() : DEFAULT_ZONE;

    const pozo = {
        id,
        zona,
        estado: 'diferido',
        coords: lat !== null && lng !== null ? [lat, lng] : null,
        vistaMapa: true,
        categoria: toNumber(pickFirst(row, ['categoria', 'CATEGORIA']))
    };

    const nota = pickFirst(row, ['nota', 'NOTA', 'descripcion', 'DESCRIPCION', 'descripción']);
    if (nota) {
        pozo.nota = nota.toString().trim();
    }

    return pozo;
}

function extractRowsFromWorkbook(workbook) {
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];

    // Attempt regular header parsing first.
    const objectRows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    const hasMeaningfulHeaders = objectRows.length > 0 && Object.keys(objectRows[0]).some((k) => !k.startsWith('__EMPTY'));
    if (hasMeaningfulHeaders) {
        return objectRows.map(mapRowToPozo).filter(Boolean);
    }

    // Fallback for files where the real header row starts later.
    const matrixRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const headerRowIndex = matrixRows.findIndex((r) => (r || []).some((v) => normalizeText(v) === 'POZO'));
    if (headerRowIndex === -1) return [];

    const header = matrixRows[headerRowIndex] || [];
    const idxPozo = header.findIndex((v) => normalizeText(v) === 'POZO');
    const idxCampo = header.findIndex((v) => normalizeText(v) === 'CAMPO');
    const idxNota = header.findIndex((v) => normalizeText(v) === 'NOTA TECNICA');

    const parsed = [];
    for (let i = headerRowIndex + 1; i < matrixRows.length; i++) {
        const row = matrixRows[i] || [];
        const pozoRaw = row[idxPozo];
        const pozoId = normalizeId(pozoRaw);
        if (!pozoId) continue;

        const lat = dmsToDecimal(row[43], row[44], row[45]);
        const lng = dmsToDecimal(row[46], row[47], row[48]);
        const zona = mapCampoToZone(row[idxCampo]);
        const nota = idxNota !== -1 && row[idxNota] ? row[idxNota].toString().trim() : null;

        parsed.push({
            id: pozoId,
            zona,
            estado: 'diferido',
            coords: lat !== null && lng !== null ? [lat, lng] : null,
            vistaMapa: true,
            nota: nota || null,
            categoria: toNumber(row[21])
        });
    }

    return parsed;
}

function mergePozo(existing, incoming) {
    const merged = { ...existing };

    if ((!Array.isArray(merged.coords) || merged.coords.length !== 2) && incoming.coords) {
        merged.coords = incoming.coords;
    }

    if ((!merged.zona || merged.zona === DEFAULT_ZONE) && incoming.zona) {
        merged.zona = incoming.zona;
    }

    if (!merged.nota && incoming.nota) {
        merged.nota = incoming.nota;
    }

    if (merged.vistaMapa === undefined) {
        merged.vistaMapa = true;
    }

    return merged;
}

function initAdmin() {
    const argPath = getArgValue('--service-account');
    const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const envAltPath = process.env.SERVICE_ACCOUNT_PATH;
    const defaultCandidates = [
        path.join(__dirname, '..', 'service-account.json'),
        path.join(__dirname, '..', 'firebase-service-account.json')
    ];

    const selectedPath = [argPath, envPath, envAltPath, ...defaultCandidates]
        .filter(Boolean)
        .find((candidate) => fs.existsSync(candidate));

    if (!selectedPath) {
        throw new Error(
            'No se encontro JSON de service account. Usa --service-account <ruta> o define GOOGLE_APPLICATION_CREDENTIALS/SERVICE_ACCOUNT_PATH.'
        );
    }

    const resolvedPath = path.resolve(selectedPath);
    const serviceAccount = require(resolvedPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

async function run() {
    if (!fs.existsSync(EXCEL_FILE)) {
        throw new Error(`No existe el archivo Excel: ${EXCEL_FILE}`);
    }

    initAdmin();

    const workbook = XLSX.readFile(EXCEL_FILE);
    const incomingPozos = extractRowsFromWorkbook(workbook);

    const db = admin.firestore();
    const ref = db.collection(COLLECTION).doc(DOC_ID);
    const snap = await ref.get();
    const existingPozos = snap.exists ? (snap.data().pozos || []) : [];

    const existingById = new Map(existingPozos.map((p) => [buildIdKey(p.id), p]));
    let updatedCount = 0;
    let createdCount = 0;
    let skippedNotCategory3 = 0;

    incomingPozos.forEach((incoming) => {
        if (Number(incoming.categoria) !== 3) {
            skippedNotCategory3 += 1;
            return;
        }

        const key = buildIdKey(incoming.id);
        const existing = existingById.get(key);
        if (existing) {
            existingById.set(key, mergePozo(existing, incoming));
            updatedCount += 1;
            return;
        }

        const newPozo = {
            id: incoming.id,
            zona: incoming.zona || DEFAULT_ZONE,
            estado: 'diferido',
            coords: incoming.coords,
            taladro: null,
            cabezal: null,
            variador: null,
            potencial: null,
            causaDiferido: null,
            nota: incoming.nota || null,
            vistaMapa: true
        };

        existingById.set(key, newPozo);
        createdCount += 1;
    });

    const mergedPozos = Array.from(existingById.values());
    await ref.set({ pozos: mergedPozos }, { merge: true });

    console.log(`Importacion completada. Filas Excel: ${incomingPozos.length}`);
    console.log(`Filas omitidas por no ser categoria 3: ${skippedNotCategory3}`);
    console.log(`Pozos existentes actualizados (solo faltantes): ${updatedCount}`);
    console.log(`Pozos nuevos creados (solo vista MAPA): ${createdCount}`);
    console.log(`Total en base despues de merge: ${mergedPozos.length}`);
}

run().catch((err) => {
    console.error('Error importando pozos desde Excel:', err.message);
    process.exit(1);
});
