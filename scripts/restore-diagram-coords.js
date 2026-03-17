const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const COLLECTION = 'pozos';
const DOC_ID = 'data';
const DEFAULT_BACKUP = path.join(__dirname, '..', 'backups', 'pozos-data-backup-1773755843569.json');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeText(value) {
  return (value || '').toString().trim().toUpperCase();
}

function idKey(value) {
  const compact = normalizeText(value).replace(/[^A-Z0-9]/g, '').replace(/^MFB/, '');
  const m = compact.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
  if (!m) return compact;
  return `${m[1]}${String(Number(m[2]))}${m[3] || ''}`;
}

function isCoords(coords) {
  return Array.isArray(coords)
    && coords.length === 2
    && Number.isFinite(Number(coords[0]))
    && Number.isFinite(Number(coords[1]));
}

function isGeoCoords(coords) {
  if (!isCoords(coords)) return false;
  const lat = Number(coords[0]);
  const lng = Number(coords[1]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function isDiagramCoords(coords) {
  return isCoords(coords) && !isGeoCoords(coords);
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

  throw new Error('No se encontro JSON de service account.');
}

function pickBackupInfo(group) {
  let diagram = null;
  let map = null;

  for (const pozo of group) {
    if (isDiagramCoords(pozo.coords)) {
      if (!diagram) diagram = pozo;
      if (diagram && diagram.zona === 'sin-asignar' && pozo.zona && pozo.zona !== 'sin-asignar') {
        diagram = pozo;
      }
    }
    if (isGeoCoords(pozo.coords) && !map) {
      map = pozo;
    }
  }

  return { diagram, map };
}

async function run() {
  const dryRun = hasFlag('--dry-run');
  const backupPath = path.resolve(getArg('--backup') || DEFAULT_BACKUP);
  if (!fs.existsSync(backupPath)) throw new Error(`No existe backup: ${backupPath}`);

  const backupRaw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  const backupPozos = (backupRaw?.data?.pozos || backupRaw?.pozos || []);

  const grouped = new Map();
  for (const pozo of backupPozos) {
    const key = idKey(pozo.id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(pozo);
  }

  const saPath = resolveServiceAccountPath();
  const sa = require(saPath);
  admin.initializeApp({ credential: admin.credential.cert(sa) });

  const db = admin.firestore();
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();
  const currentPozos = snap.exists ? (snap.data().pozos || []) : [];

  let recoveredDiagramCoords = 0;
  let recoveredZones = 0;
  let recoveredMapCoords = 0;

  const updated = currentPozos.map((pozo) => {
    const key = idKey(pozo.id);
    const info = pickBackupInfo(grouped.get(key) || []);
    const out = { ...pozo };

    const existingMapCoords = isGeoCoords(out.coordsMapa)
      ? out.coordsMapa
      : (isGeoCoords(out.coords) ? out.coords : null);

    const existingDiagramCoords = isDiagramCoords(out.coordsDiagrama)
      ? out.coordsDiagrama
      : (isDiagramCoords(out.coords) ? out.coords : null);

    if (info.map && isGeoCoords(info.map.coords) && !existingMapCoords) {
      out.coordsMapa = info.map.coords;
      recoveredMapCoords += 1;
    } else if (existingMapCoords) {
      out.coordsMapa = existingMapCoords;
    }

    if (info.diagram && isDiagramCoords(info.diagram.coords)) {
      if (!existingDiagramCoords || (existingDiagramCoords[0] !== info.diagram.coords[0] || existingDiagramCoords[1] !== info.diagram.coords[1])) {
        recoveredDiagramCoords += 1;
      }
      out.coordsDiagrama = info.diagram.coords;

      if (info.diagram.zona && info.diagram.zona !== 'sin-asignar' && out.zona !== info.diagram.zona) {
        out.zona = info.diagram.zona;
        recoveredZones += 1;
      }
    } else if (existingDiagramCoords) {
      out.coordsDiagrama = existingDiagramCoords;
    }

    // Compatibilidad: mantener coords como coordsMapa para la capa de mapa.
    if (isGeoCoords(out.coordsMapa)) {
      out.coords = out.coordsMapa;
    }

    return out;
  });

  console.log(`Backup usado: ${backupPath}`);
  console.log(`Pozos actuales: ${currentPozos.length}`);
  console.log(`coordsDiagrama recuperadas/actualizadas: ${recoveredDiagramCoords}`);
  console.log(`zonas de diagrama recuperadas: ${recoveredZones}`);
  console.log(`coordsMapa recuperadas: ${recoveredMapCoords}`);

  if (dryRun) {
    console.log('Dry run activo: no se escribieron cambios en Firestore.');
    return;
  }

  await ref.set({ pozos: updated }, { merge: true });
  console.log('Recuperacion de ubicaciones de diagrama aplicada.');
}

run().catch((err) => {
  console.error('Error restaurando ubicaciones de diagrama:', err.message);
  process.exit(1);
});
