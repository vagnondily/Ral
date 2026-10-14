const repo = require('./map.repository');
const { buildDistrictsResponse } = require('./mapResponse');
const { buildPointsResponse } = require('./mapPoints');
const { MAX_ACCURACY_M } = require('./submissionGps');
const SHAPE_INDEX = require('./shapes/mdg-adm2.v1.json');

/**
 * Carte du suivi (lot 6a) — règles de l'API. Le tenant vient TOUJOURS de req.auth
 * (passé par le contrôleur), jamais de la requête. Les calculs sont dans les modules
 * purs (mapThemes, mapResponse, geoMatch) ; le dépôt ne fait que lire.
 */

/** GET /api/map/districts : tous les thèmes par zone sur la période. */
async function districts(auth, { period, officeId = null, activity = null, levels = [] }) {
  const raw = await repo.districtData(auth.tenantId, { period, officeId, activity });
  return buildDistrictsResponse(raw, { period, officeId, activity, index: SHAPE_INDEX, withCommunes: levels.includes('commune') });
}

/** Rôles qui voient les points de collecte précis (positions de ménages) ; les autres : grille de 2 km. */
const PRECISE_ROLES = new Set(['admin', 'manager']);

/** GET /api/map/points : sites GPS, positions déduites, centres de commune, points de collecte. */
async function points(auth, { period, officeId = null, activity = null, layers, limit = 2000 }) {
  const precise = PRECISE_ROLES.has(auth.role);
  const raw = await repo.pointsData(auth.tenantId, { period, officeId, activity, layers, limit, precise, maxAccuracyM: MAX_ACCURACY_M });
  return buildPointsResponse(raw, { layers, precise, maxAccuracyM: MAX_ACCURACY_M, limit });
}

/** GET /api/map/search : districts, communes, sites. */
async function search(auth, { q }) {
  return { results: await repo.search(auth.tenantId, q) };
}

module.exports = { districts, points, search, SHAPE_INDEX, PRECISE_ROLES };
