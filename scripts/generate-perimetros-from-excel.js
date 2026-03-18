const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const EXCEL_FILE = path.join(__dirname, '..', 'public', 'assets', 'excel', 'pozos.xlsx');
const OUT_FILE = path.join(__dirname, '..', 'public', 'assets', 'mapas', 'perimetros.geojson');

function normalizeText(value) {
  return (value || '').toString().trim().toUpperCase();
}

function mapZona(rawZona) {
  const zona = normalizeText(rawZona);
  if (!zona) return 'SIN ZONA';
  if (zona.includes('BARE 6-NORTE') || zona.includes('BARE 6 NORTE')) return 'BARE 6 NORTE';
  if (zona.includes('BARE 6')) return 'BARE 6';
  if (zona.includes('BARE ESTE')) return 'BARE ESTE';
  if (zona.includes('BARE OESTE') || zona.includes('BARE TRADICIONAL')) return 'BARE OESTE';
  if (zona.includes('TRILLAS')) return 'TRILLAS';
  return zona;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.').trim());
  return Number.isFinite(num) ? num : null;
}

function run() {
  const workbook = XLSX.readFile(EXCEL_FILE);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null });

  const byZone = new Map();
  rows.forEach((row) => {
    const lat = toNumber(row.Latitud);
    const lng = toNumber(row.Longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const zone = mapZona(row['zona '] ?? row.zona);
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone).push([lat, lng]);
  });

  const features = [];
  for (const [zone, points] of byZone.entries()) {
    if (points.length < 3) continue;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    points.forEach(([lat, lng]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });

    // Margen aproximado para no dejar pozos pegados al borde del poligono.
    const padLat = 0.0035;
    const padLng = 0.0035;

    const ring = [
      [minLng - padLng, minLat - padLat],
      [maxLng + padLng, minLat - padLat],
      [maxLng + padLng, maxLat + padLat],
      [minLng - padLng, maxLat + padLat],
      [minLng - padLng, minLat - padLat]
    ];

    features.push({
      type: 'Feature',
      properties: {
        name: zone,
        source: 'bbox-from-excel',
        wells: points.length
      },
      geometry: {
        type: 'Polygon',
        coordinates: [ring]
      }
    });
  }

  const geojson = {
    type: 'FeatureCollection',
    features
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(geojson, null, 2));
  console.log(`perimetros=${features.length}`);
  console.log(`file=${OUT_FILE}`);
}

run();
