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
const { readShpGeometries } = require('../common/shpGeometry');

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

/** Point représentatif d'une géométrie (common/shpGeometry) : voir l'en-tête. */
function representativePoint(g) {
  if (!g) return null;
  if (g.type === 'point') return g.point;
  const [xmin, ymin, xmax, ymax] = g.bbox;
  const bboxCenter = { lng: (xmin + xmax) / 2, lat: (ymin + ymax) / 2 };
  if (g.type !== 'polygon') return bboxCenter;
  let best = null;
  for (const ring of g.rings) {
    const c = ringCentroid(ring);
    if (c && (!best || c.area > best.area)) best = c;
  }
  return best ? { lng: best.x, lat: best.y } : bboxCenter;
}

/**
 * Un point par enregistrement (ordre .dbf), ou null. Lecture binaire UNIQUE :
 * common/shpGeometry (retour 57 : un seul lecteur de shapefile dans MEMS).
 */
function readShp(buffer) {
  return readShpGeometries(buffer).map(representativePoint);
}

/** Le .prj décrit-il des coordonnées géographiques (degrés) ? Sinon, pas de lat/lng. */
function isGeographicPrj(prjText) {
  if (!prjText) return true; // la plupart des découpages humanitaires sont en WGS84 sans .prj
  const t = String(prjText).trim().toUpperCase();
  return t.startsWith('GEOGCS') || t.startsWith('GEOGCRS');
}

// (0, 0) n'est le centroïde d'aucune unité administrative : c'est une valeur par défaut.
const plausible = (p) => Boolean(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  && !(p.lat === 0 && p.lng === 0);

module.exports = { readShp, isGeographicPrj, plausible, ringCentroid, representativePoint };
