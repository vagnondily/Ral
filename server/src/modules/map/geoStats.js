/**
 * Positions déduites des collectes (lot 6a) — règles PURES, testées (test/geoStats.test.js).
 *
 * Une position déduite (site sans GPS placé par ses propres collectes, centre des
 * collectes d'une commune) est la MÉDIANE des points GPS des soumissions — des
 * positions de ménages enquêtés. Vie privée : jamais moins de 3 relevés pour placer
 * quoi que ce soit (la médiane d'un seul point EST la position d'un ménage) ; pour
 * les lecteurs et dans tout export, les positions de moins de 5 relevés et tous les
 * points de collecte sont ramenés à une grille de 2 km.
 */

const EARTH_KM = 6371;
const MIN_POINTS = 3;
const SNAP_BELOW = 5;
const GRID_DEG = 0.02; // ≈ 2,2 km en latitude
const QUALITY = Object.freeze({ reliable: 'fiable', indicative: 'indicative', scattered: 'dispersee', insufficient: 'insuffisant' });

const rad = (d) => (d * Math.PI) / 180;

/**
 * Distance (km) équirectangulaire — même formule que le SQL du dépôt ; écart < 0,5 %
 * avec la distance du grand cercle sous 20 km.
 * @param {{lat:number,lng:number}} a
 * @param {{lat:number,lng:number}} b
 */
function distanceKm(a, b) {
  const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return EARTH_KM * Math.sqrt(x * x + y * y);
}

/** Distance du grand cercle (référence des tests). */
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/**
 * Qualité d'une position déduite : « insuffisant » sous 3 relevés (jamais placée) ;
 * « fiable » si la dispersion médiane ≤ 2 km ; « indicative » ≤ 5 km ; « dispersée »
 * au-delà (signalée, pas placée comme site).
 * @param {{ n:number, spreadKm:number|null }} p
 */
function positionQuality({ n, spreadKm }) {
  if (!(n >= MIN_POINTS)) return QUALITY.insufficient;
  const s = spreadKm == null ? NaN : Number(spreadKm);
  if (!Number.isFinite(s)) return QUALITY.insufficient;
  if (s <= 2) return QUALITY.reliable;
  if (s <= 5) return QUALITY.indicative;
  return QUALITY.scattered;
}

/** Une position déduite se dessine-t-elle ? (fiable ou indicative) */
const placeable = (quality) => quality === QUALITY.reliable || quality === QUALITY.indicative;

/** Point ramené au centre de sa maille de 2 km (deux décimales). */
function snap(lat, lng, step = GRID_DEG) {
  const r = (v) => Math.round(Math.round(v / step) * step * 100) / 100;
  return { lat: r(lat), lng: r(lng) };
}

/**
 * Position déduite publiée selon le rôle : précise pour admin / gestionnaire ; pour un
 * lecteur (et dans l'export), précise seulement à partir de 5 relevés, sinon ramenée à
 * la grille de 2 km. `coarse` dit si la position a été arrondie.
 * @param {{lat:number,lng:number,n:number}} p
 * @param {{ precise:boolean }} opts precise = rôle admin / manager
 */
function publishedPosition(p, { precise }) {
  if (precise || p.n >= SNAP_BELOW) return { lat: p.lat, lng: p.lng, coarse: false };
  return { ...snap(p.lat, p.lng), coarse: true };
}

module.exports = { EARTH_KM, MIN_POINTS, SNAP_BELOW, GRID_DEG, QUALITY, distanceKm, haversineKm, positionQuality, placeable, snap, publishedPosition };
