const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const EXCEL_FILE = path.join(__dirname, '..', 'public', 'assets', 'excel', 'pozos.xlsx');
const GPX_FILES = [
  path.join(__dirname, '..', 'public', 'assets', 'mapas', 'Prueba1.gpx'),
  path.join(__dirname, '..', 'public', 'assets', 'mapas', '2do.gpx')
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const idx = args.indexOf(flag);
    if (idx === -1 || !args[idx + 1]) return fallback;
    return args[idx + 1];
  };
  return {
    thresholdMeters: Number(get('--threshold', '500')),
    suggestFile: get('--suggest-file', path.join(__dirname, '..', 'scripts', 'route-snap-suggestions.json'))
  };
}

function parseGpxTrackpoints(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  return [...xml.matchAll(/trkpt[^>]*lat=\"([^\"]+)\"[^>]*lon=\"([^\"]+)\"/g)]
    .map((m) => [Number(m[1]), Number(m[2])])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.').trim());
  return Number.isFinite(num) ? num : null;
}

function normalizeId(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^MFB/, '');
}

function metersBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const x = dLng * Math.cos(toRad((a[0] + b[0]) / 2));
  const y = dLat;
  return Math.sqrt(x * x + y * y) * R;
}

function nearestPointAndDistance(lat, lng, routePoints) {
  let bestDistance = Infinity;
  let bestPoint = null;
  for (const point of routePoints) {
    const distance = metersBetween([lat, lng], point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPoint = point;
    }
  }
  return { distance: bestDistance, point: bestPoint };
}

function percentile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const idx = Math.min(sortedValues.length - 1, Math.floor(q * sortedValues.length));
  return sortedValues[idx];
}

function run() {
  const { thresholdMeters, suggestFile } = parseArgs();

  const allRoutePoints = GPX_FILES
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => parseGpxTrackpoints(file));

  if (!allRoutePoints.length) {
    throw new Error('No se encontraron trackpoints en los GPX configurados.');
  }

  const workbook = XLSX.readFile(EXCEL_FILE);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null });

  const wells = rows
    .map((row) => {
      const idRaw = row['id pozo '] ?? row['id pozo'] ?? row.id ?? row.ID;
      const lat = toNumber(row.Latitud);
      const lng = toNumber(row.Longitud);
      const zona = row['zona '] ?? row.zona ?? 'SIN ZONA';
      if (!idRaw || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const nearest = nearestPointAndDistance(lat, lng, allRoutePoints);
      return {
        id: idRaw,
        key: normalizeId(idRaw),
        zona,
        lat,
        lng,
        routeDistanceM: nearest.distance,
        nearestRouteLat: nearest.point ? nearest.point[0] : null,
        nearestRouteLng: nearest.point ? nearest.point[1] : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.routeDistanceM - b.routeDistanceM);

  const distances = wells.map((w) => w.routeDistanceM);
  const stats = {
    wells: wells.length,
    thresholdMeters,
    p50: Math.round(percentile(distances, 0.5) || 0),
    p75: Math.round(percentile(distances, 0.75) || 0),
    p90: Math.round(percentile(distances, 0.9) || 0),
    p95: Math.round(percentile(distances, 0.95) || 0),
    p99: Math.round(percentile(distances, 0.99) || 0),
    max: Math.round(distances[distances.length - 1] || 0)
  };

  const suggestions = wells
    .filter((w) => w.routeDistanceM > thresholdMeters)
    .map((w) => ({
      id: w.id,
      key: w.key,
      zona: w.zona,
      current: [w.lat, w.lng],
      suggested: [w.nearestRouteLat, w.nearestRouteLng],
      routeDistanceM: Math.round(w.routeDistanceM)
    }));

  fs.writeFileSync(
    suggestFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        gpxFiles: GPX_FILES.map((f) => path.basename(f)),
        stats,
        suggestions
      },
      null,
      2
    )
  );

  console.log(`routePoints=${allRoutePoints.length}`);
  console.log(`wells=${wells.length}`);
  console.log(`p50=${stats.p50}m p90=${stats.p90}m p95=${stats.p95}m max=${stats.max}m`);
  console.log(`suggestionsOver${thresholdMeters}m=${suggestions.length}`);
  console.log(`suggestFile=${suggestFile}`);
}

run();
