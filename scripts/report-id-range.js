const admin = require('firebase-admin');
const sa = require('../mapa-trillas-bare-firebase.json');

function normalizeText(value) {
  return (value || '').toString().trim().toUpperCase();
}

function numericPart(id) {
  const compact = normalizeText(id).replace(/[^A-Z0-9]/g, '').replace(/^MFB/, '');
  const m = compact.match(/(\d+)/);
  if (!m) return null;
  return Number(m[1]);
}

async function run() {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const snap = await admin.firestore().collection('pozos').doc('data').get();
  const pozos = (snap.data() || {}).pozos || [];

  const nums = [];
  for (const p of pozos) {
    const n = numericPart(p.id);
    if (Number.isFinite(n)) nums.push(n);
  }

  const unique = [...new Set(nums)].sort((a, b) => a - b);
  const min = unique.length ? unique[0] : null;
  const max = unique.length ? unique[unique.length - 1] : null;

  const present = new Set(unique);
  const missing = [];
  for (let i = 1; i <= 971; i++) {
    if (!present.has(i)) missing.push(i);
  }

  const above971 = unique.filter((n) => n > 971);

  console.log(`pozosTotal=${pozos.length}`);
  console.log(`numericIdsUnique=${unique.length}`);
  console.log(`minNumeric=${min}`);
  console.log(`maxNumeric=${max}`);
  console.log(`missingIn1to971=${missing.length}`);
  console.log(`firstMissing=${JSON.stringify(missing.slice(0, 60))}`);
  console.log(`above971Count=${above971.length}`);
  console.log(`above971=${JSON.stringify(above971.slice(0, 30))}`);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
