/**
 * Concepteur (retour 88) : orientation d'UNE page depuis l'onglet Pages — module web pur
 * (web/src/pages/reports/reportDoc.js), importé ici comme webCharts.test.js. Seule la page visée
 * change : son contenu passe dans une section propre, la page suivante retrouve la mise en page
 * d'avant ; une section qui commence déjà là est modifiée, pas doublée.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { parseDocV2 } = require('../src/modules/reports/reportSchema');

const load = async (t) => {
  const file = path.join(__dirname, '../../web/src/pages/reports/reportDoc.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const h = (id) => ({ id, type: 'heading', params: { text: id, level: 2 } });
const sec = (id, params = {}) => ({ id, type: 'section', params: { header: 'inherit', footer: 'inherit', ...params } });
const shape = (blocks) => blocks.map((b) => (b.type === 'section' ? `§${b.params.orientation || '-'}` : b.id));

test('une page au milieu du document : section paysage pour elle, rétablissement après, rien d\'autre ne change', async (t) => {
  const d = await load(t); if (!d) return;
  const blocks = [h('a'), h('b'), h('c'), h('d')];
  const r = d.setPageLayout(blocks, { firstId: 'b', lastId: 'c', patch: { orientation: 'landscape' } });
  assert.deepEqual(shape(r.blocks), ['a', '§landscape', 'b', 'c', '§-', 'd']);
  assert.equal(r.blocks[1].id, r.sectionId);
  // La section de rétablissement n'impose rien : elle suit le document (orientation absente).
  assert.equal(r.blocks[4].params.orientation, undefined);
  // Le document reste valide pour le serveur.
  parseDocV2({ schemaVersion: 2, title: 'T', period: { from: '2026-09', to: '2026-09' }, blocks: r.blocks });
  // Entrée intacte (opération pure).
  assert.deepEqual(shape(blocks), ['a', 'b', 'c', 'd']);
});

test('dernière page : aucune section de rétablissement inutile ; 1re page : section au début', async (t) => {
  const d = await load(t); if (!d) return;
  const last = d.setPageLayout([h('a'), h('b')], { firstId: 'b', lastId: 'b', patch: { orientation: 'landscape' } });
  assert.deepEqual(shape(last.blocks), ['a', '§landscape', 'b']);
  const first = d.setPageLayout([h('a'), h('b')], { firstId: 'a', lastId: 'a', patch: { orientation: 'landscape' } });
  assert.deepEqual(shape(first.blocks), ['§landscape', 'a', '§-', 'b']);
});

test('une section commence déjà à la page : modifiée (pas de section en double), rétablie si elle allait plus loin', async (t) => {
  const d = await load(t); if (!d) return;
  // Section limitée à la page : simplement réorientée.
  const exact = d.setPageLayout([h('a'), sec('s1', { orientation: 'landscape', title: 'X' }), h('b'), sec('s2'), h('c')], { firstId: 'b', lastId: 'b', patch: { orientation: 'portrait' } });
  assert.deepEqual(shape(exact.blocks), ['a', '§portrait', 'b', '§-', 'c']);
  assert.equal(exact.sectionId, 's1');
  assert.equal(exact.blocks[1].params.title, 'X');
  // Section qui couvre aussi la page suivante : la page change, la suite garde l'ancienne orientation.
  const wide = d.setPageLayout([sec('s1', { orientation: 'landscape' }), h('b'), h('c')], { firstId: 'b', lastId: 'b', patch: { orientation: 'portrait' } });
  assert.deepEqual(shape(wide.blocks), ['§portrait', 'b', '§landscape', 'c']);
});

test('page après une section paysage du document : la page devient portrait, la suite reste paysage', async (t) => {
  const d = await load(t); if (!d) return;
  const r = d.setPageLayout([sec('s', { orientation: 'landscape', size: 'A4' }), h('a'), h('b'), h('c')], { firstId: 'b', lastId: 'b', patch: { orientation: 'portrait' } });
  assert.deepEqual(shape(r.blocks), ['§landscape', 'a', '§portrait', 'b', '§landscape', 'c']);
  // « Revenir au document » : orientation absente → celle du document.
  const back = d.setPageLayout(r.blocks, { firstId: 'b', lastId: 'b', patch: { orientation: undefined } });
  assert.equal(back.blocks[2].params.orientation, undefined);
  assert.equal(back.blocks.length, r.blocks.length);
});

test('page dans une section répétée : la mise en page est posée dans la section répétée (même page de chaque élément)', async (t) => {
  const d = await load(t); if (!d) return;
  const rep = { id: 'rep', type: 'repeat', params: { over: 'activity', blocks: [sec('rs', { orientation: 'portrait' }), h('x'), h('y')] } };
  const r = d.setPageLayout([h('a'), rep], { container: 'rep', firstId: 'y', lastId: 'y', patch: { orientation: 'landscape' } });
  assert.deepEqual(shape(r.blocks[1].params.blocks), ['§portrait', 'x', '§landscape', 'y']);
  assert.deepEqual(shape(r.blocks), ['a', 'rep']);
  // Bloc introuvable : rien ne change.
  assert.equal(d.setPageLayout([h('a')], { firstId: 'zz', lastId: 'zz', patch: {} }).sectionId, null);
});
