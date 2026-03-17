const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const DEFAULT_ZONE = 'sin-asignar';
const COLLECTION = 'pozos';
const DOC_ID = 'data';

function getArgValue(flagName) {
    const idx = process.argv.findIndex((arg) => arg === flagName);
    if (idx === -1) return null;
    return process.argv[idx + 1] || null;
}

function hasFlag(flagName) {
    return process.argv.includes(flagName);
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
    const parsed = compact.match(/^([A-Z]+)(\d+)([A-Z]*)$/);
    if (!parsed) {
        return compact;
    }

    const prefix = parsed[1];
    const numeric = String(Number(parsed[2]));
    const suffix = parsed[3] || '';
    return `${prefix}${numeric}${suffix}`;
}

function hasCoords(pozo) {
    return Array.isArray(pozo.coords)
        && pozo.coords.length === 2
        && Number.isFinite(Number(pozo.coords[0]))
        && Number.isFinite(Number(pozo.coords[1]));
}

function completenessScore(pozo) {
    let score = 0;
    if (hasCoords(pozo)) score += 10;
    if (pozo.zona && pozo.zona !== DEFAULT_ZONE) score += 6;
    if (pozo.taladro) score += 3;
    if (pozo.nota) score += 2;
    if (pozo.cabezal) score += 1;
    if (pozo.variador) score += 1;
    if (pozo.potencial) score += 1;
    return score;
}

function pickCanonical(group) {
    return [...group].sort((a, b) => {
        const scoreDiff = completenessScore(b) - completenessScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        const idA = normalizeId(a.id);
        const idB = normalizeId(b.id);
        return idA.localeCompare(idB);
    })[0];
}

function mergeGroup(group) {
    const canonical = pickCanonical(group);
    const merged = { ...canonical };

    for (const pozo of group) {
        if (!hasCoords(merged) && hasCoords(pozo)) {
            merged.coords = pozo.coords;
        }

        if ((!merged.zona || merged.zona === DEFAULT_ZONE) && pozo.zona && pozo.zona !== DEFAULT_ZONE) {
            merged.zona = pozo.zona;
        }

        if (!merged.taladro && pozo.taladro) merged.taladro = pozo.taladro;
        if (!merged.cabezal && pozo.cabezal) merged.cabezal = pozo.cabezal;
        if (!merged.variador && pozo.variador) merged.variador = pozo.variador;
        if (!merged.potencial && pozo.potencial) merged.potencial = pozo.potencial;
        if (!merged.causaDiferido && pozo.causaDiferido) merged.causaDiferido = pozo.causaDiferido;

        const mergedNota = (merged.nota || '').toString().trim();
        const pozoNota = (pozo.nota || '').toString().trim();
        if (!mergedNota && pozoNota) {
            merged.nota = pozoNota;
        } else if (pozoNota && pozoNota.length > mergedNota.length) {
            merged.nota = pozoNota;
        }

        if (merged.vistaMapa === undefined) {
            merged.vistaMapa = pozo.vistaMapa !== false;
        } else {
            merged.vistaMapa = merged.vistaMapa || pozo.vistaMapa !== false;
        }
    }

    merged.id = normalizeId(merged.id);
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
        throw new Error('No se encontro JSON de service account. Usa --service-account <ruta> o define GOOGLE_APPLICATION_CREDENTIALS/SERVICE_ACCOUNT_PATH.');
    }

    const resolvedPath = path.resolve(selectedPath);
    const serviceAccount = require(resolvedPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

async function run() {
    const dryRun = hasFlag('--dry-run');
    initAdmin();

    const db = admin.firestore();
    const ref = db.collection(COLLECTION).doc(DOC_ID);
    const snap = await ref.get();
    const pozos = snap.exists ? (snap.data().pozos || []) : [];

    const groups = new Map();
    pozos.forEach((pozo) => {
        const key = buildIdKey(pozo.id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(pozo);
    });

    const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);
    const duplicateCount = duplicateGroups.reduce((acc, g) => acc + g.length - 1, 0);

    if (!duplicateGroups.length) {
        console.log('No se encontraron duplicados para compactar.');
        return;
    }

    const deduped = [];
    groups.forEach((group) => {
        if (group.length === 1) {
            deduped.push(group[0]);
            return;
        }
        deduped.push(mergeGroup(group));
    });

    console.log(`Total pozos antes: ${pozos.length}`);
    console.log(`Grupos con duplicados: ${duplicateGroups.length}`);
    console.log(`Duplicados a eliminar: ${duplicateCount}`);
    console.log(`Total pozos despues: ${deduped.length}`);

    if (dryRun) {
        console.log('Dry run activo: no se escribieron cambios en Firestore.');
        return;
    }

    await ref.set({ pozos: deduped }, { merge: true });
    console.log('Deduplicacion aplicada correctamente en Firestore.');
}

run().catch((err) => {
    console.error('Error en deduplicacion:', err.message);
    process.exit(1);
});
