const fs = require('fs');
const path = require('path');
const https = require('https');
const { GoogleAuth } = require('google-auth-library');

function resolveServiceAccountPath() {
  const candidates = [
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
  throw new Error('No service account file found');
}

function fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (_) { parsed = { raw: body }; }
        if (!ok) return reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
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

(async () => {
  console.log('Starting readTime probe...');
  const saPath = resolveServiceAccountPath();
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/datastore']
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === 'string' ? token : token.token;
  if (!accessToken) throw new Error('No access token from GoogleAuth');

  const projectId = sa.project_id;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pozos/data`;

  const now = new Date();
  const rows = [];
  for (let mins = 58; mins >= 0; mins -= 2) {
    const t = new Date(now.getTime() - mins * 60 * 1000).toISOString();
    try {
      const doc = await fetchJson(`${base}?readTime=${encodeURIComponent(t)}`, accessToken);
      const fields = doc.fields || {};
      const data = decodeMapValue({ fields });
      const pozos = Array.isArray(data.pozos) ? data.pozos : [];
      const counts = {};
      for (const p of pozos) {
        const k = (p.estado || '').toString();
        counts[k] = (counts[k] || 0) + 1;
      }
      rows.push({ readTime: t, total: pozos.length, counts });
    } catch (e) {
      rows.push({ readTime: t, error: e.message.slice(0, 180) });
    }
  }

  for (const r of rows) {
    if (r.error) {
      console.log(r.readTime, 'ERR');
    } else {
      const c = r.counts;
      const nonD = Object.keys(c).filter((k) => k !== 'diferido' && c[k] > 0).length;
      console.log(r.readTime, `total=${r.total}`, `diferido=${c.diferido || 0}`, `nonDKeys=${nonD}`);
    }
  }
})().catch((err) => {
  console.error('Probe failed:', err && err.stack ? err.stack : String(err));
  process.exit(1);
});
