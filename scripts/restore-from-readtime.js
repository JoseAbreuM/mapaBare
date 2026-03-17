const fs = require('fs');
const path = require('path');
const https = require('https');
const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
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

  for (const c of candidates) {
    const p = path.resolve(c);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No se encontro JSON de service account');
}

function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch (e) {
          return reject(new Error(`Respuesta no JSON: ${body.slice(0, 300)}`));
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
        }

        resolve(parsed);
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function decodeArrayValue(arrValue) {
  const values = (arrValue && arrValue.values) || [];
  return values.map(decodeValue);
}

function decodeMapValue(mapValue) {
  const fields = (mapValue && mapValue.fields) || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

function decodeValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return !!v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue !== undefined) return decodeArrayValue(v.arrayValue);
  if (v.mapValue !== undefined) return decodeMapValue(v.mapValue);
  if (v.timestampValue !== undefined) return v.timestampValue;
  return null;
}

function summarize(pozos) {
  const counts = {};
  for (const p of pozos) {
    const k = (p.estado || '').toString();
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

async function main() {
  const readTime = getArg('--read-time');
  if (!readTime) {
    throw new Error('Falta --read-time <ISO8601>');
  }

  const dryRun = process.argv.includes('--dry-run');
  const saPath = resolveServiceAccountPath();
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));

  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/datastore']
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === 'string' ? token : token.token;
  if (!accessToken) throw new Error('No se pudo obtener access token');

  const projectId = sa.project_id;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pozos/data?readTime=${encodeURIComponent(readTime)}`;
  const doc = await fetchJson(url, accessToken);

  const data = decodeMapValue({ fields: doc.fields || {} });
  const pozos = Array.isArray(data.pozos) ? data.pozos : [];
  const counts = summarize(pozos);

  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const filePath = path.join(backupDir, `pozos-readtime-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ recoveredFromReadTime: readTime, data }, null, 2));

  console.log(`Snapshot exportado: ${filePath}`);
  console.log(`ReadTime usado: ${readTime}`);
  console.log(`Total pozos snapshot: ${pozos.length}`);
  console.log(`Estados snapshot: ${JSON.stringify(counts)}`);

  if (dryRun) {
    console.log('Dry run activo: no se escribieron cambios en Firestore.');
    return;
  }

  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();
  await db.collection('pozos').doc('data').set(data, { merge: false });
  console.log('Restauracion desde readTime completada.');
}

main().catch((err) => {
  console.error('Error en restore-from-readtime:', err.message);
  process.exit(1);
});
