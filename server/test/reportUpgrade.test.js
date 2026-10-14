const test = require('node:test');
const assert = require('node:assert/strict');
const { upgradeDoc, upgradeSnapshot } = require('../src/modules/reports/reportUpgrade');
const { safeParseDocV2 } = require('../src/modules/reports/reportSchema');
const { datasetDef } = require('../src/modules/reports/catalog');

const OFFICE = '6a0f2a47-5e5b-4c3b-9d7e-2f2d1f0a8b11';
const officeIdByName = new Map([['bekily', OFFICE]]);
const viewsOf = (k) => { const d = datasetDef(k); return d ? { views: d.views, defaultView: d.defaultView } : null; };
const V1 = {
  title: 'Bulletin', period: { from: '2026-01', to: '2026-03' },
  page: { orientation: 'landscape', header: 'Bulletin — {periode}', footer: 'Suivi & évaluation', showPageNumbers: true },
  blocks: [
    { id: 'k', type: 'kpis', params: { metrics: ['sites_visited', 'coverage', 'visits_done', 'sites_visited_all'], filters: { bureau: 'Bekily' } } },
    { id: 't', type: 'table', params: { title: 'Par bureau', dataset: 'bureau_coverage', columns: ['bureau', 'rate'], limit: 5, filters: { bureau: 'Inconnu' } } },
    { id: 'c', type: 'chart', params: { title: 'Mois', dataset: 'completeness_monthly', kind: 'matrix', filters: {} } },
    { id: 'b', type: 'chart', params: { dataset: 'region_submissions', kind: 'line', filters: {} } },
    { id: 'x', type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: 'Sites : ' }, { x: '', v: 'sites_visited' }] }] } } },
    { id: 'r', type: 'repeat', params: { over: 'bureau', blocks: [{ id: 'rk', type: 'kpis', params: { metrics: ['visits_done'] } }] } },
  ],
};

test('en-tête, pied et numéros de page v1 → éléments placés ; orientation conservée', () => {
  const { doc } = upgradeDoc(V1, { officeIdByName, viewsOf });
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.page.orientation, 'landscape');
  assert.deepEqual(doc.page.header.elements.map((e) => [e.kind, e.text]), [['text', 'Bulletin — {periode}']]);
  assert.deepEqual(doc.page.footer.elements.map((e) => e.kind), ['text', 'pageNumber']);
  assert.equal(doc.page.footer.elements[1].style.align, 'right');
  const noNumbers = upgradeDoc({ ...V1, page: { showPageNumbers: false } }).doc;
  assert.equal(noNumbers.page.footer.elements.length, 0);
});

test('table / chart → bloc « données » ; jeux et chiffres clés renommés ; variables des textes aussi', () => {
  const { doc } = upgradeDoc(V1, { officeIdByName, viewsOf });
  const [k, t, c, b, x, r] = doc.blocks;
  assert.deepEqual(k.params.metrics, ['sites_realised', 'coverage', 'visits_realised', 'sites_with_data']);
  assert.deepEqual([t.type, t.params.dataset, t.params.view, t.params.figure.title, t.params.columns, t.params.limit], ['data', 'cov.by_office', 'table', 'Par bureau', ['bureau', 'rate'], 5]);
  assert.deepEqual([c.params.dataset, c.params.view], ['cov.completeness_monthly', 'heat']);
  assert.equal(x.params.doc.nodes[0].c[1].v, 'sites_realised');
  assert.deepEqual(r.params.blocks[0].params.metrics, ['visits_realised']);
  // Une vue de graphique que le jeu v2 ne propose pas : sa vue par défaut, avec un avertissement.
  assert.deepEqual([b.params.dataset, b.params.view], ['mon.by_region', datasetDef('mon.by_region').defaultView]);
  // Le résultat est un document v2 valide.
  const v = safeParseDocV2(doc);
  assert.ok(v.success, JSON.stringify(v.error && v.error.issues));
});

test('bureau par nom → clé d\'identifiant ; nom introuvable : filtre retiré et avertissement', () => {
  const { doc, warnings } = upgradeDoc(V1, { officeIdByName, viewsOf });
  assert.equal(doc.blocks[0].params.filters.office, `id:${OFFICE}`);
  assert.equal(doc.blocks[1].params.filters.office, undefined);
  assert.ok(warnings.some((w) => w.blockId === 't' && /Inconnu/.test(w.message)));
  assert.ok(warnings.some((w) => w.blockId === 'b' && /remplacée/.test(w.message)));
  // Sans table des bureaux : aucun filtre inventé.
  assert.equal(upgradeDoc(V1).doc.blocks[0].params.filters.office, undefined);
});

test('idempotente sur un document v2 ; entrée invalide renvoyée telle quelle', () => {
  const once = upgradeDoc(V1, { officeIdByName, viewsOf }).doc;
  const twice = upgradeDoc(once, { officeIdByName, viewsOf });
  assert.equal(twice.upgraded, false);
  assert.strictEqual(twice.doc, once);
  assert.equal(upgradeDoc(null).doc, null);
});

test('données figées v1 → forme v2 (identifiants d\'instance, chiffres renommés), sans recalcul', () => {
  const snap = {
    periodLabel: 'Janvier à mars 2026', variables: { sites_visited: 12, coverage: 40 },
    blocks: { t: { columns: [{ key: 'a', label: 'A', type: 'text' }], rows: [{ a: 'x' }] }, k: { values: { visits_done: 3 } } },
    repeats: { r: [{ key: 'Bekily', label: 'Bekily', blocks: { rk: { values: { visits_done: 1 } } } }] },
  };
  const up = upgradeSnapshot(snap);
  assert.equal(up.format, 2);
  assert.deepEqual(up.blocks.t.data.rows, [{ a: 'x' }]);
  assert.deepEqual(up.blocks.k.data.values, { visits_realised: 3 });
  assert.deepEqual(up.blocks['r~Bekily~rk'].data.values, { visits_realised: 1 });
  assert.deepEqual(up.expansions.r, [{ key: 'Bekily', label: 'Bekily', filters: {} }]);
  assert.deepEqual(up.vars, { sites_realised: 12, coverage: 40 });
  assert.strictEqual(upgradeSnapshot(up), up);
});
