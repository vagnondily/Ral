const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDataset, computeKpis, repeatItems, bulletinDoc, monthsBetween } = require('../src/modules/reports/reportData');
const { requiredSources } = require('../src/modules/reports/reports.service');

const SOURCES = {
  monitoring: {
    submissions: 300,
    regions: [{ region: 'Androy', submissions: 200, communes: 12 }],
    forms: [
      { id: 'f-smp', label: 'SMP', sitesActive: 1278, visits: 938, sitesVisited: 753, index: 71,
        monthly: [{ month: '2026-01', sites: 280 }, { month: '2026-03', sites: 350 }],
        dims: [{ name: 'D1 Cuisine', score: 74 }, { name: 'D6 Gouvernance', score: 52 }],
        indicators: [{ label: 'Cuisine présente', module: 'D1 Cuisine', value: 97.04, base: 688, target: 90, cls: 'exc' }, { label: 'Comité actif', module: 'D6 Gouvernance', value: 53, base: 700, target: 80, cls: 'urg' }],
        bureaux: [{ bureau: 'Bekily', n: 249, visits: 249, sitesVisited: 201, index: 64, dims: [{ name: 'D6 Gouvernance', score: 72 }] }, { bureau: 'Tuléar', n: 88, visits: 88, sitesVisited: 70, index: 70, dims: [] }] },
      { id: 'f-miaro', label: 'MIARO', sitesActive: 162, visits: 21, sitesVisited: 20, index: 82, monthly: [], dims: [{ name: 'D1 Cuisine', score: 89 }], indicators: [], bureaux: [] },
      { id: 'f-vide', label: 'Résilience', sitesActive: null, visits: 0, sitesVisited: 0, index: null, monthly: [], dims: [], indicators: [], bureaux: [] },
    ],
  },
  field: { byOffice: [{ bureau: 'Bekily', sitesActive: 400, planned: 120, done: 90 }, { bureau: 'Tuléar', sitesActive: 300, planned: 0, done: 0 }], monthly: [{ month: '2026-01', planned: 60, done: 45 }] },
  budget: { rows: [{ numero: 'CTR-1', partnerName: 'TOHANA', budget: 1000000, planned: 600000, actual: 450000, actualRate: 0.45 }] },
  pdd: [{ month: '2026-01', beneficiaries: 1000, households: 200, food: 12.3456, cash: 500 }],
};
const PERIOD = { from: '2026-01', to: '2026-03' };

test('couverture par activité : sites visités ÷ sites actifs, sans activité rattachée → vide', () => {
  const d = buildDataset('activity_coverage', SOURCES, {}, PERIOD);
  assert.deepEqual(d.rows[0], { activity: 'SMP', visits: 938, sitesVisited: 753, sitesActive: 1278, coverage: 58.9, score: 71 });
  assert.equal(d.rows[2].coverage, null);
  assert.equal(buildDataset('activity_coverage', SOURCES, { formId: 'f-miaro' }, PERIOD).rows.length, 1);
});

test('scores par domaine : colonnes dynamiques (union des domaines), score global en dernier', () => {
  const d = buildDataset('activity_domains', SOURCES, {}, PERIOD);
  assert.deepEqual(d.columns.map((c) => c.key), ['activity', 'd:D1 Cuisine', 'd:D6 Gouvernance', 'score']);
  assert.equal(d.rows[1]['d:D1 Cuisine'], 89);
  assert.equal(d.rows[1]['d:D6 Gouvernance'], undefined);
});

test('jeux « par fiche » : exigent une activité ; filtre bureau et domaine', () => {
  assert.match(buildDataset('bureau_domains', { monitoring: { forms: [] } }, {}, PERIOD).note, /activité/);
  const b = buildDataset('bureau_domains', SOURCES, { formId: 'f-smp', bureau: 'Bekily' }, PERIOD);
  assert.equal(b.rows.length, 1); assert.equal(b.rows[0]['d:D6 Gouvernance'], 72);
  const i = buildDataset('indicator_list', SOURCES, { formId: 'f-smp', module: 'D6 Gouvernance' }, PERIOD);
  assert.deepEqual(i.rows, [{ label: 'Comité actif', module: 'D6 Gouvernance', value: 53, base: 700, target: 80, band: 'urg' }]);
});

test('complétude mensuelle : un % par mois de la période (mois sans donnée = 0)', () => {
  const d = buildDataset('completeness_monthly', SOURCES, {}, PERIOD);
  assert.deepEqual(d.columns.slice(2).map((c) => c.key), ['m:2026-01', 'm:2026-02', 'm:2026-03']);
  assert.equal(d.rows[0]['m:2026-01'], 21.9); assert.equal(d.rows[0]['m:2026-02'], 0); assert.equal(d.rows[2]['m:2026-01'], null);
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('chiffres clés : globaux, par activité, par bureau ; budget et PDD', () => {
  const k = computeKpis(SOURCES, {});
  assert.equal(k.sites_active, 1440); assert.equal(k.sites_visited, 773); assert.equal(k.coverage, 53.7);
  assert.equal(k.execution_rate, 75); assert.equal(k.conformity, 77); assert.equal(k.submissions, 300);
  assert.equal(k.consumption, 45); assert.equal(k.pdd_food, 12.3);
  const kb = computeKpis(SOURCES, { bureau: 'Bekily' });
  assert.equal(kb.visits_planned, 120); assert.equal(kb.conformity, 64);
  // Par bureau : sites visités et visites du bureau (pas le total), couverture sur ses sites actifs, PDD masqué.
  assert.equal(kb.sites_visited, 201); assert.equal(kb.submissions, 249); assert.equal(kb.sites_active, 400); assert.equal(kb.coverage, 50.2);
  assert.equal(kb.pdd_food, null); assert.equal(kb.pdd_beneficiaries, null);
  assert.equal(computeKpis(SOURCES, { formId: 'f-miaro' }).submissions, 21);
});

test('bloc répété : une section par activité AYANT des données ; par bureau = union triée', () => {
  assert.deepEqual(repeatItems('activity', SOURCES).map((i) => i.label), ['SMP', 'MIARO']);
  assert.deepEqual(repeatItems('bureau', SOURCES).map((i) => i.key), ['Bekily', 'Tuléar']);
});

test('bulletin auto : phrases chiffrées, domaines faibles et couverture insuffisante', () => {
  const doc = bulletinDoc(computeKpis(SOURCES, {}), SOURCES, 'janvier à mars 2026');
  const text = JSON.stringify(doc);
  assert.match(text, /773 site\(s\)/); assert.match(text, /D6 Gouvernance \(SMP : 52 %\)/);
  assert.match(text, /MIARO \(12.3 %\)/);
  const en = JSON.stringify(bulletinDoc(computeKpis(SOURCES, {}), SOURCES, 'January to March 2026', 'en'));
  assert.match(en, /Over the period January to March 2026/); assert.match(en, /773 site\(s\)/);
  assert.match(en, /D6 Gouvernance \(SMP: 52 %\)/); assert.doesNotMatch(en, /Sur la période|Domaines sous/);
});

test('sources requises : seulement celles des blocs présents', () => {
  assert.deepEqual(requiredSources([{ type: 'table', params: { dataset: 'pdd_by_month' } }]), { monitoring: false, field: false, budget: false, pdd: true });
  assert.deepEqual(requiredSources([{ type: 'kpis', params: { metrics: ['consumption'] } }]), { monitoring: false, field: false, budget: true, pdd: false });
  assert.equal(requiredSources([{ type: 'heading', params: { text: 'x' } }]).monitoring, false);
  // La couverture prend ses sites actifs au terrain quand les fiches n'ont pas de catégorie d'activité.
  assert.deepEqual(requiredSources([{ type: 'kpis', params: { metrics: ['coverage'] } }]), { monitoring: true, field: true, budget: false, pdd: false });
  // Un chiffre inséré comme variable dans un texte charge sa source.
  const text = { type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: 'Budget : ' }, { x: '', v: 'budget_total' }] }, { t: 'ul', items: [[{ x: '', v: 'pdd_food' }]] }] } } };
  assert.deepEqual(requiredSources([text]), { monitoring: false, field: false, budget: true, pdd: true });
});

test('couverture : une fiche NON rattachée au MMR ne gonfle pas le numérateur', () => {
  const src = { ...SOURCES, monitoring: { ...SOURCES.monitoring, forms: [
    ...SOURCES.monitoring.forms.filter((f) => f.id !== 'f-vide'),
    { id: 'f-libre', label: 'Libre', sitesActive: null, visits: 500, sitesVisited: 400, index: null, monthly: [], dims: [], indicators: [], bureaux: [] },
  ] } };
  const k = computeKpis(src, {});
  assert.equal(k.sites_visited, 1173);   // toutes les fiches (chiffre affiché)
  assert.equal(k.sites_active, 1440);    // fiches rattachées seulement
  assert.equal(k.coverage, 53.7);        // 773 / 1440 : même ensemble de fiches (et non 1173 / 1440)
});
