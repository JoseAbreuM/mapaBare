const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
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
  if (!backupPathArg) {
    throw new Error('Falta --backup <ruta-al-json>.');
  }

  const backupPath = path.resolve(backupPathArg);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`No existe backup: ${backupPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const data = raw?.data || raw;
  const total = Array.isArray(data?.pozos) ? data.pozos.length : 0;

  const dryRun = hasFlag('--dry-run');
  const serviceAccountPath = resolveServiceAccountPath();
  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  console.log(`Backup a restaurar: ${backupPath}`);
  console.log(`Pozos en backup: ${total}`);
  if (dryRun) {
    console.log('Dry run activo: no se escribieron cambios.');
    return;
  }

  await db.collection('pozos').doc('data').set(data, { merge: false });
  console.log('Restauracion completada.');
}

main().catch((err) => {
  console.error('Error restaurando backup:', err.message);
  process.exit(1);
});
