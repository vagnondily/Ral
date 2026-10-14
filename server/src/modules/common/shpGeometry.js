/**
 * Lecteur de GÉOMÉTRIES d'un shapefile (.shp) — PUR, sans dépendance
 * (retour n° 57). Contrairement à settings/shpReader.js (qui ne renvoie qu'un
 * centroïde par enregistrement), celui-ci conserve les ANNEAUX COMPLETS, requis
 * pour le point-dans-polygone (rattachement GPS → commune / district).
 *
 * Renvoie, dans l'ordre de la table .dbf, un objet par enregistrement :
 *   - polygone  : { type:'polygon',  bbox:[xmin,ymin,xmax,ymax], rings:[[[x,y],…],…] }
 *   - polyligne : { type:'polyline', bbox, rings }
 *   - point     : { type:'point', point:{ lng, lat } }
 *   - multipoint: { type:'multipoint', bbox, points:[{lng,lat},…] }
 *   - nul / vide: null
 * Coordonnées en degrés [x=lng, y=lat] (ordre ESRI). Les variantes Z/M
 * (types 11/13/15/18 et 21/23/25/28) sont lues : les X,Y précèdent Z/M dans le
 * format, donc on lit les X,Y et on ignore le reste.
 *
 * Réf. : ESRI Shapefile Technical Description (juillet 1998).
 */
const HEADER = 100;

function readParts(buf, start, numParts, numPoints, partsAt, ptsAt) {
  const rings = [];
  for (let p = 0; p < numParts; p += 1) {
    const from = buf.readInt32LE(partsAt + 4 * p);
    const to = p + 1 < numParts ? buf.readInt32LE(partsAt + 4 * (p + 1)) : numPoints;
    const ring = [];
    for (let k = from; k < to; k += 1) {
      ring.push([buf.readDoubleLE(ptsAt + 16 * k), buf.readDoubleLE(ptsAt + 16 * k + 8)]);
    }
    rings.push(ring);
  }
  return rings;
}

/**
 * Lit toutes les géométries d'un buffer .shp.
 * @param {Buffer|Uint8Array} buffer
 * @returns {Array<object|null>} une entrée par enregistrement (ordre .dbf)
 */
function readShpGeometries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < HEADER || buf.readInt32BE(0) !== 9994) {
    throw new Error('Fichier .shp invalide (code 9994 attendu).');
  }
  const out = [];
  let off = HEADER;
  while (off + 8 <= buf.length) {
    const contentLen = buf.readInt32BE(off + 4) * 2; // longueur en octets (mots de 16 bits)
    const start = off + 8;
    off = start + contentLen;
    if (off > buf.length || contentLen < 4) { out.push(null); break; }
    const type = buf.readInt32LE(start);
    if (type === 0) { out.push(null); continue; } // Null shape
    const base = type % 10; // 1 point, 3 polyligne, 5 polygone, 8 multipoint

    if (base === 1) { // Point (1/11/21)
      out.push({ type: 'point', point: { lng: buf.readDoubleLE(start + 4), lat: buf.readDoubleLE(start + 12) } });
      continue;
    }

    const xmin = buf.readDoubleLE(start + 4); const ymin = buf.readDoubleLE(start + 12);
    const xmax = buf.readDoubleLE(start + 20); const ymax = buf.readDoubleLE(start + 28);
    const bbox = [xmin, ymin, xmax, ymax];

    if (base === 8) { // MultiPoint (8/18/28) : bbox + numPoints + points
      const numPoints = buf.readInt32LE(start + 36);
      const ptsAt = start + 40;
      const points = [];
      for (let k = 0; k < numPoints; k += 1) {
        points.push({ lng: buf.readDoubleLE(ptsAt + 16 * k), lat: buf.readDoubleLE(ptsAt + 16 * k + 8) });
      }
      out.push({ type: 'multipoint', bbox, points });
      continue;
    }

    if (base === 3 || base === 5) { // PolyLine (3) / Polygon (5), + Z/M variantes
      const numParts = buf.readInt32LE(start + 36);
      const numPoints = buf.readInt32LE(start + 40);
      const partsAt = start + 44;
      const ptsAt = partsAt + 4 * numParts;
      const rings = readParts(buf, start, numParts, numPoints, partsAt, ptsAt);
      out.push({ type: base === 5 ? 'polygon' : 'polyline', bbox, rings });
      continue;
    }

    out.push(null); // type non géré
  }
  return out;
}

module.exports = { readShpGeometries };
