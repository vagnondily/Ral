/**
 * Réponse de GET /api/map/points (lot 6a) — mise en forme PURE, testée
 * (test/geoStats.test.js) : sites GPS du registre (statut de la période), sites placés
 * par leurs propres collectes, centres des collectes de commune, points de collecte.
 * Vie privée : rien n'est placé sous 3 relevés ; un lecteur reçoit les positions de
 * moins de 5 relevés et les points de collecte sur une grille de 2 km.
 */
const { positionQuality, placeable, publishedPosition, QUALITY } = require('./geoStats');

const LAYERS = Object.freeze(['gps', 'derived', 'communes', 'collect']);
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const round1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
const execOf = (s) => (s.visitsPlanned > 0 ? s.visitsPlannedRealised / s.visitsPlanned : null);

/**
 * @param {{ sites:object[], sitesCap:number, bySite:object[], byCommune:object[], communes:object[], collect:object|null }} raw
 * @param {{ layers:string[], precise:boolean, maxAccuracyM:number, limit:number }} opts
 */
function buildPointsResponse(raw, { layers, precise, maxAccuracyM, limit }) {
  const truncated = raw.sites.length > raw.sitesCap;
  const perimeter = truncated ? raw.sites.slice(0, raw.sitesCap) : raw.sites;
  const byId = new Map(perimeter.map((s) => [s.id, s]));
  const notes = { insufficient: 0, scattered: 0 };
  const out = [];
  if (layers.includes('gps')) {
    for (const s of perimeter) {
      if (!s.hasGps) continue;
      out.push({ id: s.id, name: s.name, code: s.code, lat: s.lat, lng: s.lng, kind: 'gps', status: s.status,
        execution: execOf(s), byData: !!s.byData, risk: s.risk, districtPcode: s.districtPcode });
    }
  }
  const placed = new Set();
  if (layers.includes('derived')) {
    for (const m of raw.bySite) {
      const s = byId.get(m.key);
      if (!s || s.hasGps) continue;
      const quality = positionQuality({ n: m.n, spreadKm: m.spreadKm });
      if (!placeable(quality)) { notes[quality === QUALITY.scattered ? 'scattered' : 'insufficient'] += 1; continue; }
      const pos = publishedPosition({ lat: m.lat, lng: m.lng, n: m.n }, { precise });
      placed.add(s.id);
      out.push({ id: s.id, name: s.name, code: s.code, lat: round6(pos.lat), lng: round6(pos.lng), coarse: pos.coarse, kind: 'collectes',
        n: m.n, spreadKm: round1(m.spreadKm), quality, status: s.status, execution: execOf(s), byData: !!s.byData, risk: s.risk, districtPcode: s.districtPcode });
    }
  }
  const communes = [];
  if (layers.includes('communes')) {
    // Sites du périmètre sans position (ni GPS ni placés par leurs collectes), par commune.
    const without = new Map();
    for (const s of perimeter) {
      if (s.hasGps || placed.has(s.id) || !s.cpcode) continue;
      if (!without.has(s.cpcode)) without.set(s.cpcode, []);
      without.get(s.cpcode).push(s);
    }
    const names = new Map(raw.communes.map((c) => [c.pcode, c]));
    for (const m of raw.byCommune) {
      const list = without.get(m.key);
      if (!list || !list.length) continue;
      const quality = positionQuality({ n: m.n, spreadKm: m.spreadKm });
      if (!placeable(quality)) { notes[quality === QUALITY.scattered ? 'scattered' : 'insufficient'] += 1; continue; }
      const pos = publishedPosition({ lat: m.lat, lng: m.lng, n: m.n }, { precise });
      const c = names.get(m.key) || {};
      const sorted = [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      communes.push({ pcode: m.key, name: c.name || m.key, district: c.district || null, lat: round6(pos.lat), lng: round6(pos.lng), coarse: pos.coarse,
        n: m.n, spreadKm: round1(m.spreadKm), quality, sitesWithoutPosition: list.length,
        sites: sorted.slice(0, 10).map((s) => ({ id: s.id, name: s.name, status: s.status })) });
    }
    communes.sort((a, b) => b.sitesWithoutPosition - a.sitesWithoutPosition || a.name.localeCompare(b.name));
  }
  const unplaced = perimeter.filter((s) => !s.hasGps && !placed.has(s.id)).length;
  const inCommunes = communes.reduce((a, c) => a + c.sitesWithoutPosition, 0);
  return {
    sites: out,
    communes,
    collect: raw.collect ? (raw.collect.mode === 'points'
      ? { mode: 'points', points: raw.collect.points, total: raw.collect.total, lastMonth: raw.collect.lastMonth }
      : { mode: 'bins', bins: raw.collect.bins, total: raw.collect.total, lastMonth: raw.collect.lastMonth }) : null,
    counts: {
      perimeter: perimeter.length,
      gps: out.filter((s) => s.kind === 'gps').length,
      derived: out.filter((s) => s.kind === 'collectes').length,
      communeCentres: communes.length,
      sitesInCommuneCentres: inCommunes,
      withoutPosition: unplaced - inCommunes,
    },
    notes,
    rejected: { accuracy: raw.collect ? raw.collect.rejected : 0 },
    limits: { collect: limit, maxAccuracyM, sites: raw.sitesCap },
    sitesTruncated: truncated,
    precise,
  };
}

module.exports = { LAYERS, buildPointsResponse };
