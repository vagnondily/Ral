/**
 * Pagination exacte du concepteur (web/src/lib/reportPaginate.js, lot 7a, C7) — module web pur,
 * importé ici comme webCharts.test.js : titre gardé avec le suivant, tableau coupé avec en-tête
 * répété, texte coupé par paragraphes, bloc trop haut réduit ou signalé, saut de section = nouvelle
 * géométrie, numéros n / N exacts, géométrie des pages (marges, en-tête, 1re page).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const load = async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/reportPaginate.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const sec = (id, items, extra = {}) => ({ id, size: 'A4', orientation: 'portrait', bodyH: 100, items, ...extra });
const ids = (page) => page.items.map((i) => (i.part ? `${i.iid}[${i.part.join('-')}]` : i.iid));

test('blocs simples : remplissage dans l\'ordre, nouvelle page quand le bloc suivant ne tient plus', async (t) => {
  const p = await load(t); if (!p) return;
  const r = p.paginate([sec('_doc', [{ iid: 'a', h: 40 }, { iid: 'b', h: 40 }, { iid: 'c', h: 30 }])], { gap: 5 });
  assert.equal(r.total, 2);
  assert.deepEqual(r.pages.map(ids), [['a', 'b'], ['c']]);
  assert.deepEqual(r.pageOf, { a: 1, b: 1, c: 2 });
  assert.deepEqual(r.pages.map((x) => x.n), [1, 2]);
});

test('un titre reste avec le bloc qui le suit', async (t) => {
  const p = await load(t); if (!p) return;
  const r = p.paginate([sec('_doc', [{ iid: 'a', h: 70 }, { iid: 'h', h: 10, keepWithNext: true }, { iid: 'tbl', h: 50 }])]);
  assert.deepEqual(r.pages.map(ids), [['a'], ['h', 'tbl']]);
  // Le titre suivi d'un tableau SÉCABLE : il suffit que l'en-tête et une ligne tiennent.
  const s = p.paginate([sec('_doc', [{ iid: 'a', h: 60 }, { iid: 'h', h: 10, keepWithNext: true },
    { iid: 'tbl', h: 200, split: { kind: 'rows', headH: 12, repeatH: 8, footH: 6, rows: Array(20).fill(9) } }])]);
  assert.equal(s.pages[0].items[1].iid, 'h');
  assert.equal(s.pages[0].items[2].iid, 'tbl');
});

test('tableau : coupé entre deux lignes, en-tête répété, pied (source) sur le dernier morceau seulement', async (t) => {
  const p = await load(t); if (!p) return;
  const rows = Array(25).fill(10);
  const r = p.paginate([sec('_doc', [{ iid: 't', h: 0, split: { kind: 'rows', headH: 20, repeatH: 8, footH: 6, rows } }])]);
  // Page 1 : 20 + 8 lignes = 100 ; pages suivantes : 8 + 9 lignes = 98 ; dernière : 8 + lignes + 6.
  assert.deepEqual(r.pages.map(ids), [['t[0-8]'], ['t[8-17]'], ['t[17-25]']]);
  const parts = r.pages.map((x) => x.items[0]);
  assert.deepEqual(parts.map((x) => [x.first, x.last]), [[true, false], [false, false], [false, true]]);
  for (const x of r.pages) assert.ok(x.used <= 100 + 1e-9, `page ${x.n} : ${x.used}`);
  // Jamais un en-tête seul en bas de page : le tableau commence sur une nouvelle page.
  const s = p.paginate([sec('_doc', [{ iid: 'a', h: 85 }, { iid: 't', h: 0, split: { kind: 'rows', headH: 12, repeatH: 8, rows: [10, 10] } }])]);
  assert.deepEqual(s.pages.map(ids), [['a'], ['t[0-2]']]);
});

test('texte : coupé par paragraphes ; une ligne plus haute qu\'une page est placée seule et signalée', async (t) => {
  const p = await load(t); if (!p) return;
  const r = p.paginate([sec('_doc', [{ iid: 'x', h: 60 }, { iid: 'txt', h: 0, split: { kind: 'nodes', headH: 0, nodes: [20, 30, 25, 50] } }])]);
  // Page 1 : 60 + 20 ; page 2 : 30 + 25 (+ 50 dépasserait) ; page 3 : 50.
  assert.deepEqual(r.pages.map(ids), [['x', 'txt[0-1]'], ['txt[1-3]'], ['txt[3-4]']]);
  const big = p.paginate([sec('_doc', [{ iid: 't', h: 0, split: { kind: 'rows', headH: 10, rows: [150, 5] } }])]);
  assert.equal(big.pages[0].items[0].tooTall, true);
  assert.deepEqual(big.pages.map(ids), [['t[0-1]'], ['t[1-2]']]);
});

test('bloc insécable plus haut qu\'une page : graphique réduit à l\'échelle, autre bloc signalé', async (t) => {
  const p = await load(t); if (!p) return;
  const r = p.paginate([sec('_doc', [{ iid: 'a', h: 30 }, { iid: 'chart', h: 250, scalable: true }, { iid: 'cols', h: 180 }])]);
  assert.deepEqual(r.pages.map(ids), [['a'], ['chart'], ['cols']]);
  assert.equal(r.pages[1].items[0].scale, 100 / 250);
  assert.equal(r.pages[2].items[0].tooTall, true);
});

test('saut de section = nouvelle page avec sa géométrie ; saut de page forcé ; section vide sans page blanche', async (t) => {
  const p = await load(t); if (!p) return;
  const r = p.paginate([
    sec('_doc', [{ iid: 'a', h: 10 }, { iid: 'br', break: true }, { iid: 'b', h: 10 }]),
    sec('s1', [], { orientation: 'landscape' }),
    sec('s2', [{ iid: 'c', h: 10 }], { orientation: 'landscape', bodyH: 60 }),
    sec('s3', [{ iid: 'd', h: 10 }]),
  ]);
  assert.deepEqual(r.pages.map(ids), [['a'], ['b'], ['c'], ['d']]);
  assert.deepEqual(r.pages.map((x) => [x.sectionId, x.orientation]), [['_doc', 'portrait'], ['_doc', 'portrait'], ['s2', 'landscape'], ['s3', 'portrait']]);
  assert.equal(r.total, 4);
  // Saut de page en tête de page : aucune page vide.
  const q = p.paginate([sec('_doc', [{ iid: 'br', break: true }, { iid: 'a', h: 10 }])]);
  assert.equal(q.total, 1);
  // Document vide : une page blanche (l'aperçu montre quand même la feuille).
  assert.equal(p.paginate([sec('_doc', [])]).total, 1);
});

test('1re page de hauteur différente (pas d\'en-tête sur la 1re page)', async (t) => {
  const p = await load(t); if (!p) return;
  const r = p.paginate([sec('_doc', [{ iid: 'a', h: 60 }, { iid: 'b', h: 50 }], { firstBodyH: 120 })]);
  assert.deepEqual(r.pages.map(ids), [['a', 'b']]);
});

test('géométrie : A4 portrait / paysage, 16:9, marges, en-tête et pied, règle de 1re page', async (t) => {
  const p = await load(t); if (!p) return;
  const page = { margins: { top: 16, right: 14, bottom: 16, left: 14 }, header: { height: 14, elements: [{}] }, footer: { height: 12, elements: [{}] } };
  const g = p.pageGeometry(page, { size: 'A4', orientation: 'portrait' });
  assert.deepEqual([g.w, g.h, g.bodyW, g.bodyH], [210, 297, 182, 297 - 32 - 26]);
  const l = p.pageGeometry(page, { orientation: 'landscape' });
  assert.deepEqual([l.w, l.h, l.bodyW], [297, 210, 269]);
  assert.deepEqual([p.pageSize('16:9', 'landscape').w, p.pageSize('16:9', 'landscape').h], [338.67, 190.5]);
  assert.equal(p.pageGeometry(page, { header: 'none' }).headerH, 0);
  assert.equal(p.pageGeometry({ ...page, firstPage: 'none' }, {}, { first: true }).bodyH, 297 - 32);
  assert.equal(p.pageGeometry({ ...page, header: { height: 14, elements: [] } }, {}).headerH, 0, 'bande vide : aucune hauteur');
  assert.equal(p.pageName('A4', 'landscape'), 'a4l');
  assert.equal(p.pageName('16:9', 'landscape'), 's169l');
});

test('plan local et sections du plan : sections, colonnes, sections répétées ; sommaire avec les pages', async (t) => {
  const p = await load(t); if (!p) return;
  const doc = { page: { size: 'A4', orientation: 'portrait' }, blocks: [
    { id: 'h1', type: 'heading', params: { text: 'Titre', level: 1 } },
    { id: 'c1', type: 'columns', params: { ratio: '1:1', cols: [[{ id: 'k1', type: 'kpis', params: { metrics: ['coverage'] } }], []] } },
    { id: 's1', type: 'section', params: { orientation: 'landscape' } },
    { id: 'd1', type: 'data', params: { dataset: 'cov.by_office' } },
    { id: 'r1', type: 'repeat', params: { over: 'activity', blocks: [] } },
  ] };
  const plan = p.localPlan(doc);
  assert.deepEqual(plan.sections.map((s) => [s.id, s.orientation]), [['_doc', 'portrait'], ['s1', 'landscape']]);
  const secs = p.sectionsOfPlan(plan);
  assert.deepEqual(secs.map((s) => s.items.map((i) => i.iid)), [['h1', 'c1'], ['d1']]);
  const toc = p.tocEntries({ instances: [{ iid: 'h1', type: 'heading', level: 1, text: 'Titre' }, { iid: 'h3', type: 'heading', level: 3, text: 'Petit' }] }, { h1: 1, h3: 2 }, 2);
  assert.deepEqual(toc, [{ iid: 'h1', level: 1, text: 'Titre', page: 1 }]);
});

test('plan local = plan du serveur : mêmes instances, mêmes numéros de figures et de tableaux, mêmes sections', async (t) => {
  const p = await load(t); if (!p) return;
  const { buildPlan } = require('../src/modules/reports/renderPlan');
  const doc = {
    title: 'R', period: { from: '2026-01', to: '2026-03' }, filters: {}, page: { size: 'A4', orientation: 'portrait' },
    blocks: [
      { id: 'h1', type: 'heading', params: { text: 'Rapport {periode}', level: 1 } },
      { id: 'd1', type: 'data', params: { dataset: 'cov.by_office', view: 'table', filters: {} } },
      { id: 'c1', type: 'columns', params: { ratio: '1:1', cols: [[{ id: 'd2', type: 'data', params: { dataset: 'mon.trend_submissions', view: 'line', filters: {} } }], [{ id: 'k1', type: 'kpis', params: { metrics: ['coverage'], filters: {} } }]] } },
      { id: 's1', type: 'section', params: { orientation: 'landscape', title: 'Annexe' } },
      { id: 'r1', type: 'repeat', params: { over: 'activity', blocks: [{ id: 'rh', type: 'heading', params: { text: '{activite}', level: 2 } }, { id: 'rd', type: 'data', params: { dataset: 'mon.indicators', filters: {} } }] } },
      { id: 'd3', type: 'data', params: { dataset: 'cov.by_activity', view: 'bar', filters: {}, figure: { numbered: false } } },
    ],
  };
  const expansions = { r1: [{ key: 'f1', label: 'Cantines', filters: {} }, { key: 'f2', label: 'Nutrition', filters: {} }] };
  const defaultView = () => 'table';
  const server = buildPlan(doc, { expansions, defaultView, lang: 'fr' });
  const local = p.localPlan(doc, { expansions, defaultView, vars: server.vars });
  const pick = (i) => [i.iid, i.type, i.sectionId, i.figure ? `${i.figure.kind}${i.figure.n}` : '', i.text || ''];
  assert.deepEqual(local.instances.map(pick), server.instances.map(pick));
  assert.deepEqual(local.sections.map((s) => [s.id, s.orientation, s.title]), server.sections.map((s) => [s.id, s.orientation, s.title]));
});

test('annexes (retour 88) : renvoi dans le corps, annexes lettrées à la fin sur leur page, hors numérotation, au sommaire', async (t) => {
  const p = await load(t); if (!p) return;
  const doc = {
    page: { size: 'A4', orientation: 'portrait' },
    blocks: [
      { id: 'h1', type: 'heading', params: { text: 'Rapport', level: 1 } },
      { id: 'big', type: 'data', params: { dataset: 'cov.by_office', view: 'table' } },
      { id: 'd2', type: 'data', params: { dataset: 'cov.by_activity', view: 'table' } },
      { id: 'chart', type: 'data', params: { dataset: 'cov.monthly', view: 'column', annex: true, annexOrientation: 'portrait' } },
      { id: 'keep', type: 'data', params: { dataset: 'cov.by_district', view: 'table', annex: false } },
    ],
  };
  const rows = { big: 40, d2: 10, keep: 90 };
  const annex = {
    isAnnexed: (b, iid, view, inColumn) => p.annexDecision(b, { view, rows: rows[iid] ?? null, autoRows: 25, inColumn }),
    orientationOf: (inst, b) => (b.params.annexOrientation && b.params.annexOrientation !== 'auto' ? b.params.annexOrientation : 'landscape'),
  };
  const plan = p.localPlan(doc, { annex });
  const body = plan.instances.filter((i) => i.sectionId === '_doc').map((i) => i.iid);
  // Le tableau de 40 lignes (> 25) et le graphique marqué partent en annexe ; « keep » (annex: false) reste.
  assert.deepEqual(body, ['h1', 'annexref~big', 'd2', 'annexref~chart', 'keep']);
  // Numérotation du corps sans les annexes : d2 = Tableau 1, keep = Tableau 2.
  const by = Object.fromEntries(plan.instances.map((i) => [i.iid, i]));
  assert.deepEqual(by.d2.figure, { kind: 'table', n: 1 });
  assert.deepEqual(by.keep.figure, { kind: 'table', n: 2 });
  // Annexes A puis B, chacune sa section (nouvelle page) et son orientation, titre puis bloc.
  assert.deepEqual(plan.annexes.map((a) => [a.letter, a.iid, a.orientation]), [['A', 'big', 'landscape'], ['B', 'chart', 'portrait']]);
  assert.deepEqual(by.big.figure, { kind: 'annex', letter: 'A' });
  assert.equal(by['annexref~big'].annex.letter, 'A');
  const secs = p.sectionsOfPlan(plan);
  assert.deepEqual(secs.map((s) => [s.id, s.orientation, s.items.map((i) => i.iid)]), [
    ['_doc', 'portrait', ['h1', 'annexref~big', 'd2', 'annexref~chart', 'keep']],
    ['annex~big', 'landscape', ['annexhead~big', 'big']],
    ['annex~chart', 'portrait', ['annexhead~chart', 'chart']],
  ]);
  // Pagination : chaque annexe commence une nouvelle page ; le sommaire les liste après les titres.
  const pg = p.paginate(secs.map((s) => ({ id: s.id, size: s.size, orientation: s.orientation, bodyH: 1000, items: s.items.map((i) => ({ iid: i.iid, h: 20, keepWithNext: i.type === 'annexhead' })) })));
  assert.deepEqual(pg.pages.map((x) => [x.n, x.orientation]), [[1, 'portrait'], [2, 'landscape'], [3, 'portrait']]);
  const toc = p.tocEntries(plan, pg.pageOf, 2, (a) => `Annexe ${a.letter}`);
  assert.deepEqual(toc.map((e) => [e.text, e.page, e.level]), [['Rapport', 1, 1], ['Annexe A', 2, 1], ['Annexe B', 3, 1]]);
  // Règle de décision : jamais dans une colonne ; seuil sur les vues en lignes seulement ; données pas encore là → corps.
  assert.equal(p.annexDecision(doc.blocks[1], { view: 'table', rows: 40, autoRows: 25, inColumn: true }), false);
  assert.equal(p.annexDecision(doc.blocks[1], { view: 'bar', rows: 40, autoRows: 25 }), false);
  assert.equal(p.annexDecision(doc.blocks[1], { view: 'table', rows: null, autoRows: 25 }), false);
  assert.equal(p.annexDecision(doc.blocks[1], { view: 'table', rows: 25, autoRows: 25 }), false);
  assert.deepEqual([0, 25, 26, 51].map(p.annexLetter), ['A', 'Z', 'AA', 'AZ']);
});

test('en-tête et pied d\'une page (retour 88) : ceux de sa section (aucun / propres) priment sur la règle de la 1re page, puis le document', async (t) => {
  const p = await load(t); if (!p) return;
  const band = (id, h = 12) => ({ height: h, elements: [{ id, kind: 'text', x: 0, y: 0, w: 50, h: 6, text: id }] });
  const page = { header: band('doc'), footer: band('docf'), firstPage: 'own', firstHeader: band('first', 30), firstFooter: band('firstf') };
  const id = (b) => (b ? b.elements[0].id : null);
  // Page 1 sans réglage propre : la 1re page du document.
  assert.deepEqual(Object.values(p.pageBands(page, { header: 'inherit', footer: 'inherit' }, { first: true })).map(id), ['first', 'firstf']);
  // Une page à en-tête PROPRE (même la 1re) : le sien ; « aucun » : rien.
  const own = { header: 'own', headerBand: band('own', 20), footer: 'none' };
  assert.deepEqual(Object.values(p.pageBands(page, own, { first: true })).map(id), ['own', null]);
  assert.deepEqual(Object.values(p.pageBands(page, { header: 'inherit' }, { first: false })).map(id), ['doc', 'docf']);
  assert.deepEqual(Object.values(p.pageBands({ ...page, firstPage: 'none' }, {}, { first: true })).map(id), [null, null]);
  // La zone utile suit la bande effective (30 mm pour la 1re page, 20 mm pour l'en-tête propre).
  const g1 = p.pageGeometry(page, {}, { first: true });
  const g2 = p.pageGeometry(page, own, { first: false });
  assert.equal(g1.headerH, 30);
  assert.equal(g2.headerH, 20);
  assert.equal(g2.footerH, 0);
});

test('annexes : le plan du serveur numérote comme le plan local pour un bloc marqué « en annexe »', async (t) => {
  const p = await load(t); if (!p) return;
  const { buildPlan } = require('../src/modules/reports/renderPlan');
  const doc = {
    title: 'R', period: { from: '2026-01', to: '2026-03' }, filters: {}, page: { size: 'A4', orientation: 'portrait' },
    blocks: [
      { id: 'a', type: 'data', params: { dataset: 'cov.by_office', view: 'table', annex: true, filters: {} } },
      { id: 'b', type: 'data', params: { dataset: 'cov.by_office', view: 'table', filters: {} } },
    ],
  };
  const server = buildPlan(doc, { defaultView: () => 'table', lang: 'fr' });
  const local = p.localPlan(doc, { annex: { isAnnexed: (b, iid, view, inColumn) => p.annexDecision(b, { view, inColumn }) } });
  const fig = (plan, iid) => plan.instances.find((i) => i.iid === iid).figure;
  assert.deepEqual(fig(server, 'a'), fig(local, 'a'));
  assert.deepEqual(fig(server, 'b'), fig(local, 'b'));
  assert.deepEqual(server.annexes, [{ letter: 'A', iid: 'a' }]);
});
