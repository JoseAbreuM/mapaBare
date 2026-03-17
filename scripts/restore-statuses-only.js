const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function normalizeText(value) {
  return (value || '').toString().trim().toUpperCase();
}

function buildIdKey(value) {
  const compact = normalizeText(value).replace(/[^A-Z0-9]/g, '');
  const parsed = compact.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
  if (!parsed) return compact;
  const prefix = parsed[1];
  const numeric = String(Number(parsed[2]));
  const suffix = parsed[3] || '';
  return `${prefix}${numeric}${suffix}`;
}

function resolveServiceAccountPath() {
  const argPath = getArg('--service-account');
  const candidates = [
    argPath,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.SERVICE_ACCOUNT_PATH,
    path.join(__dirname, '..', 'mapa-trillas-bare-firebase.json'),
    path.join(__dirname, '..', 'service-account.json'),
    path.join(__dirname, '..', 'firebase-service-account.json')
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }

  throw new Error('No se encontro JSON de service account. Usa --service-account <ruta>.');
}

async function main() {
  const backupPathArg = getArg('--backup');
  if (!backupPathArg) throw new Error('Falta --backup <ruta-al-json>.');

  const backupPath = path.resolve(backupPathArg);
  if (!fs.existsSync(backupPath)) throw new Error(`No existe backup: ${backupPath}`);

  const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const sourcePozos = (raw?.data?.pozos || raw?.pozos || []);

  const saPath = resolveServiceAccountPath();
  const sa = require(saPath);
  admin.initializeApp({ credential: admin.credential.cert(sa) });

  const db = admin.firestore();
  const ref = db.collection('pozos').doc('data');
  const snap = await ref.get();
  const currentPozos = snap.exists ? (snap.data().pozos || []) : [];

  const sourceById = new Map(sourcePozos.map((p) => [buildIdKey(p.id), p]));
  let restored = 0;

  const merged = currentPozos.map((p) => {
    const src = sourceById.get(buildIdKey(p.id));
    if (!src) return p;

    const next = { ...p };
    if (src.estado) {
      next.estado = src.estado;
      restored += 1;
    }
    if (src.causaDiferido !== undefined) {
      next.causaDiferido = src.causaDiferido;
    }
    if (src.taladro !== undefined && src.taladro !== null && src.taladro !== '') {
      next.taladro = src.taladro;
    }
    return next;
  });

  await ref.set({ pozos: merged }, { merge: true });

  console.log(`Estados restaurados: ${restored}`);
  console.log(`Pozos actuales: ${merged.length}`);
}

main().catch((err) => {
  console.error('Error restaurando estados:', err.message);
  process.exit(1);
});
