const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const STATUS = {
  ACTIVO: 'activo',
  INACTIVO_SERVICIO: 'inactivo-servicio',
  EN_SERVICIO: 'en-servicio',
  DIAGNOSTICO: 'diagnostico',
  CANDIDATO: 'candidato',
  DIFERIDO: 'diferido'
};

function normalizeEstado(value) {
  const estado = (value || '').toString().trim().toLowerCase();
  if (estado === 'inactivo' || estado === 'inactivo por servicio' || estado === 'en espera de servicio' || estado === 'espera de servicio') {
    return STATUS.INACTIVO_SERVICIO;
  }
  if (estado === 'en servicio') return STATUS.EN_SERVICIO;
  if (estado === 'diagnostico' || estado === 'diagnóstico' || estado === 'en revision' || estado === 'en revisión') return STATUS.DIAGNOSTICO;
  if (estado === 'candidato') return STATUS.CANDIDATO;
  if (estado === 'diferido') return STATUS.DIFERIDO;
  if (estado === STATUS.ACTIVO || estado === STATUS.INACTIVO_SERVICIO || estado === STATUS.EN_SERVICIO || estado === STATUS.DIAGNOSTICO || estado === STATUS.CANDIDATO || estado === STATUS.DIFERIDO) {
    return estado;
  }
  return STATUS.ACTIVO;
}

function normalizeCategoria(pozo, estado) {
  const rawCategoria = Number(pozo.categoria);
  const hasCategoria = Number.isFinite(rawCategoria);

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

function getServiceAccountPath() {
  const argPath = process.argv.includes('--service-account')
    ? process.argv[process.argv.indexOf('--service-account') + 1]
    : null;

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
  const dryRun = process.argv.includes('--dry-run');
  const saPath = getServiceAccountPath();
  if (!saPath) {
    throw new Error('No se encontro service account JSON.');
  }

  const serviceAccount = require(path.resolve(saPath));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

  const ref = admin.firestore().collection('pozos').doc('data');
  const snap = await ref.get();
  const pozos = snap.exists ? (snap.data().pozos || []) : [];

  let changed = 0;
  const estadoCounts = {};
  const categoriaCounts = { 1: 0, 2: 0, 3: 0, other: 0 };

  const normalized = pozos.map((pozo) => {
    const estado = pozo.taladro ? STATUS.EN_SERVICIO : normalizeEstado(pozo.estado);
    const categoria = normalizeCategoria(pozo, estado);

    const next = {
      ...pozo,
      estado,
      categoria
    };

    if (pozo.estado !== estado || Number(pozo.categoria) !== categoria) {
      changed += 1;
    }

    estadoCounts[estado] = (estadoCounts[estado] || 0) + 1;
    if (categoria === 1 || categoria === 2 || categoria === 3) {
      categoriaCounts[categoria] += 1;
    } else {
      categoriaCounts.other += 1;
    }

    return next;
  });

  console.log(`total=${pozos.length}`);
  console.log(`changed=${changed}`);
  console.log(`estadoCounts=${JSON.stringify(estadoCounts)}`);
  console.log(`categoriaCounts=${JSON.stringify(categoriaCounts)}`);

  if (dryRun) {
    console.log('dry-run=true (sin escritura)');
    return;
  }

  await ref.set({ pozos: normalized }, { merge: true });
  console.log('Categorias normalizadas y guardadas en Firestore.');
}

run().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
