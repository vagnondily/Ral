/**
 * Point-dans-polygone — PUR, sans dépendance (retour n° 57, « rapprochement GPS
 * par shapefile »). Sert à rattacher un point GPS (site, ménage) à la commune /
 * au district dont le contour (anneaux du shapefile) le contient.
 *
 * Algorithme : lancer de rayon (ray casting) avec la règle pair/impair,
 * appliqué à TOUS les segments de TOUS les anneaux d'un enregistrement de
 * polygone. Cette règle est indépendante du sens de parcours, donc elle gère
 * nativement la convention ESRI (anneau extérieur horaire, trou anti-horaire) :
 * un point dans un trou est traversé un nombre pair de fois → « dehors » ; un
 * point dans une île est traversé un nombre impair de fois → « dedans ». Un
 * enregistrement à plusieurs anneaux extérieurs (archipel) est donc géré d'un
 * bloc.
 *
 * Coordonnées en degrés [lng, lat] (ordre ESRI x,y) ; un point peut être fourni
 * comme [x, y] ou { lng, lat } / { lat, lng }.
 */

/** Normalise un point en [x, y] = [lng, lat]. */
function xy(point) {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  if (point && typeof point === 'object') return [Number(point.lng), Number(point.lat)];
  return [NaN, NaN];
}

/**
 * Le point est-il dans un anneau simple ? (lancer de rayon horizontal vers +x.)
 * Un point exactement sur un sommet/arête n'est pas garanti stable — acceptable
 * pour un rattachement administratif (la frontière exacte est une mesure nulle).
 * @param {[number,number]|{lng,lat}} point
 * @param {Array<[number,number]>} ring  anneau fermé ou non (le dernier point
 *        est relié au premier)
 */
function pointInRing(point, ring) {
  const [x, y] = xy(point);
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]); const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]); const yj = Number(ring[j][1]);
    // L'arête (j → i) croise-t-elle la demi-droite horizontale partant du point ?
    const crosses = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Le point est-il dans le polygone défini par ses anneaux ? Règle pair/impair
 * sur l'ensemble des anneaux (extérieurs + trous).
 * @param {[number,number]|{lng,lat}} point
 * @param {Array<Array<[number,number]>>} rings  liste d'anneaux
 */
function pointInPolygon(point, rings) {
  if (!Array.isArray(rings)) return false;
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(point, ring)) inside = !inside;
  }
  return inside;
}

/** Aire signée d'un anneau (convention maths, y vers le haut). <0 = horaire (ESRI extérieur). */
function signedArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += Number(ring[j][0]) * Number(ring[i][1]) - Number(ring[i][0]) * Number(ring[j][1]);
  }
  return a / 2;
}

/**
 * Emprise (bounding box) d'un ensemble d'anneaux : [xmin, ymin, xmax, ymax].
 * Pré-filtre bon marché avant le test exact.
 */
function ringsBbox(rings) {
  let xmin = Infinity; let ymin = Infinity; let xmax = -Infinity; let ymax = -Infinity;
  for (const ring of rings || []) {
    for (const p of ring) {
      const x = Number(p[0]); const y = Number(p[1]);
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
  }
  return [xmin, ymin, xmax, ymax];
}

/** Le point est-il dans l'emprise ? (bornes incluses.) */
function inBbox(point, bbox) {
  if (!bbox) return true;
  const [x, y] = xy(point);
  return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
}

module.exports = { pointInRing, pointInPolygon, signedArea, ringsBbox, inBbox, xy };
