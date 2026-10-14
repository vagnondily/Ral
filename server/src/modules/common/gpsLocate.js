/**
 * Localisateur GPS — PUR (retour n° 57). Étant donné un point GPS et un jeu de
 * contours (polygones d'un shapefile, p. ex. les communes), trouve le contour
 * qui contient le point. C'est le cœur du « rapprochement GPS par shapefile » :
 * un site ou un ménage géolocalisé est rattaché à sa commune / son district
 * sans dépendre du nom (robuste aux graphies).
 *
 * Pré-filtre par emprise (bbox) avant le test exact point-dans-polygone, pour
 * rester rapide même avec des centaines de communes.
 *
 * Les contours administratifs ne se recouvrent pas : `locate` renvoie le PREMIER
 * contour qui contient le point. Chaque contour porte une référence opaque
 * (`ref`) fournie par l'appelant (p. ex. le pcode ou l'index .dbf), que l'on
 * récupère telle quelle.
 */
const { pointInPolygon, ringsBbox, inBbox } = require('./pointInPolygon');

/**
 * Construit les contours à localiser depuis des géométries shpGeometry.
 * Ne garde que les polygones ; calcule la bbox si absente. `refs[i]` (optionnel)
 * est attaché au contour de l'enregistrement i (même ordre que le .shp/.dbf).
 * @param {Array<object|null>} geometries  sortie de readShpGeometries
 * @param {Array<*>} [refs]
 * @returns {Array<{ ref:*, bbox:number[], rings:Array }>}
 */
function buildFeatures(geometries, refs) {
  const feats = [];
  (geometries || []).forEach((g, i) => {
    if (!g || g.type !== 'polygon' || !Array.isArray(g.rings) || g.rings.length === 0) return;
    feats.push({
      ref: refs ? refs[i] : i,
      bbox: Array.isArray(g.bbox) && g.bbox.length === 4 ? g.bbox : ringsBbox(g.rings),
      rings: g.rings,
    });
  });
  return feats;
}

/**
 * Renvoie le premier contour contenant le point, ou null.
 * @param {[number,number]|{lng,lat}} point
 * @param {Array<{ref,bbox,rings}>} features
 */
function locate(point, features) {
  for (const f of features || []) {
    if (!inBbox(point, f.bbox)) continue;       // rejet rapide
    if (pointInPolygon(point, f.rings)) return f;
  }
  return null;
}

/** Comme `locate`, mais renvoie directement la référence (`ref`) ou null. */
function locateRef(point, features) {
  const f = locate(point, features);
  return f ? f.ref : null;
}

/** Tous les contours contenant le point (cas de recouvrement / contrôle). */
function locateAll(point, features) {
  return (features || []).filter((f) => inBbox(point, f.bbox) && pointInPolygon(point, f.rings));
}

module.exports = { buildFeatures, locate, locateRef, locateAll };
