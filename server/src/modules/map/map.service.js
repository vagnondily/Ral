const repo = require('./map.repository');
const { buildDistrictsResponse } = require('./mapResponse');
const { buildPointsResponse } = require('./mapPoints');
const { MAX_ACCURACY_M } = require('./submissionGps');
const SHAPE_INDEX = require('./shapes/mdg-adm2.v1.json');
const { matchDistricts } = require('./geoMatch');
const { badRequest, notFound } = require('../../middleware/errors');

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

/**
 * Paramétrage › Localités › Contours de la carte : chaque district du découpage avec
 * son rapprochement (automatique ou manuel), le nombre de sites, et la liste des contours.
 */
async function shapeLinks(auth) {
  const { districts, links } = await repo.shapeLinkData(auth.tenantId);
  const manual = new Map(links.map((l) => [l.pcode, l.shapeKey]));
  const match = matchDistricts({ districts, shapes: SHAPE_INDEX.shapes, links: manual });
  const names = new Map(SHAPE_INDEX.shapes.map((s) => [s.key, s.name]));
  return {
    shapeSet: SHAPE_INDEX.shapeSet,
    shapes: SHAPE_INDEX.shapes.map((s) => ({ key: s.key, name: s.name })),
    districts: districts.map((d) => {
      const m = match.byPcode[d.pcode] || { shapeKey: null, how: 'aucun', sharedWith: [] };
      return {
        ...d, shapeKey: m.shapeKey, shapeName: m.shapeKey ? names.get(m.shapeKey) : null, how: m.how,
        sharedWith: m.sharedWith, manual: manual.has(d.pcode), stale: match.staleLinks.includes(d.pcode),
      };
    }),
    conflicts: match.conflicts,
  };
}

/** Correction manuelle : contour de l'index, ou null (« ne pas dessiner »). 404 hors du découpage, 400 contour inconnu. */
async function setShapeLink(auth, pcode, shapeKey) {
  if (shapeKey !== null && !SHAPE_INDEX.shapes.some((s) => s.key === shapeKey)) throw badRequest('Contour inconnu.', { shapeKey });
  if (!(await repo.upsertShapeLink(auth.tenantId, auth.userId, pcode, shapeKey))) throw notFound('District introuvable dans le découpage du compte.');
}

async function clearShapeLink(auth, pcode) {
  if (!(await repo.deleteShapeLink(auth.tenantId, pcode))) throw notFound('District introuvable dans le découpage du compte.');
}

/** Centres des districts vides ← point d'étiquette de leur contour (rapprochement courant). */
async function fillCentres(auth) {
  const data = await shapeLinks(auth);
  const labels = new Map(SHAPE_INDEX.shapes.map((s) => [s.key, s.label]));
  const centres = data.districts.filter((d) => d.shapeKey && !d.hasCentre && labels.get(d.shapeKey))
    .map((d) => ({ pcode: d.pcode, lng: labels.get(d.shapeKey)[0], lat: labels.get(d.shapeKey)[1] }));
  return { updated: await repo.fillDistrictCentres(auth.tenantId, centres) };
}

module.exports = { districts, points, search, shapeLinks, setShapeLink, clearShapeLink, fillCentres, SHAPE_INDEX, PRECISE_ROLES };
