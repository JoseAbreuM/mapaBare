const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function resolveServiceAccountPath() {
  const argIndex = process.argv.indexOf('--service-account');
  const argPath = argIndex >= 0 ? process.argv[argIndex + 1] : null;
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
  const serviceAccountPath = resolveServiceAccountPath();
  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const snap = await db.collection('pozos').doc('data').get();
  const payload = snap.exists ? snap.data() : {};
  const out = {
    exportedAt: new Date().toISOString(),
    projectId: serviceAccount.project_id || null,
    data: payload
  };

  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const filename = `pozos-data-backup-${Date.now()}.json`;
  const filePath = path.join(backupDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2));

  const total = Array.isArray(payload?.pozos) ? payload.pozos.length : 0;
  console.log(`Backup creado: ${filePath}`);
  console.log(`Pozos exportados: ${total}`);
}

main().catch((err) => {
  console.error('Error exportando backup:', err.message);
  process.exit(1);
});
