const admin = require('firebase-admin');
const sa = require('../mapa-trillas-bare-firebase.json');

function normalizeText(value) {
  return (value || '').toString().trim().toUpperCase();
}

function idKey(value) {
  const compact = normalizeText(value).replace(/[^A-Z0-9]/g, '');
  const without = compact.replace(/^MFB/, '');
  const parsed = without.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
  if (!parsed) return without;
  return `${parsed[1]}${String(Number(parsed[2]))}${parsed[3] || ''}`;
}

async function run() {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const snap = await admin.firestore().collection('pozos').doc('data').get();
  const pozos = (snap.data() || {}).pozos || [];

  const exactMap = new Map();
  const keyMap = new Map();

  for (const p of pozos) {
    const id = (p.id || '').toString();
    exactMap.set(id, (exactMap.get(id) || 0) + 1);
    const key = idKey(id);
    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key).push(id);
  }

  const exactDupCount = [...exactMap.values()].filter((c) => c > 1).length;
  const keyDupGroups = [...keyMap.entries()].filter(([, ids]) => ids.length > 1);

  console.log(`total=${pozos.length}`);
  console.log(`exactDupIds=${exactDupCount}`);
  console.log(`keyDupGroups=${keyDupGroups.length}`);

  const sample = keyDupGroups
    .slice(0, 50)
    .map(([k, ids]) => ({ key: k, count: ids.length, ids: [...new Set(ids)] }));

  console.log(JSON.stringify(sample, null, 2));
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
