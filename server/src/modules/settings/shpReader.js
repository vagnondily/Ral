/**
 * Lecteur minimal de shapefile (.shp) — PUR, sans dépendance : renvoie, pour
 * chaque enregistrement (même ordre que la table .dbf), un point représentatif
 * { lng, lat } ou null. Utilisé pour renseigner la latitude/longitude des
 * localités à l'import du découpage.
 *
 * Types gérés : Point (1/11/21), MultiPoint (8/18/28), PolyLine (3/13/23),
 * Polygon (5/15/25). Pour un polygone : centroïde pondéré par l'aire de
 * l'anneau extérieur le plus grand (robuste aux îles) ; repli sur le centre de
 * l'emprise si l'aire est nulle. Format : ESRI Shapefile Technical Description.
 */
const HEADER = 100;

function ringCentroid(pts) {
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [x0, y0] = pts[j]; const [x1, y1] = pts[i];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-15) return null;
  return { area: Math.abs(a), x: cx / (6 * a), y: cy / (6 * a) };
}

function readShp(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < HEADER || buf.readInt32BE(0) !== 9994) throw new Error('Fichier .shp invalide (code 9994 attendu).');
  const out = [];
  let off = HEADER;
  while (off + 8 <= buf.length) {
    const contentLen = buf.readInt32BE(off + 4) * 2; // mots de 16 bits
    const start = off + 8;
    off = start + contentLen;
    if (off > buf.length || contentLen < 4) { out.push(null); break; }
    const type = buf.readInt32LE(start);
    const base = type % 10 === 1 ? 1 : type; // 11/21 → 1
    if (type === 0) { out.push(null); continue; }
    if (base === 1) { out.push({ lng: buf.readDoubleLE(start + 4), lat: buf.readDoubleLE(start + 12) }); continue; }
    const xmin = buf.readDoubleLE(start + 4); const ymin = buf.readDoubleLE(start + 12);
    const xmax = buf.readDoubleLE(start + 20); const ymax = buf.readDoubleLE(start + 28);
    const bboxCenter = { lng: (xmin + xmax) / 2, lat: (ymin + ymax) / 2 };
    const kind = type % 10; // 3 polyligne, 5 polygone, 8 multipoint
    if (kind !== 5) { out.push(bboxCenter); continue; }
    const numParts = buf.readInt32LE(start + 36); const numPoints = buf.readInt32LE(start + 40);
    const partsAt = start + 44; const ptsAt = partsAt + 4 * numParts;
    let best = null;
    for (let p = 0; p < numParts; p += 1) {
      const from = buf.readInt32LE(partsAt + 4 * p);
      const to = p + 1 < numParts ? buf.readInt32LE(partsAt + 4 * (p + 1)) : numPoints;
      const ring = [];
      for (let k = from; k < to; k += 1) ring.push([buf.readDoubleLE(ptsAt + 16 * k), buf.readDoubleLE(ptsAt + 16 * k + 8)]);
      const c = ringCentroid(ring);
      if (c && (!best || c.area > best.area)) best = c;
    }
    out.push(best ? { lng: best.x, lat: best.y } : bboxCenter);
  }
  return out;
}

/** Le .prj décrit-il des coordonnées géographiques (degrés) ? Sinon, pas de lat/lng. */
function isGeographicPrj(prjText) {
  if (!prjText) return true; // la plupart des découpages humanitaires sont en WGS84 sans .prj
  const t = String(prjText).trim().toUpperCase();
  return t.startsWith('GEOGCS') || t.startsWith('GEOGCRS');
}

const plausible = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

module.exports = { readShp, isGeographicPrj, plausible, ringCentroid };
