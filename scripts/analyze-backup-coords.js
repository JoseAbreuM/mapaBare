const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'backups');

function readPozos(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const data = raw.data || raw;
  return Array.isArray(data.pozos) ? data.pozos : [];
}

function isPair(c) {
  return Array.isArray(c) && c.length === 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
}

function isGeo(c) {
  if (!isPair(c)) return false;
  const a = Number(c[0]);
  const b = Number(c[1]);
  return Math.abs(a) <= 90 && Math.abs(b) <= 180;
}

function analyze(file) {
  const pozos = readPozos(path.join(dir, file));
  let withCoords = 0;
  let geo = 0;
  let diagramLike = 0;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (const p of pozos) {
    const c = p.coords;
    if (!isPair(c)) continue;
    withCoords++;
    const a = Number(c[0]);
    const b = Number(c[1]);
    if (isGeo(c)) geo++; else diagramLike++;
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minB = Math.min(minB, b); maxB = Math.max(maxB, b);
  }
  return {
    file,
    total: pozos.length,
    withCoords,
    geo,
    diagramLike,
    rangeA: withCoords ? [minA, maxA] : null,
    rangeB: withCoords ? [minB, maxB] : null
  };
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
for (const file of files) {
  console.log(JSON.stringify(analyze(file)));
}
