/**
 * Thèmes, taux et signaux de la carte (modules/map/mapThemes.js) et mise en forme
 * de GET /api/map/districts (mapResponse.js). Règles : 0 % ≠ « aucun site actif » ;
 * pas de plan → « — aucun plan », jamais 0 % ; un contour partagé additionne les
 * comptes de ses districts puis recalcule ses taux (jamais une moyenne de taux).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { rate, ratesOf, signalsOf, alertLevel, aggregateShapes, countsOf, THRESHOLDS, THEMES, COUNT_KEYS } = require('../src/modules/map/mapThemes');
const { buildDistrictsResponse } = require('../src/modules/map/mapResponse');
const { siteRangeFacts } = require('../src/modules/common/siteActivity');

test('couverture : 0 % est une vraie valeur, distincte de « aucun site actif »', () => {
  assert.deepEqual(rate(0, 120), { value: 0, num: 0, den: 120, reason: null });
  assert.deepEqual(rate(0, 0), { value: null, num: 0, den: 0, reason: 'aucun_site_actif' });
  const r = ratesOf({ active: 1280, realised: 17 });
  assert.equal(r.coverage.reason, null);
  assert.ok(Math.abs(r.coverage.value - 17 / 1280) < 1e-12);
});

test('planification et exécution sans plan → « aucun_plan » (jamais 0 %)', () => {
  const r = ratesOf({ active: 116, realised: 0, planned: 0, visitsPlanned: 0 });
  assert.deepEqual(r.planning, { value: null, num: 0, den: 116, reason: 'aucun_plan' });
  assert.deepEqual(r.execution, { value: null, num: 0, den: 0, reason: 'aucun_plan' });
  const none = ratesOf({});
  assert.equal(none.planning.reason, 'aucun_site_actif');
  assert.equal(none.execution.reason, 'aucun_site_actif');
  const ok = ratesOf({ active: 322, planned: 1, visitsPlanned: 4, visitsPlannedRealised: 3 });
  assert.equal(ok.execution.value, 0.75);
  assert.equal(ok.planning.value, 1 / 322);
});

test('signaux : seuils, gravité, ordre', () => {
  assert.equal(THRESHOLDS.execLow, 0.5); // même seuil que alertsMath (exécution du plan)
  const s = signalsOf({ active: 322, riskHigh: 236, highUntouched: 233, planned: 1, visitsPlanned: 4, visitsPlannedRealised: 1, submissions: 13, submissionsSite: 1, visitsOffPlan: 1, visitsUnassigned: 2 });
  assert.deepEqual(s.map((x) => [x.sev, x.kind]), [
    ['critical', 'high_risk_untouched'], ['warning', 'plan_exec_low'],
    ['info', 'visits_unassigned'], ['info', 'data_unlinked'], ['info', 'off_plan'],
  ]);
  assert.deepEqual(s[0].params, { n: 233 });
  assert.equal(s[3].params.n, 12);
  assert.deepEqual(s[0].go, { module: 'processus', sub: 'rbm' });
  // Part des sites à risque élevé non suivis < 50 % → « à surveiller », pas « critique ».
  assert.equal(signalsOf({ active: 10, riskHigh: 10, highUntouched: 4, planned: 6 })[0].sev, 'warning');
  // Aucun plan : signal à traiter.
  assert.deepEqual(signalsOf({ active: 5, planned: 0 }).map((x) => x.kind), ['no_plan']);
  assert.equal(alertLevel(s), 2);
  assert.equal(alertLevel([]), null);
  // Exécution à 50 % pile : pas de signal.
  assert.deepEqual(signalsOf({ active: 2, planned: 2, visitsPlanned: 2, visitsPlannedRealised: 1 }), []);
});

test('contour partagé : somme des comptes puis taux recalculé (jamais une moyenne de taux)', () => {
  const match = { byPcode: {
    MG52516: { shapeKey: 'ambovombe androy', how: 'exact' },
    MG52516a: { shapeKey: 'ambovombe androy', how: 'parent' },
    MG1: { shapeKey: null, how: 'masque' },
  } };
  const shapes = aggregateShapes([
    { pcode: 'MG52516a', name: 'Antanimora Sud', region: 'Androy', counts: { active: 58, realised: 0, planned: 0 } },
    { pcode: 'MG52516', name: 'Ambovombe-Androy', region: 'Androy', counts: { active: 2, realised: 2, planned: 2, visitsPlanned: 2, visitsPlannedRealised: 2 } },
    { pcode: 'MG1', name: 'Masqué', counts: { active: 9 } },
  ], match, { 'ambovombe androy': 'Ambovombe-Androy' });
  assert.equal(shapes.length, 1);
  const s = shapes[0];
  assert.equal(s.name, 'Ambovombe-Androy');
  assert.deepEqual(s.districts.map((d) => [d.name, d.how]), [['Ambovombe-Androy', 'exact'], ['Antanimora Sud', 'parent']]);
  assert.equal(s.counts.active, 60);
  // (0 % + 100 %) / 2 = 50 % serait faux : 2 / 60.
  assert.ok(Math.abs(s.rates.coverage.value - 2 / 60) < 1e-12);
  assert.equal(s.region, 'Androy');
});

test('pur jumeau du mode « données » : réalisé par les données, hors plan, exécution en site × mois', () => {
  const site = { statuses: new Map(), gridYears: [], visits: [{ month: '2026-02', status: 'planifie' }, { month: '2026-03', status: 'realise' }], dataMonths: ['2026-02', '2026-04'] };
  const f = siteRangeFacts(site, { from: '2026-01', to: '2026-06' }, { todayMonth: '2026-10' });
  assert.equal(f.realised, true); // déclaré en mars
  assert.equal(f.realisedAny, true);
  assert.equal(f.realisedData, true);
  assert.equal(f.vPlanned, 2); // février, mars
  assert.equal(f.vPlannedRealised, 2); // février par les données, mars déclaré
  assert.equal(f.vOffPlan, 1); // avril : données sans visite prévue
  // Données pendant un mois inactif (zone interdite) : jamais une réalisation.
  const g = siteRangeFacts({ forbidden: true, dataMonths: ['2026-02'] }, { from: '2026-01', to: '2026-03' });
  assert.equal(g.realisedAny, false);
  assert.equal(g.vOffPlan, 0);
});

const INDEX = { shapeSet: 'mdg-adm2.v1', source: 'geoBoundaries — Madagascar ADM2', shapes: [
  { key: 'ambovombe androy', name: 'Ambovombe-Androy' }, { key: 'bekily', name: 'Bekily' }, { key: 'betroka', name: 'Betroka' },
] };
const AREAS = {
  districts: [
    { id: 'd1', pcode: 'MG52516', name: 'Ambovombe-Androy', regionId: 'r1', regionPcode: 'MG52', region: 'Androy' },
    { id: 'd2', pcode: 'MG52516a', name: 'Antanimora Sud', regionId: 'r1', regionPcode: 'MG52', region: 'Androy' },
    { id: 'd3', pcode: 'MG52514', name: 'Bekily', regionId: 'r1', regionPcode: 'MG52', region: 'Androy' },
    { id: 'd4', pcode: 'MG53', name: 'Betroka', regionId: 'r2', regionPcode: 'MG54', region: 'Anosy' },
  ],
  regions: [{ id: 'r1', pcode: 'MG52', name: 'Androy' }, { id: 'r2', pcode: 'MG54', name: 'Anosy' }],
};
const f = (dim, keys, counts) => ({ dim, did: null, rid: null, office: null, activity: null, cpcode: null, ...keys, ...counts, knownAll: false });

test('réponse districts : contours, région seulement, sans localité, totaux, régions des contours', () => {
  const raw = {
    facts: [
      f('district', { did: 'd1', rid: 'r1' }, { sites: 2, active: 2, realised: 2, planned: 2, visitsPlanned: 2, visitsPlannedRealised: 2 }),
      f('district', { did: 'd2', rid: 'r1' }, { sites: 58, active: 58, riskHigh: 58, highUntouched: 58 }),
      f('district', { did: null, rid: 'r1' }, { sites: 33, active: 33 }),
      f('district', { did: null, rid: null }, { sites: 2, active: 2 }),
      f('region', { rid: 'r1' }, { sites: 93, active: 93, realised: 2 }),
      f('office', { office: 'o1' }, { sites: 95, active: 95 }),
      f('activity', { activity: 'School meal activities' }, { sites: 95, active: 95 }),
      f('commune', { cpcode: 'MG5251601' }, { sites: 2, active: 2 }),
      f('total', {}, { sites: 95, active: 95, realised: 2, planned: 2, visitsPlanned: 2, visitsPlannedRealised: 2 }),
    ],
    subs: [
      f('district', { did: 'd3', rid: 'r1' }, { submissions: 5, submissionsSite: 0 }),
      f('district', { did: null, rid: null }, { submissions: 13 }),
      f('activity', { activity: 'school meal activities' }, { submissions: 4 }),
      f('total', {}, { submissions: 18, submissionsSite: 0 }),
    ],
    areas: AREAS,
    communes: [{ pcode: 'MG5251601', name: 'Ambovombe', district: 'Ambovombe-Androy', region: 'Androy' }],
    links: [],
    filters: { offices: [{ id: 'o1', name: 'Antenne Ambovombe', parentId: 'b1', parentName: 'Bureau Fort Dauphin' }], activities: [] },
  };
  const r = buildDistrictsResponse(raw, { period: { from: '2026-09', to: '2026-09' }, index: INDEX, withCommunes: true, now: new Date('2026-10-13T16:30:00Z') });
  assert.deepEqual(r.period, { from: '2026-09', to: '2026-09', months: 1 });
  assert.equal(r.activationKnown, false);
  assert.equal(r.geometry.asset, 'geo/mdg-adm2.v1.json');
  assert.deepEqual(r.themes, THEMES);
  // Ambovombe + Antanimora Sud = un contour partagé ; Bekily : données seulement.
  assert.deepEqual(r.shapes.map((s) => [s.key, s.counts.active, s.counts.submissions]), [['ambovombe androy', 60, 0], ['bekily', 0, 5]]);
  assert.equal(r.shapes[1].rates.coverage.reason, 'aucun_site_actif');
  assert.deepEqual(r.shared.map((s) => s.districts.map((d) => d.name)), [['Ambovombe-Androy', 'Antanimora Sud']]);
  assert.deepEqual(r.regionOnly.map((x) => [x.name, x.counts.sites]), [['Androy', 33]]);
  assert.equal(r.unplaced.sites, 2);
  assert.equal(r.submissionsUnlocated, 13);
  assert.equal(r.totals.counts.submissions, 18);
  assert.ok(Math.abs(r.totals.rates.coverage.value - 2 / 95) < 1e-12);
  // Limites de régions : région de chaque contour du découpage (même sans donnée).
  assert.deepEqual(r.shapeRegions, { 'ambovombe androy': 'Androy', bekily: 'Androy', betroka: 'Anosy' });
  // Activité : registre et catégorie de fiche fusionnés sans tenir compte de la casse.
  assert.deepEqual(r.activities.map((a) => [a.name, a.counts.active, a.counts.submissions]), [['School meal activities', 95, 4]]);
  assert.deepEqual(r.offices.map((o) => [o.name, o.parentName]), [['Antenne Ambovombe', 'Bureau Fort Dauphin']]);
  assert.deepEqual(r.communes.map((c) => [c.name, c.district]), [['Ambovombe', 'Ambovombe-Androy']]);
  assert.equal(r.communeCount, 1);
  assert.equal(buildDistrictsResponse(raw, { period: { from: '2026-09', to: '2026-09' }, index: INDEX }).communes, null); // sur demande seulement
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(r.countKeys, COUNT_KEYS);
  assert.equal(r.computedAt, '2026-10-13T16:30:00.000Z');
});

test('réponse districts : district masqué (« ne pas dessiner ») et district sans contour listés', () => {
  const raw = {
    facts: [
      f('district', { did: 'd3', rid: 'r1' }, { sites: 4, active: 4 }),
      f('district', { did: 'd4', rid: 'r2' }, { sites: 3, active: 3 }),
      f('total', {}, { sites: 7, active: 7 }),
    ],
    subs: [],
    areas: AREAS,
    communes: [],
    links: [{ pcode: 'MG52514', shapeKey: null }],
    filters: { offices: [], activities: [] },
  };
  const r = buildDistrictsResponse(raw, { period: { from: '2026-01', to: '2026-03' }, index: { ...INDEX, shapes: INDEX.shapes.filter((s) => s.key !== 'betroka') } });
  assert.deepEqual(r.hidden, [{ pcode: 'MG52514', name: 'Bekily', sites: 4 }]);
  assert.deepEqual(r.unmatched, [{ pcode: 'MG53', name: 'Betroka', sites: 3 }]);
  assert.deepEqual(r.shapes, []);
  assert.deepEqual(countsOf(r.totals.counts).active, 7);
});

test('filtre bureau : ordre de l\'arbre (bureau, antennes, sous-antennes), profondeur, « et ses antennes » à tout niveau ; cycle sans perte', () => {
  const { officeTree } = require('../src/modules/map/mapResponse');
  const offices = [
    { id: 'bek', name: 'Antenne Bekily', parentId: 'amb' },
    { id: 'tsi', name: 'Antenne Tsihombe', parentId: 'amb' },
    { id: 'amp', name: 'Bureau Ampanihy', parentId: null },
    { id: 'fd', name: 'Bureau Fort Dauphin', parentId: null },
    { id: 'amb', name: 'Antenne Ambovombe', parentId: 'fd' },
    { id: 'ama', name: 'Antenne Amboasary', parentId: 'fd' },
    { id: 'orph', name: 'Antenne orpheline', parentId: 'inconnu' },
  ];
  const t = officeTree(offices);
  assert.deepEqual(t.map((o) => [o.name, o.depth, o.hasChildren]), [
    ['Antenne orpheline', 0, false],
    ['Bureau Ampanihy', 0, false],
    ['Bureau Fort Dauphin', 0, true],
    ['Antenne Amboasary', 1, false],
    ['Antenne Ambovombe', 1, true],
    ['Antenne Bekily', 2, false],
    ['Antenne Tsihombe', 2, false],
  ]);
  const cyc = officeTree([{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }]);
  assert.deepEqual(cyc.map((o) => [o.name, o.depth]), [['A', 0], ['B', 1]]);
});
