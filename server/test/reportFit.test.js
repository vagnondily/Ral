/**
 * Largeur des tableaux du concepteur (web/src/lib/reportFit.js, lot 7a, C7) et action « Mettre ce
 * bloc sur une page paysage » (web/src/pages/reports/reportDoc.js) — modules web purs : police
 * réduite jusqu'à 0,8 au plus, « trop large » au-delà → section paysage autour du bloc.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const load = async (t, rel) => {
  const file = path.join(__dirname, '../../web/src', rel);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('tableau étroit : échelle 1 ; un peu large : police réduite, jamais sous 0,8', async (t) => {
  const f = await load(t, 'lib/reportFit.js'); if (!f) return;
  const narrow = [{ key: 'a', type: 'text', label: 'Activité', maxChars: 20, maxWord: 9 }, { key: 'n', type: 'int', label: 'Sites', maxChars: 4 }];
  const r = f.fitTable(narrow, 182);
  assert.equal(r.scale, 1); assert.equal(r.tooWide, false);
  const cols = Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, type: 'pct', label: `Domaine ${i}`, maxChars: 7 }));
  const s = f.fitTable(cols, 182);
  assert.ok(s.scale >= 0.8 && s.scale < 1, `échelle ${s.scale}`);
  assert.equal(s.tooWide, false);
  assert.ok(s.widths.reduce((a, b) => a + b, 0) <= 182 + 1e-6);
});

test('« trop large » (ex. 20 domaines en colonnes) → échelle 0,8 et suggestion paysage ; le paysage suffit', async (t) => {
  const f = await load(t, 'lib/reportFit.js'); if (!f) return;
  const cols = [{ key: 'act', type: 'text', label: 'Activité', maxChars: 40, maxWord: 12 },
    ...Array.from({ length: 16 }, (_, i) => ({ key: `d:${i}`, type: 'pct', label: `Domaine ${i}`, maxChars: 7 }))];
  const portrait = f.fitTable(cols, 182);
  assert.equal(portrait.tooWide, true);
  assert.equal(portrait.scale, 0.8);
  const landscape = f.fitTable(cols, 269);
  assert.equal(landscape.tooWide, false);
});

test('colonnes lues dans les données : valeur et mot les plus longs, colonnes choisies seulement', async (t) => {
  const f = await load(t, 'lib/reportFit.js'); if (!f) return;
  const data = { columns: [{ key: 'name', type: 'text', label: 'Nom' }, { key: 'n', type: 'int', label: 'Nombre' }, { key: 'x', type: 'text', label: 'Caché' }],
    rows: [{ name: 'Climate adaptation and risk management activities', n: 12345, x: 'zzzzzzzzzzzzzzzzzzzzzz' }] };
  const cols = f.tableColumns(data, ['name', 'n']);
  assert.deepEqual(cols.map((c) => c.key), ['name', 'n']);
  assert.equal(cols[0].maxWord, 'management'.length);
  assert.equal(cols[1].maxChars, '12 345'.length);
  assert.equal(f.tableFit(data, ['name', 'n'], 182).tooWide, false);
});

test('« Mettre ce bloc sur une page paysage » : section paysage avant, orientation précédente après', async (t) => {
  const d = await load(t, 'pages/reports/reportDoc.js'); if (!d) return;
  const blocks = [{ id: 'h', type: 'heading', params: { text: 'T' } }, { id: 't', type: 'data', params: { dataset: 'mon.domains_by_activity' } }, { id: 'x', type: 'text', params: {} }];
  const r = d.landscapeAround(blocks, 't', 'portrait');
  assert.equal(r.error, null);
  assert.deepEqual(r.blocks.map((b) => (b.type === 'section' ? `section:${b.params.orientation}` : b.id)), ['h', 'section:landscape', 't', 'section:portrait', 'x']);
  // Dernier bloc : pas de section de fermeture ; section juste avant : réorientée, pas doublée.
  const last = d.landscapeAround([{ id: 's', type: 'section', params: { orientation: 'portrait' } }, { id: 't', type: 'data', params: {} }], 't');
  assert.deepEqual(last.blocks.map((b) => (b.type === 'section' ? `section:${b.params.orientation}` : b.id)), ['section:landscape', 't']);
  // Dans des colonnes : refusé (une colonne ne contient pas de section).
  const cols = [{ id: 'c', type: 'columns', params: { ratio: '1:1', cols: [[{ id: 't', type: 'data', params: {} }], []] } }];
  assert.ok(d.landscapeAround(cols, 't').error);
  // Dans une section répétée : les sections y sont permises.
  const rep = [{ id: 'r', type: 'repeat', params: { over: 'activity', blocks: [{ id: 't', type: 'data', params: {} }, { id: 'y', type: 'text', params: {} }] } }];
  const rr = d.landscapeAround(rep, 't');
  assert.deepEqual(rr.blocks[0].params.blocks.map((b) => (b.type === 'section' ? `section:${b.params.orientation}` : b.id)), ['section:landscape', 't', 'section:portrait', 'y']);
});
