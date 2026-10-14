/**
 * Réponse de GET /api/map/points (lot 6a) — mise en forme PURE, testée
 * (test/geoStats.test.js) : sites GPS du registre (statut de la période), sites placés
 * par leurs propres collectes, centres des collectes de commune, points de collecte.
 * Vie privée : rien n'est placé sous 3 relevés ; hors admin / gestionnaire, TOUTES les
 * positions déduites (sites placés, centres de commune) et les points de collecte sont sur
 * une grille de 2 km (une médiane peut être la position exacte d'un ménage).
 * Comptes : sur le périmètre COMPLET (registre filtré par bureau / activité, calculé en
 * SQL), même quand la liste des sites dessinés est tronquée (SITES_CAP) — la troncature
 * est dite (`sitesTruncated`, `counts.gpsTotal`).
 */
const { positionQuality, placeable, publishedPosition, QUALITY } = require('./geoStats');

const LAYERS = Object.freeze(['gps', 'derived', 'communes', 'collect']);
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const round1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
const execOf = (s) => (s.visitsPlanned > 0 ? s.visitsPlannedRealised / s.visitsPlanned : null);

const byName = (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id));

/**
 * @param {{ sites:object[], sitesCap:number, perimeter?:{perimeter:number, gps:number},
 *           communeSites?:{cpcode:string, n:number, sites:{id,name}[]}[],
 *           bySite:object[], byCommune:object[], communes:object[], collect:object|null }} raw
 *   sites : sites DESSINABLES (GPS du registre + candidats à une position déduite, candidats
 *   d'abord), au plus sitesCap + 1 ; communeSites : sites sans position du périmètre complet
 *   par commune (hors candidats, rendus dans `sites`).
 * @param {{ layers:string[], precise:boolean, maxAccuracyM:number, limit:number }} opts
 */
function buildPointsResponse(raw, { layers, precise, maxAccuracyM, limit }) {
  const truncated = raw.sites.length > raw.sitesCap;
  const drawn = truncated ? raw.sites.slice(0, raw.sitesCap) : raw.sites;
  const totals = raw.perimeter || { perimeter: drawn.length, gps: drawn.filter((s) => s.hasGps).length };
  const byId = new Map(drawn.map((s) => [s.id, s]));
  const notes = { insufficient: 0, scattered: 0 };
  const out = [];
  if (layers.includes('gps')) {
    for (const s of drawn) {
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
    // Sites du périmètre COMPLET sans position (ni GPS ni placés par leurs collectes), par
    // commune : comptés en SQL, plus les candidats qui n'ont finalement pas été placés.
    const without = new Map();
    for (const c of raw.communeSites || []) {
      if (c.cpcode) without.set(c.cpcode, { n: Number(c.n) || 0, sites: [...(c.sites || [])] });
    }
    for (const s of drawn) {
      if (s.hasGps || placed.has(s.id) || !s.cpcode) continue;
      const w = without.get(s.cpcode) || { n: 0, sites: [] };
      w.n += 1; w.sites.push({ id: s.id, name: s.name });
      without.set(s.cpcode, w);
    }
    const names = new Map(raw.communes.map((c) => [c.pcode, c]));
    for (const m of raw.byCommune) {
      const w = without.get(m.key);
      if (!w || !w.n) continue;
      const quality = positionQuality({ n: m.n, spreadKm: m.spreadKm });
      if (!placeable(quality)) { notes[quality === QUALITY.scattered ? 'scattered' : 'insufficient'] += 1; continue; }
      const pos = publishedPosition({ lat: m.lat, lng: m.lng, n: m.n }, { precise });
      const c = names.get(m.key) || {};
      communes.push({ pcode: m.key, name: c.name || m.key, district: c.district || null, lat: round6(pos.lat), lng: round6(pos.lng), coarse: pos.coarse,
        n: m.n, spreadKm: round1(m.spreadKm), quality, sitesWithoutPosition: w.n,
        sites: [...w.sites].sort(byName).slice(0, 10).map((x) => ({ id: x.id, name: x.name })) });
    }
    communes.sort((a, b) => b.sitesWithoutPosition - a.sitesWithoutPosition || a.name.localeCompare(b.name));
  }
  const inCommunes = communes.reduce((a, c) => a + c.sitesWithoutPosition, 0);
  const derived = out.filter((s) => s.kind === 'collectes').length;
  return {
    sites: out,
    communes,
    collect: raw.collect ? (raw.collect.mode === 'points'
      ? { mode: 'points', points: raw.collect.points, total: raw.collect.total, lastMonth: raw.collect.lastMonth }
      : { mode: 'bins', bins: raw.collect.bins, total: raw.collect.total, lastMonth: raw.collect.lastMonth }) : null,
    counts: {
      perimeter: totals.perimeter,
      gpsTotal: totals.gps,
      gps: out.filter((s) => s.kind === 'gps').length,
      derived,
      communeCentres: communes.length,
      sitesInCommuneCentres: inCommunes,
      withoutPosition: Math.max(0, totals.perimeter - totals.gps - derived - inCommunes),
    },
    notes,
    rejected: { accuracy: raw.collect ? raw.collect.rejected : 0 },
    limits: { collect: limit, maxAccuracyM, sites: raw.sitesCap },
    sitesTruncated: truncated,
    precise,
  };
}

module.exports = { LAYERS, buildPointsResponse };
