const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const XLSX = require('xlsx');

const COLLECTION = 'pozos';
const DOC_ID = 'data';
const DEFAULT_ZONE = 'sin-asignar';
const EXCEL_FILE = path.join(__dirname, '..', 'public', 'assets', 'excel', 'pocitos.xlsx');

const STATUS = {
  ACTIVO: 'activo',
  INACTIVO_SERVICIO: 'inactivo-servicio',
  EN_SERVICIO: 'en-servicio',
  DIAGNOSTICO: 'diagnostico',
  CANDIDATO: 'candidato',
  DIFERIDO: 'diferido'
};

const STATUS_PRIORITY = {
  [STATUS.EN_SERVICIO]: 6,
  [STATUS.ACTIVO]: 5,
  [STATUS.DIAGNOSTICO]: 4,
  [STATUS.CANDIDATO]: 3,
  [STATUS.DIFERIDO]: 2,
  [STATUS.INACTIVO_SERVICIO]: 1
};

function getArg(flagName) {
  const idx = process.argv.findIndex((arg) => arg === flagName);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function hasFlag(flagName) {
  return process.argv.includes(flagName);
}

function normalizeText(value) {
  return (value || '').toString().trim().toUpperCase();
}

function normalizeEstado(estado) {
  const value = (estado || '').toString().trim().toLowerCase();
  if (value === 'inactivo' || value === 'inactivo por servicio' || value === 'en espera de servicio' || value === 'espera de servicio' || value === STATUS.INACTIVO_SERVICIO) {
    return STATUS.INACTIVO_SERVICIO;
  }
  if (value === 'en servicio' || value === STATUS.EN_SERVICIO) return STATUS.EN_SERVICIO;
  if (value === 'diagnostico' || value === 'diagnóstico' || value === STATUS.DIAGNOSTICO) return STATUS.DIAGNOSTICO;
  if (value === 'candidato' || value === STATUS.CANDIDATO) return STATUS.CANDIDATO;
  if (value === 'diferido' || value === STATUS.DIFERIDO) return STATUS.DIFERIDO;
  if (value === 'activo' || value === STATUS.ACTIVO) return STATUS.ACTIVO;
  return STATUS.ACTIVO;
}

function dmsToDecimal(degrees, minutes, seconds) {
  const d = Number(String(degrees || '').replace(',', '.'));
  const m = Number(String(minutes || '').replace(',', '.'));
  const s = Number(String(seconds || '').replace(',', '.'));
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  const sign = d < 0 ? -1 : 1;
  const abs = Math.abs(d) + (Math.abs(m) / 60) + (Math.abs(s) / 3600);
  return sign * abs;
}

function isCoords(coords) {
  return Array.isArray(coords)
    && coords.length === 2
    && Number.isFinite(Number(coords[0]))
    && Number.isFinite(Number(coords[1]))
    && Math.abs(Number(coords[0])) <= 90
    && Math.abs(Number(coords[1])) <= 180;
}

function idKey(value) {
  const compact = normalizeText(value).replace(/[^A-Z0-9]/g, '');
  const withoutMfb = compact.replace(/^MFB/, '');
  const parsed = withoutMfb.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
  if (!parsed) return withoutMfb;
  const prefix = parsed[1];
  const numeric = String(Number(parsed[2]));
  const suffix = parsed[3] || '';
  return `${prefix}${numeric}${suffix}`;
}

function hasMfbPrefix(id) {
  return /^\s*MFB/i.test((id || '').toString());
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

function loadExcelCoordsById() {
  if (!fs.existsSync(EXCEL_FILE)) return new Map();

  const workbook = XLSX.readFile(EXCEL_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const headerRowIndex = rows.findIndex((r) => (r || []).some((v) => normalizeText(v) === 'POZO'));
  if (headerRowIndex === -1) return new Map();

  const header = rows[headerRowIndex] || [];
  const idxPozo = header.findIndex((v) => normalizeText(v) === 'POZO');
  const idxCampo = header.findIndex((v) => normalizeText(v) === 'CAMPO');
  if (idxPozo === -1) return new Map();

  const out = new Map();
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const key = idKey(row[idxPozo]);
    if (!key) continue;

    const lat = dmsToDecimal(row[43], row[44], row[45]);
    const lng = dmsToDecimal(row[46], row[47], row[48]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    out.set(key, {
      coords: [lat, lng],
      zona: mapCampoToZone(row[idxCampo])
    });
  }

  return out;
}

function completenessScore(pozo) {
  let score = 0;
  if (isCoords(pozo.coords)) score += 10;
  if (pozo.zona && pozo.zona !== DEFAULT_ZONE) score += 6;
  if (pozo.taladro) score += 4;
  if (pozo.nota) score += 2;
  if (pozo.cabezal) score += 1;
  if (pozo.variador) score += 1;
  if (pozo.potencial) score += 1;
  if (hasMfbPrefix(pozo.id)) score += 3;
  return score;
}

function pickCanonical(group) {
  return [...group].sort((a, b) => {
    const scoreDiff = completenessScore(b) - completenessScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.id || '').toString().localeCompare((b.id || '').toString());
  })[0];
}

function bestEstado(group) {
  let best = STATUS.DIFERIDO;
  let bestP = -1;
  for (const pozo of group) {
    const normalized = normalizeEstado(pozo.estado);
    const converted = normalized === STATUS.INACTIVO_SERVICIO ? STATUS.DIFERIDO : normalized;
    const p = STATUS_PRIORITY[converted] || 0;
    if (p > bestP) {
      best = converted;
      bestP = p;
    }
  }
  return best;
}

function mergeGroup(group, excelMap) {
  const canonical = pickCanonical(group);
  const merged = { ...canonical };

  merged.estado = bestEstado(group);
  merged.vistaMapa = group.some((p) => p.vistaMapa !== false);

  for (const pozo of group) {
    if (!isCoords(merged.coords) && isCoords(pozo.coords)) merged.coords = pozo.coords;
    if ((!merged.zona || merged.zona === DEFAULT_ZONE) && pozo.zona && pozo.zona !== DEFAULT_ZONE) merged.zona = pozo.zona;
    if (!merged.taladro && pozo.taladro) merged.taladro = pozo.taladro;
    if (!merged.cabezal && pozo.cabezal) merged.cabezal = pozo.cabezal;
    if (!merged.variador && pozo.variador) merged.variador = pozo.variador;
    if (!merged.potencial && pozo.potencial) merged.potencial = pozo.potencial;
    if (!merged.causaDiferido && pozo.causaDiferido) merged.causaDiferido = pozo.causaDiferido;
    if (!merged.nota && pozo.nota) merged.nota = pozo.nota;
    if (!merged.fechaUltimoServicio && pozo.fechaUltimoServicio) merged.fechaUltimoServicio = pozo.fechaUltimoServicio;
  }

  const key = idKey(merged.id);
  const excelEntry = excelMap.get(key);
  const estado = normalizeEstado(merged.estado);
  const shouldHaveMapCoords = [STATUS.ACTIVO, STATUS.EN_SERVICIO, STATUS.CANDIDATO, STATUS.DIAGNOSTICO].includes(estado);
  if (excelEntry && shouldHaveMapCoords && !isCoords(merged.coords)) {
    merged.coords = excelEntry.coords;
  }
  if (excelEntry && (!merged.zona || merged.zona === DEFAULT_ZONE)) {
    merged.zona = excelEntry.zona || merged.zona;
  }

  if (!merged.taladro && normalizeEstado(merged.estado) === STATUS.INACTIVO_SERVICIO) {
    merged.estado = STATUS.DIFERIDO;
  }
  if (merged.taladro) {
    merged.estado = STATUS.EN_SERVICIO;
    merged.causaDiferido = null;
  }
  if (normalizeEstado(merged.estado) !== STATUS.DIFERIDO) {
    merged.causaDiferido = null;
  }

  return merged;
}

function initAdmin() {
  const argPath = getArg('--service-account');
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const envAltPath = process.env.SERVICE_ACCOUNT_PATH;
  const defaultCandidates = [
    path.join(__dirname, '..', 'mapa-trillas-bare-firebase.json'),
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
  const excelMap = loadExcelCoordsById();

  const beforeCounts = {};
  for (const p of pozos) {
    const k = normalizeEstado(p.estado);
    beforeCounts[k] = (beforeCounts[k] || 0) + 1;
  }

  const groups = new Map();
  for (const pozo of pozos) {
    const key = idKey(pozo.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pozo);
  }

  const deduped = [];
  let duplicateGroups = 0;
  let duplicateRemoved = 0;
  let coordsAdded = 0;

  for (const group of groups.values()) {
    if (group.length > 1) {
      duplicateGroups += 1;
      duplicateRemoved += group.length - 1;
    }
    const merged = mergeGroup(group, excelMap);
    const hadCoords = group.some((p) => isCoords(p.coords));
    if (!hadCoords && isCoords(merged.coords)) coordsAdded += 1;
    deduped.push(merged);
  }

  const afterCounts = {};
  for (const p of deduped) {
    const normalized = normalizeEstado(p.estado) === STATUS.INACTIVO_SERVICIO ? STATUS.DIFERIDO : normalizeEstado(p.estado);
    p.estado = normalized;
    afterCounts[normalized] = (afterCounts[normalized] || 0) + 1;
  }

  console.log(`Total antes: ${pozos.length}`);
  console.log(`Total despues: ${deduped.length}`);
  console.log(`Grupos duplicados: ${duplicateGroups}`);
  console.log(`Duplicados eliminados: ${duplicateRemoved}`);
  console.log(`Coordenadas agregadas desde Excel: ${coordsAdded}`);
  console.log(`Estados antes: ${JSON.stringify(beforeCounts)}`);
  console.log(`Estados despues: ${JSON.stringify(afterCounts)}`);

  if (dryRun) {
    console.log('Dry run activo: no se escribieron cambios en Firestore.');
    return;
  }

  await ref.set({ pozos: deduped }, { merge: true });
  console.log('Reconciliacion aplicada correctamente.');
}

run().catch((err) => {
  console.error('Error en reconciliacion:', err.message);
  process.exit(1);
});
