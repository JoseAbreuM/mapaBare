const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const admin = require('firebase-admin');

const EXCEL_FILE = path.join(__dirname, '..', 'public', 'assets', 'excel', 'pozos.xlsx');
const COLLECTION = 'pozos';
const DOC_ID = 'data';

const STATUS = {
  ACTIVO: 'activo',
  INACTIVO_SERVICIO: 'inactivo-servicio',
  EN_SERVICIO: 'en-servicio',
  DIAGNOSTICO: 'diagnostico',
  CANDIDATO: 'candidato',
  DIFERIDO: 'diferido'
};

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArg(flag) {
  const idx = process.argv.findIndex((arg) => arg === flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function normalizeHeader(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(value) {
  return (value || '').toString().trim().toUpperCase();
}

function idKey(value) {
  const compact = normalizeText(value).replace(/[^A-Z0-9]/g, '').replace(/^MFB/, '');
  const parsed = compact.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
  if (!parsed) return compact;
  const prefix = parsed[1];
  const numeric = String(Number(parsed[2]));
  const suffix = parsed[3] || '';
  return `${prefix}${numeric}${suffix}`;
}

function normalizeEstado(rawEstado) {
  const value = (rawEstado || '').toString().trim().toLowerCase();
  if (!value) return null;
  if (value === 'inactivo' || value === 'en espera de servicio' || value === 'espera de servicio' || value === 'inactivo por servicio' || value === STATUS.INACTIVO_SERVICIO) {
    return STATUS.INACTIVO_SERVICIO;
  }
  if (value === 'en servicio' || value === STATUS.EN_SERVICIO) return STATUS.EN_SERVICIO;
  if (value === 'diagnostico' || value === 'diagnóstico' || value === 'en revision' || value === 'en revisión' || value === STATUS.DIAGNOSTICO) return STATUS.DIAGNOSTICO;
  if (value === 'candidato' || value === STATUS.CANDIDATO) return STATUS.CANDIDATO;
  if (value === 'diferido' || value === STATUS.DIFERIDO) return STATUS.DIFERIDO;
  if (value === 'activo' || value === STATUS.ACTIVO) return STATUS.ACTIVO;
  return null;
}

function mapZona(rawZona) {
  const value = normalizeText(rawZona);
  if (!value) return null;
  if (value.includes('BARE 6-NORTE') || value.includes('BARE 6 NORTE')) return 'bare-6-norte';
  if (value.includes('BARE 6')) return 'bare-6';
  if (value.includes('BARE ESTE')) return 'bare-este';
  if (value.includes('BARE OESTE') || value.includes('BARE TRADICIONAL')) return 'bare-tradicional';
  return null;
}

function normalizeCategoria(rawCategoria) {
  if (rawCategoria === null || rawCategoria === undefined || rawCategoria === '') return null;
  const number = Number(String(rawCategoria).replace(',', '.').trim());
  if (!Number.isFinite(number)) return null;
  if (number === 1 || number === 2 || number === 3) return number;
  return null;
}

function normalizeCategoriaByEstado(estado, categoriaActual) {
  if (estado === STATUS.ACTIVO) return 1;
  if (estado === STATUS.CANDIDATO || estado === STATUS.DIFERIDO) return 3;
  if (estado === STATUS.EN_SERVICIO) return categoriaActual === 3 ? 3 : 2;
  if (estado === STATUS.INACTIVO_SERVICIO || estado === STATUS.DIAGNOSTICO) {
    return categoriaActual === 3 ? 3 : 2;
  }
  return categoriaActual;
}

function buildExcelMap() {
  if (!fs.existsSync(EXCEL_FILE)) {
    throw new Error(`No existe el Excel esperado: ${EXCEL_FILE}`);
  }

  const wb = XLSX.readFile(EXCEL_FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  const out = new Map();
  for (const row of rows) {
    const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]);
    const byHeader = new Map(normalizedEntries);

    const rawId = byHeader.get('id pozo') || byHeader.get('id') || byHeader.get('pozo');
    const key = idKey(rawId);
    if (!key) continue;

    const zona = mapZona(byHeader.get('zona'));
    const estado = normalizeEstado(byHeader.get('estado'));
    const categoria = normalizeCategoria(byHeader.get('categoria'));

    out.set(key, { zona, estado, categoria });
  }

  return out;
}

function resolveServiceAccount() {
  const argPath = getArg('--service-account');
  const candidates = [
    argPath,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.SERVICE_ACCOUNT_PATH,
    path.join(__dirname, '..', 'mapa-trillas-bare-firebase.json'),
    path.join(__dirname, '..', 'service-account.json'),
    path.join(__dirname, '..', 'firebase-service-account.json')
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function run() {
  const dryRun = hasFlag('--dry-run');
  const excelMap = buildExcelMap();

  const serviceAccountPath = resolveServiceAccount();
  if (!serviceAccountPath) {
    throw new Error('No se encontro service account JSON para Firebase Admin.');
  }

  const serviceAccount = require(path.resolve(serviceAccountPath));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  const ref = admin.firestore().collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();
  const pozos = snap.exists ? (snap.data().pozos || []) : [];

  let matched = 0;
  let updated = 0;
  let skippedActivos = 0;

  const nextPozos = pozos.map((pozo) => {
    const currentEstado = normalizeEstado(pozo.estado) || STATUS.ACTIVO;
    if (currentEstado === STATUS.ACTIVO) {
      skippedActivos += 1;
      return pozo;
    }

    const entry = excelMap.get(idKey(pozo.id));
    if (!entry) return pozo;
    matched += 1;

    const next = { ...pozo };
    let changed = false;

    if (entry.zona && entry.zona !== next.zona) {
      next.zona = entry.zona;
      changed = true;
    }

    const incomingEstado = entry.estado || currentEstado;
    if (incomingEstado && incomingEstado !== currentEstado) {
      next.estado = incomingEstado;
      changed = true;
    }

    const currentCategoria = normalizeCategoria(next.categoria) || 2;
    const incomingCategoria = entry.categoria || currentCategoria;
    const finalCategoria = normalizeCategoriaByEstado(next.estado || currentEstado, incomingCategoria);
    if (finalCategoria !== normalizeCategoria(next.categoria)) {
      next.categoria = finalCategoria;
      changed = true;
    }

    if (changed) {
      updated += 1;
      return next;
    }

    return pozo;
  });

  console.log(`totalPozos=${pozos.length}`);
  console.log(`excelRows=${excelMap.size}`);
  console.log(`matchedNonActive=${matched}`);
  console.log(`updated=${updated}`);
  console.log(`skippedActivos=${skippedActivos}`);

  if (dryRun) {
    console.log('dry-run=true (sin escritura)');
    return;
  }

  await ref.set({ pozos: nextPozos }, { merge: true });
  console.log('Sincronizacion de zona/estado/categoria aplicada.');
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
