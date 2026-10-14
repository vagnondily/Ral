const repo = require('./map.repository');
const { buildDistrictsResponse } = require('./mapResponse');
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

module.exports = { districts, SHAPE_INDEX };
