const admin = require('firebase-admin');
const sa = require('../mapa-trillas-bare-firebase.json');

function isPair(c) {
  return Array.isArray(c) && c.length === 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
}

function isGeo(c) {
  if (!isPair(c)) return false;
  return Math.abs(Number(c[0])) <= 90 && Math.abs(Number(c[1])) <= 180;
}

async function run() {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const snap = await admin.firestore().collection('pozos').doc('data').get();
  const arr = (snap.data() || {}).pozos || [];

  let withMapa = 0;
  let withDiagrama = 0;
  let invalidMapa = 0;
  let invalidDiagrama = 0;

  for (const p of arr) {
    if (p.coordsMapa !== undefined && p.coordsMapa !== null) {
      if (isGeo(p.coordsMapa)) withMapa++;
      else invalidMapa++;
    }
    if (p.coordsDiagrama !== undefined && p.coordsDiagrama !== null) {
      if (isPair(p.coordsDiagrama) && !isGeo(p.coordsDiagrama)) withDiagrama++;
      else invalidDiagrama++;
    }
  }

  console.log(`total=${arr.length}`);
  console.log(`withCoordsMapa=${withMapa}`);
  console.log(`withCoordsDiagrama=${withDiagrama}`);
  console.log(`invalidCoordsMapa=${invalidMapa}`);
  console.log(`invalidCoordsDiagrama=${invalidDiagrama}`);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
