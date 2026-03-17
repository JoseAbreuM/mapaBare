const admin = require('firebase-admin');
const sa = require('../mapa-trillas-bare-firebase.json');

async function run() {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const snap = await admin.firestore().collection('pozos').doc('data').get();
  const arr = (snap.data() || {}).pozos || [];

  const counts = {};
  let missingCoordsForMapRelevant = 0;
  for (const p of arr) {
    const estado = (p.estado || '').toString();
    counts[estado] = (counts[estado] || 0) + 1;

    const isMapRelevant = estado === 'activo' || estado === 'en-servicio' || estado === 'diagnostico' || estado === 'candidato' || estado === 'inactivo-servicio' || !!p.taladro;
    const coordsOk = Array.isArray(p.coords)
      && p.coords.length === 2
      && Number.isFinite(Number(p.coords[0]))
      && Number.isFinite(Number(p.coords[1]));

    if (isMapRelevant && !coordsOk) {
      missingCoordsForMapRelevant += 1;
    }
  }

  console.log(`total=${arr.length}`);
  console.log(`counts=${JSON.stringify(counts)}`);
  console.log(`missingCoordsForMapRelevant=${missingCoordsForMapRelevant}`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
