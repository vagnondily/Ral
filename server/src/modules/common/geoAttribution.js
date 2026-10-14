/**
 * Attribution d'une zone administrative à partir d'un point GPS — PUR
 * (page de gestion des sites : « attribution automatique si point GPS existant,
 * selon la base »).
 *
 * Deux stratégies, choisies selon ce que porte la base :
 *   1. POLYGONE (exact) — si des contours sont fournis (shapefile du lot 6a,
 *      via common/gpsLocate), le point est rattaché au contour qui le contient.
 *      geoStatus = 'gps_polygon'.
 *   2. CENTROÏDE (approché) — sinon, on prend l'unité administrative (commune en
 *      priorité) dont le CENTROÏDE est le plus proche (admin_areas.lat/lng, déjà
 *      en base). geoStatus = 'gps_centroid'. On remonte ensuite la chaîne des
 *      parents pour remplir région / district / commune / fokontany et leurs
 *      pcodes.
 *
 * Aucune I/O : l'appelant fournit les `areas` (nœuds admin_areas :
 * { id, depth, name, pcode, lat, lng, parentId }) ; depth 1=région, 2=district,
 * 3=commune, 4=fokontany. Renvoie les champs à écrire sur le site, ou null.
 */

const R_EARTH_KM = 6371;
const toRad = (d) => (Number(d) * Math.PI) / 180;

/** Distance grand-cercle (km) entre deux points {lat,lng}. */
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat); const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const validPoint = (p) => Boolean(p) && p.lat != null && p.lng != null
  && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
  && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180
  && !(Number(p.lat) === 0 && Number(p.lng) === 0);

const hasCentroid = (a) => a && a.lat != null && a.lng != null
  && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

/** Index par id, pour remonter les parents. */
function indexById(areas) {
  const m = new Map();
  for (const a of areas || []) m.set(a.id, a);
  return m;
}

/** Nœud admin le plus proche du point, parmi `areas` ayant un centroïde. */
function nearestArea(point, areas) {
  let best = null; let bestD = Infinity;
  for (const a of areas || []) {
    if (!hasCentroid(a)) continue;
    const d = haversineKm(point, { lat: Number(a.lat), lng: Number(a.lng) });
    if (d < bestD) { bestD = d; best = a; }
  }
  return best ? { area: best, distanceKm: bestD } : null;
}

/** Depuis un nœud, remonte la chaîne des parents → champs adm1…adm4 + pcodes. */
function chainFrom(area, byId) {
  const out = {
    adm1: null, adm1Pcode: null, adm2: null, adm2Pcode: null,
    adm3: null, adm3Pcode: null, adm4: null, adm4Pcode: null,
    adminAreaId: area.id,
  };
  let cur = area; const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const d = Number(cur.depth);
    if (d >= 1 && d <= 4) {
      out[`adm${d}`] = cur.name ?? out[`adm${d}`];
      out[`adm${d}Pcode`] = cur.pcode ?? out[`adm${d}Pcode`];
    }
    cur = cur.parentId != null ? byId.get(cur.parentId) : null;
  }
  return out;
}

/**
 * Attribue une zone à un point GPS.
 * @param {{lat:number,lng:number}} point
 * @param {Array} areas  nœuds admin_areas { id, depth, name, pcode, lat, lng, parentId }
 * @param {object} [opts]
 * @param {Array} [opts.features]  contours polygonaux (gpsLocate.buildFeatures),
 *        `ref` = id du nœud admin ; si fournis, rattachement EXACT prioritaire.
 * @param {Function} [opts.locate]  gpsLocate.locateRef (injection pour tester)
 * @param {number} [opts.maxDepth=3]  profondeur d'ancrage pour le centroïde (3=commune)
 * @param {number} [opts.maxKm]  au-delà, on considère l'attribution douteuse (flag far)
 * @returns {null | { geoStatus, adminAreaId, distanceKm?, far?, adm1..adm4(+Pcode) }}
 */
function attributeByGps(point, areas, opts = {}) {
  if (!validPoint(point)) return null;
  const pt = { lat: Number(point.lat), lng: Number(point.lng) };
  const byId = indexById(areas);

  // 1) Rattachement exact par polygone, si des contours sont fournis.
  if (Array.isArray(opts.features) && opts.features.length && typeof opts.locate === 'function') {
    const ref = opts.locate(pt, opts.features);
    const hit = ref != null ? byId.get(ref) : null;
    if (hit) return { geoStatus: 'gps_polygon', ...chainFrom(hit, byId) };
  }

  // 2) Centroïde le plus proche, ancré au niveau le plus fin disponible
  //    (≤ maxDepth : commune par défaut ; repli district puis région).
  const maxDepth = Number.isInteger(opts.maxDepth) ? opts.maxDepth : 3;
  for (let depth = maxDepth; depth >= 1; depth -= 1) {
    const atDepth = (areas || []).filter((a) => Number(a.depth) === depth && hasCentroid(a));
    if (atDepth.length === 0) continue;
    const near = nearestArea(pt, atDepth);
    if (!near) continue;
    const far = Number.isFinite(opts.maxKm) ? near.distanceKm > opts.maxKm : undefined;
    return {
      geoStatus: 'gps_centroid',
      distanceKm: Math.round(near.distanceKm * 100) / 100,
      ...(far !== undefined ? { far } : {}),
      ...chainFrom(near.area, byId),
    };
  }
  return null;
}

module.exports = { haversineKm, nearestArea, chainFrom, attributeByGps, validPoint };
