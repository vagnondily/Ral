/**
 * Réponse de GET /api/map/districts (lot 6a) — mise en forme PURE, testée
 * (test/mapThemes.test.js) : lignes SQL par zone (faits + soumissions) →
 * contours colorables, classements par niveau (district, région, bureau, commune,
 * activité), totaux du périmètre, notes (sans contour, région seulement…).
 * Aucun taux n'est moyenné : tout part des comptes (mapThemes.zoneOf).
 */
const { THEMES, COUNT_KEYS, countsOf, addCounts, ratesOf, zoneOf, aggregateShapes } = require('./mapThemes');

const { matchDistricts } = require('./geoMatch');
const { periodInfo } = require('../common/period');

/** Zone d'un classement (sans signaux : seuls les contours et le total en portent). */
const lite = (counts) => { const c = countsOf(counts); return { counts: c, rates: ratesOf(c) }; };

const pick = (row) => countsOf(row);
// Activité : clé sans casse (registre et catégories de fiches s'écrivent parfois différemment).
const keyOf = (dim, r) => (dim === 'district' ? `${r.did || ''}|${r.rid || ''}`
  : dim === 'region' ? r.rid : dim === 'office' ? r.office : dim === 'activity' ? String(r.activity ?? '').trim().toLowerCase()
    : dim === 'commune' ? r.cpcode : 'total');

/** Index « dimension → clé → comptes » qui fusionne faits et soumissions. */
function indexRows(facts, subs) {
  const out = new Map();
  const put = (r) => {
    if (!out.has(r.dim)) out.set(r.dim, new Map());
    const m = out.get(r.dim);
    const k = keyOf(r.dim, r);
    const prev = m.get(k) || { did: r.did || null, rid: r.rid || null, office: r.office || null, activity: r.activity ?? null, cpcode: r.cpcode || null, counts: countsOf({}) };
    prev.counts = addCounts(prev.counts, pick(r));
    m.set(k, prev);
  };
  for (const r of facts || []) put(r);
  for (const r of subs || []) put(r);
  return out;
}

/**
 * Bureaux du filtre dans l'ordre de l'ARBRE (bureau, puis ses antennes, puis leurs
 * sous-antennes…, chaque niveau par nom) avec leur profondeur et `hasChildren` (« et ses
 * antennes » : le filtre d'un bureau inclut tout son sous-arbre, à n'importe quel niveau).
 * Un parent absent ou un cycle de parenté n'égare aucun bureau : il est rangé comme racine.
 * @param {{id:string, name:string, parentId?:string|null}[]} offices
 * @returns {object[]} mêmes objets + { depth, hasChildren }
 */
function officeTree(offices) {
  const list = offices || [];
  const byId = new Map(list.map((o) => [o.id, o]));
  const children = new Map();
  for (const o of list) {
    const p = o.parentId && byId.has(o.parentId) && o.parentId !== o.id ? o.parentId : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(o);
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'fr') || String(a.id).localeCompare(String(b.id));
  const out = [];
  const seen = new Set();
  const walk = (o, depth) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    const kids = (children.get(o.id) || []).filter((k) => !seen.has(k.id)).sort(byName);
    out.push({ ...o, depth, hasChildren: kids.length > 0 });
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of (children.get(null) || []).sort(byName)) walk(r, 0);
  // Cycle de parenté (aucune racine) : chaque bureau non atteint devient une racine.
  for (const o of [...list].sort(byName)) if (!seen.has(o.id)) walk(o, 0);
  return out;
}

const sortZones = (list) => list.sort((a, b) => (b.counts.active - a.counts.active) || (b.counts.submissions - a.counts.submissions) || String(a.name).localeCompare(String(b.name)));

/**
 * @param {{ facts:object[], subs:object[], areas:{districts:object[], regions:object[]}, communes:object[],
 *           links:{pcode:string, shapeKey:string|null}[], filters:{offices:object[], activities:object[]} }} raw
 * @param {{ period:{from,to}, officeId?:string|null, activity?:string|null, index:{shapeSet:string, source:string,
 *           license?:string, shapes:{key,name}[]}, withCommunes?:boolean, now?:Date }} opts
 */
function buildDistrictsResponse(raw, { period, officeId = null, activity = null, index, withCommunes = false, now = new Date() }) {
  const idx = indexRows(raw.facts, raw.subs);
  const dim = (d) => [...(idx.get(d) || new Map()).values()];
  const knownRow = (raw.facts || [])[0] || {};

  const districtById = new Map(raw.areas.districts.map((d) => [d.id, d]));
  const regionById = new Map(raw.areas.regions.map((r) => [r.id, r]));
  const links = new Map((raw.links || []).map((l) => [l.pcode, l.shapeKey]));
  const match = matchDistricts({ districts: raw.areas.districts.map((d) => ({ pcode: d.pcode, name: d.name })), shapes: index.shapes, links });
  const shapeNames = new Map(index.shapes.map((s) => [s.key, s.name]));

  // Districts du découpage portant des sites ou des soumissions.
  const districts = [];
  const regionOnly = [];
  let unplaced = countsOf({});
  for (const z of dim('district')) {
    if (z.did && districtById.has(z.did)) {
      const d = districtById.get(z.did);
      const m = match.byPcode[d.pcode] || { shapeKey: null, how: 'aucun', sharedWith: [] };
      districts.push({ id: d.id, pcode: d.pcode, name: d.name, region: d.region || null, regionPcode: d.regionPcode || null,
        shapeKey: m.shapeKey, how: m.how, sharedWith: m.sharedWith, ...lite(z.counts) });
    } else if (z.rid && regionById.has(z.rid)) {
      const r = regionById.get(z.rid);
      regionOnly.push({ pcode: r.pcode, name: r.name, ...lite(z.counts) });
    } else {
      unplaced = addCounts(unplaced, z.counts);
    }
  }
  sortZones(districts);
  sortZones(regionOnly);

  const shapes = aggregateShapes(districts.filter((d) => d.shapeKey), match, shapeNames)
    .map((s) => ({ ...s, districts: s.districts.map((x) => ({ ...x, region: districts.find((d) => d.pcode === x.pcode)?.region || null })) }));
  sortZones(shapes);

  // Région de chaque contour (tous les districts du découpage) : limites de régions dessinées partout.
  const shapeRegions = {};
  for (const d of raw.areas.districts) {
    const m = match.byPcode[d.pcode];
    if (m && m.shapeKey && d.region && !shapeRegions[m.shapeKey]) shapeRegions[m.shapeKey] = d.region;
  }

  const regions = sortZones(dim('region').filter((z) => z.rid && regionById.has(z.rid)).map((z) => {
    const r = regionById.get(z.rid);
    return { id: r.id, pcode: r.pcode, name: r.name, ...lite(z.counts) };
  }));
  const officeById = new Map((raw.filters.offices || []).map((o) => [o.id, o]));
  const offices = sortZones(dim('office').map((z) => {
    const o = z.office ? officeById.get(z.office) : null;
    return { id: z.office || null, name: o ? o.name : null, parentName: o ? o.parentName || null : null, ...lite(z.counts) };
  }));
  const communeByPcode = new Map((raw.communes || []).map((c) => [c.pcode, c]));
  const communes = sortZones(dim('commune').map((z) => {
    const c = z.cpcode ? communeByPcode.get(z.cpcode) : null;
    return { pcode: z.cpcode || null, name: c ? c.name : (z.cpcode || null), district: c ? c.district : null, region: c ? c.region : null, ...lite(z.counts) };
  }));
  const activities = sortZones(dim('activity').map((z) => ({ name: z.activity, ...lite(z.counts) })));

  const total = (idx.get('total') && idx.get('total').get('total')) || { counts: countsOf({}) };
  const withData = districts.filter((d) => d.counts.sites > 0 || d.counts.submissions > 0);
  return {
    period: periodInfo(period),
    filters: { officeId: officeId || null, activity: activity || null },
    activationKnown: knownRow.knownAll === undefined ? null : !!knownRow.knownAll,
    geometry: { asset: `geo/${index.shapeSet}.json`, shapeSet: index.shapeSet, source: index.source, license: index.license || null },
    themes: THEMES,
    shapes,
    shapeRegions,
    districts,
    regions,
    regionOnly,
    offices,
    // Classement par commune (tableau seulement, sans contours) : sur demande (?levels=commune), ~90 Ko.
    communes: withCommunes ? communes : null,
    communeCount: communes.filter((c) => c.pcode).length,
    activities,
    unmatched: withData.filter((d) => !d.shapeKey && d.how !== 'masque').map((d) => ({ pcode: d.pcode, name: d.name, sites: d.counts.sites })),
    hidden: withData.filter((d) => d.how === 'masque').map((d) => ({ pcode: d.pcode, name: d.name, sites: d.counts.sites })),
    conflicts: match.conflicts,
    shared: shapes.filter((s) => s.districts.length > 1).map((s) => ({ key: s.key, name: s.name, districts: s.districts })),
    unplaced: { sites: unplaced.sites, ...lite(unplaced) },
    submissionsUnlocated: unplaced.submissions,
    totals: zoneOf(total.counts),
    filtersAvailable: { ...raw.filters, offices: officeTree(raw.filters.offices) },
    countKeys: COUNT_KEYS,
    computedAt: now.toISOString(),
  };
}

module.exports = { buildDistrictsResponse, indexRows, officeTree };
