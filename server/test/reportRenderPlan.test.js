const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, effectiveFilters, substitute, blockOfInstance, MAX_REPEAT_ITEMS } = require('../src/modules/reports/renderPlan');
const { parseDocV2 } = require('../src/modules/reports/reportSchema');

const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '22222222-2222-4222-8222-222222222222';
const OFF = 'id:33333333-3333-4333-8333-333333333333';
const data = (id, view, extra = {}) => ({ id, type: 'data', params: { dataset: 'cov.by_office', view, ...extra } });
const doc = parseDocV2({
  schemaVersion: 2, title: 'Rapport', period: { from: '2026-01', to: '2026-06' }, filters: { office: OFF },
  page: { header: { height: 14, elements: [{ id: 'h', kind: 'text', x: 0, y: 0, w: 100, h: 6, text: '{titre} · {periode} · {section} · {inconnue}' }] } },
  blocks: [
    { id: 'h1', type: 'heading', params: { text: 'Bilan {periode}', level: 1 } },
    data('t1', 'table'),
    { id: 'col', type: 'columns', params: { ratio: '1:1', cols: [[data('g1', 'bar')], [data('t2', 'heat')]] } },
    { id: 'k', type: 'kpis', params: { metrics: ['coverage'], filters: { office: 'all' } } },
    { id: 'x', type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: 'Couverture : ' }, { x: '', v: 'coverage' }] }] } } },
    { id: 'y', type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: 'Sans chiffre' }] }] } } },
    { id: 'rep', type: 'repeat', params: { over: 'activity', blocks: [
      { id: 's', type: 'section', params: { orientation: 'landscape', title: 'Activité {activite}' } },
      { id: 'rh', type: 'heading', params: { text: '{activite}', level: 2 } },
      data('rg', 'line', { filters: { formId: 'all' } }),
      data('rt', 'table'),
    ] } },
    data('n', 'kpi'),
    data('u', 'table', { figure: { numbered: false } }),
  ],
});
const expansions = { rep: [{ key: F1, label: 'SMP', filters: { formId: F1 } }, { key: F2, label: 'MIARO', filters: { formId: F2 } }] };
const plan = buildPlan(doc, { expansions, kpiKeys: new Set(['coverage']), lang: 'fr', today: '2026-07-02' });
const byIid = Object.fromEntries(plan.instances.map((i) => [i.iid, i]));

test('identifiants d\'instance stables : bloc à la racine, répétition~élément~bloc dans une section répétée', () => {
  assert.ok(byIid.t1 && byIid.g1 && byIid.t2);
  assert.ok(byIid[`rep~${F1}~rg`] && byIid[`rep~${F2}~rt`]);
  assert.deepEqual(plan.instances.filter((i) => i.repeatId === 'rep').map((i) => i.iid.split('~')[1]), [F1, F1, F1, F1, F2, F2, F2, F2]);
  assert.equal(blockOfInstance(doc, `rep~${F2}~rt`).id, 'rt');
  assert.equal(blockOfInstance(doc, 'g1').id, 'g1');
  assert.equal(blockOfInstance(doc, 'nope'), null);
});

test('numérotation dans l\'ordre du document, colonnes et répétitions comprises (Tableau / Figure)', () => {
  const fig = (iid) => byIid[iid].figure && `${byIid[iid].figure.kind} ${byIid[iid].figure.n}`;
  assert.equal(fig('t1'), 'table 1');
  assert.equal(fig('g1'), 'figure 1');
  assert.equal(fig('t2'), 'table 2'); // matrice = tableau
  assert.equal(fig(`rep~${F1}~rg`), 'figure 2');
  assert.equal(fig(`rep~${F1}~rt`), 'table 3');
  assert.equal(fig(`rep~${F2}~rg`), 'figure 3');
  assert.equal(fig(`rep~${F2}~rt`), 'table 4');
  assert.equal(byIid.n.figure, undefined); // tuile : pas de numéro
  assert.equal(byIid.u.figure, undefined); // non numérotée
});

test('filtres effectifs : bloc > élément répété > rapport ; « all » retire le filtre', () => {
  assert.equal(byIid.t1.filters.office, OFF);
  assert.equal(byIid.k.filters.office, undefined);
  assert.equal(byIid[`rep~${F1}~rt`].filters.formId, F1);
  assert.equal(byIid[`rep~${F1}~rg`].filters.formId, undefined);
  assert.equal(byIid[`rep~${F1}~rt`].filters.office, OFF);
  assert.deepEqual(effectiveFilters({ period: { from: '2026-01', to: '2026-02' }, filters: { partnerId: 'p' } }, { period: { from: '2026-02', to: '2026-02' }, module: 'D1' }),
    { period: { from: '2026-02', to: '2026-02' }, partnerId: 'p', module: 'D1' });
});

test('besoins en données : données, chiffres clés, bulletin, texte avec chiffre clé — pas un texte simple', () => {
  assert.equal(byIid.x.needsData, true);
  assert.equal(byIid.y.needsData, false);
  assert.equal(byIid.h1.needsData, false);
  assert.equal(byIid.k.needsData, true);
});

test('sections : géométrie propre, titre avec variables de l\'élément ; en-tête rempli, variable inconnue gardée', () => {
  assert.equal(plan.sections.length, 3);
  assert.deepEqual(plan.sections.map((s) => s.orientation), ['portrait', 'landscape', 'landscape']);
  assert.deepEqual(plan.sections.slice(1).map((s) => s.title), ['Activité SMP', 'Activité MIARO']);
  assert.equal(byIid[`rep~${F2}~rt`].sectionId, plan.sections[2].id);
  assert.equal(plan.sections[1].headerText.h, 'Rapport · Janvier à juin 2026 · Activité SMP · {inconnue}');
  assert.equal(byIid.h1.text, 'Bilan Janvier à juin 2026');
  assert.equal(byIid[`rep~${F2}~rh`].text, 'MIARO');
  assert.equal(substitute('{aa} {bb}', { aa: 1 }), '1 {bb}');
});

test('limites : 30 éléments répétés, 300 instances — sinon erreur « filtrez »', () => {
  const many = { rep: Array.from({ length: MAX_REPEAT_ITEMS + 1 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, filters: {} })) };
  assert.throws(() => buildPlan(doc, { expansions: many }), (e) => e.code === 'too_many_items');
  const small = { rep: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, filters: {} })) };
  assert.throws(() => buildPlan(doc, { expansions: small, maxInstances: 50 }), (e) => e.code === 'too_many_instances');
});
