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

test('« Couverture par activité » : constats enregistrés sur l\'ancien libellé brut remis sur la clé d\'activité, réunis, jamais perdus', () => {
  const note = (x) => ({ nodes: [{ t: 'p', c: [{ x }] }] });
  const data = (id, annotations, dataset = 'cov.by_activity') => ({ id, type: 'data', params: { dataset, view: 'table', filters: {}, args: {}, figure: {}, palette: 'sober', annotations } });
  const V2 = {
    schemaVersion: 2, title: 'Rapport', period: { from: '2026-01', to: '2026-03' }, filters: {},
    page: upgradeDoc(V1).doc.page,
    blocks: [
      data('a', { 'School meal activities': note('Cantines : retard'), 'school  meal activities ': note('Deuxième graphie'), '—': note('Sans activité'), 'Nutrition treatment activities': note('Nutrition') }),
      data('o', { 'Bureau Sud': note('Inchangé') }, 'cov.by_office'),
      { id: 'r', type: 'repeat', params: { over: 'bureau', blocks: [data('ra', { 'School meal activities': note('Dans la répétition') })] } },
      { id: 'c', type: 'columns', params: { ratio: '1:1', cols: [[data('ca', { 'School Meal Activities': note('Colonne') })], [{ id: 'h', type: 'heading', params: { text: 'T', level: 2 } }]] } },
    ],
  };
  const { doc, upgraded } = upgradeDoc(V2);
  assert.equal(upgraded, false, 'document v2 : pas une mise à niveau v1');
  const a = doc.blocks[0].params.annotations;
  assert.deepEqual(Object.keys(a), ['school meal activities', '—', 'nutrition treatment activities']);
  // Deux anciennes clés de la même activité : les deux constats, bout à bout, dans l'ordre enregistré.
  assert.deepEqual(a['school meal activities'].nodes.map((n) => n.c[0].x), ['Cantines : retard', 'Deuxième graphie']);
  assert.deepEqual(a['—'], note('Sans activité'));
  assert.deepEqual(doc.blocks[1].params.annotations, { 'Bureau Sud': note('Inchangé') }, 'autres jeux : clés inchangées');
  assert.deepEqual(Object.keys(doc.blocks[2].params.blocks[0].params.annotations), ['school meal activities']);
  assert.deepEqual(Object.keys(doc.blocks[3].params.cols[0][0].params.annotations), ['school meal activities']);
  assert.equal(safeParseDocV2(doc).success, true);
  // Les clés sont celles des lignes du jeu (catalogue : _key = clé d'activité des tableaux de bord).
  const { shapeCoverage, groupRows, siteCounts } = require('../src/modules/dashboards/coverageDefinitions');
  const raw = shapeCoverage(groupRows([{ activity: 'School meal activities', office: 'O', district: 'D', counts: siteCounts({ active: true }) }]));
  const rows = datasetDef('cov.by_activity').shape(raw, {}, { lang: 'fr', args: {} }).rows;
  assert.ok(rows.some((r) => Object.prototype.hasOwnProperty.call(a, r._key)), 'le constat retrouve sa ligne');
  // UNE FOIS : le document mis à niveau est marqué (rowKeys: 2, gardé à l'enregistrement par le
  // schéma) ; un document marqué est rendu tel quel (même objet), jamais re-clé.
  assert.equal(doc.rowKeys, 2);
  assert.equal(safeParseDocV2(doc).data.rowKeys, 2, 'le marqueur survit à la validation (enregistré)');
  const again = upgradeDoc(doc);
  assert.equal(again.doc, doc);
  assert.equal(again.rekeyed, false);
  // Une clé écrite sous le nouveau schéma n'est jamais déplacée, même si elle ressemble à un libellé brut.
  const marked = { ...V2, rowKeys: 2, blocks: [data('a', { 'Nouvelle Clé': note('saisi après') })] };
  assert.equal(upgradeDoc(marked).doc, marked);
});

test('rapport finalisé AVANT le nouveau schéma : jamais re-clé — chaque constat reste sur sa ligne figée, même deux graphies', () => {
  const { rekeyOnRead } = require('../src/modules/reports/reportUpgrade');
  const note = (x) => ({ nodes: [{ t: 'p', c: [{ x }] }] });
  const content = {
    schemaVersion: 2, title: 'Final', period: { from: '2026-01', to: '2026-03' }, filters: {}, page: upgradeDoc(V1).doc.page,
    blocks: [{ id: 'a', type: 'data', params: { dataset: 'cov.by_activity', view: 'table', filters: {}, args: {}, figure: {}, palette: 'sober',
      annotations: { 'Cantine scolaire': note('A : retard'), 'cantine scolaire': note('B : ok') } } }],
  };
  // Finalisé sur l'ancien code : deux graphies = deux lignes figées, chacune son constat (clés brutes).
  const frozen = { a: { ok: true, data: { rows: [{ _key: 'Cantine scolaire' }, { _key: 'cantine scolaire' }] } } };
  const d = { status: 'final', content, snapshot: { format: 2, frozen: true, blocks: frozen } };
  assert.equal(rekeyOnRead(d), false);
  const up = upgradeDoc(content, { rekey: rekeyOnRead(d) });
  assert.equal(up.doc, content, 'rendu tel quel');
  assert.equal(up.rekeyed, false);
  assert.equal(up.doc.rowKeys, undefined, 'aucun marqueur posé');
  const notes = up.doc.blocks[0].params.annotations;
  assert.deepEqual(frozen.a.data.rows.map((r) => notes[r._key]), [note('A : retard'), note('B : ok')], 'chaque ligne : son seul constat');
  // v1 finalisé avant le schéma : mis à niveau, sans re-clé ni marqueur.
  const v1 = upgradeDoc(V1, { rekey: false });
  assert.equal(v1.rekeyed, false);
  assert.equal(v1.doc.rowKeys, undefined);
});

test('rapport finalisé APRÈS le nouveau schéma (snapshot.rowKeys = 2) : constats d\'un contenu jamais réenregistré remis sur les clés des lignes figées', () => {
  const { rekeyOnRead } = require('../src/modules/reports/reportUpgrade');
  const note = (x) => ({ nodes: [{ t: 'p', c: [{ x }] }] });
  // Brouillon enregistré sur l'ancien code (clé brute), finalisé ici sans réenregistrement.
  const content = {
    schemaVersion: 2, title: 'Final', period: { from: '2026-01', to: '2026-03' }, filters: {}, page: upgradeDoc(V1).doc.page,
    blocks: [{ id: 'a', type: 'data', params: { dataset: 'cov.by_activity', view: 'table', filters: {}, args: {}, figure: {}, palette: 'sober',
      annotations: { 'School meal activities': note('Retard') } } }],
  };
  const frozen = { a: { ok: true, data: { rows: [{ _key: 'school meal activities' }, { _key: '—' }] } } };
  const d = { status: 'final', content, snapshot: { format: 2, rowKeys: 2, frozen: true, blocks: frozen } };
  assert.equal(rekeyOnRead(d), true);
  const notes = upgradeDoc(content, { rekey: rekeyOnRead(d) }).doc.blocks[0].params.annotations;
  assert.deepEqual(frozen.a.data.rows.map((r) => notes[r._key] || null), [note('Retard'), null]);
  // Brouillon : toujours remis sur les clés actuelles (ses lignes sont recalculées).
  assert.equal(rekeyOnRead({ status: 'draft', content }), true);
});

test('nouveau rapport créé dans le concepteur : marqué rowKeys: 2 (ses constats ne sont jamais re-clés)', (t) => {
  const file = require('path').join(__dirname, '../../web/src/pages/reports/ReportDesignerPage.jsx');
  if (!require('fs').existsSync(file)) { t.skip('web/ absent'); return; }
  assert.match(require('fs').readFileSync(file, 'utf8'), /onCreate\(\{ schemaVersion: 2, [^}]*blocks, rowKeys: 2 \}/);
});
