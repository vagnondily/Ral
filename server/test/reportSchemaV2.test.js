const test = require('node:test');
const assert = require('node:assert/strict');
const { safeParseDocV2, MAX_DOC_BYTES } = require('../src/modules/reports/reportSchema');

const PERIOD = { from: '2026-01', to: '2026-06' };
const base = (blocks, extra = {}) => ({ schemaVersion: 2, title: 'Rapport', period: PERIOD, blocks, ...extra });
const ok = (d) => { const r = safeParseDocV2(d); assert.ok(r.success, JSON.stringify(r.error && r.error.issues.slice(0, 3))); return r.data; };
const ko = (d, re) => { const r = safeParseDocV2(d); assert.equal(r.success, false); if (re) assert.match(JSON.stringify(r.error.issues), re); };
const data = (id, extra = {}) => ({ id, type: 'data', params: { dataset: 'cov.by_office', ...extra } });

test('document minimal : valeurs par défaut posées (page A4 portrait, filigrane, bandes vides)', () => {
  const d = ok(base([]));
  assert.equal(d.page.size, 'A4');
  assert.equal(d.page.orientation, 'portrait');
  assert.equal(d.page.draftWatermark, true);
  assert.deepEqual(d.page.header, { height: 14, elements: [] });
  assert.deepEqual(d.filters, {});
  ko({ ...base([]), schemaVersion: 1 });
});

test('en-tête : éléments placés dans la bande, couleurs et polices sur liste fermée', () => {
  const header = { height: 14, elements: [{ id: 't', kind: 'text', x: 0, y: 2, w: 60, h: 6, text: '{titre} — {periode}' }] };
  ok(base([], { page: { header } }));
  ko(base([], { page: { header: { height: 14, elements: [{ id: 't', kind: 'text', x: 50, y: 2, w: 60, h: 6, text: 'x' }] } } }), /hors de la largeur/);
  ko(base([], { page: { header: { height: 10, elements: [{ id: 't', kind: 'text', x: 0, y: 6, w: 10, h: 6, text: 'x' }] } } }), /hors de la hauteur/);
  ko(base([], { page: { header: { height: 14, elements: [{ id: 't', kind: 'text', x: 0, y: 0, w: 10, h: 6, text: 'x', style: { color: 'red; background:url(x)' } }] } } }));
  ko(base([], { page: { header: { height: 14, elements: [{ id: 't', kind: 'text', x: 0, y: 0, w: 10, h: 6, text: 'x', style: { font: 'Comic Sans' } }] } } }));
  ok(base([], { page: { footer: { height: 12, elements: [{ id: 'n', kind: 'pageNumber', x: 70, y: 2, w: 30, h: 6 }, { id: 'r', kind: 'rect', x: 0, y: 0, w: 100, h: 12, fill: '#eff6fc' }] } } }));
});

test('blocs : section, colonnes sans imbrication, section répétée, données avec figure et filtres « all »', () => {
  ok(base([
    { id: 's', type: 'section', params: { orientation: 'landscape', title: 'Annexe' } },
    { id: 'c', type: 'columns', params: { ratio: '2:1', cols: [[data('d1')], [{ id: 'k', type: 'kpis', params: { metrics: ['coverage'] } }]] } },
    data('d2', { view: 'bar', figure: { title: 'Couverture', note: 'n' }, filters: { office: 'all', formId: 'all', period: { from: '2026-02', to: '2026-03' } } }),
    { id: 'r', type: 'repeat', params: { over: 'partner', blocks: [{ id: 'rs', type: 'section', params: {} }, data('rd')] } },
  ]));
  // Colonnes dans des colonnes, section dans des colonnes : refusés.
  ko(base([{ id: 'c', type: 'columns', params: { ratio: '1:1', cols: [[{ id: 'c2', type: 'columns', params: { ratio: '1:1', cols: [[], []] } }], []] } }]));
  ko(base([{ id: 'c', type: 'columns', params: { ratio: '1:1', cols: [[{ id: 's', type: 'section', params: {} }], []] } }]));
  ko(base([{ id: 'c', type: 'columns', params: { ratio: '1:1:1', cols: [[], []] } }]), /Nombre de colonnes/);
  // Répétition dans une répétition : refusée.
  ko(base([{ id: 'r', type: 'repeat', params: { over: 'bureau', blocks: [{ id: 'r2', type: 'repeat', params: { over: 'activity', blocks: [data('x')] } }] } }]));
  // Bureau : une clé, jamais un nom libre.
  ko(base([data('d', { filters: { office: 'Bekily' } })]), /Bureau invalide/);
  ok(base([data('d', { filters: { office: 'id:6a0f2a47-5e5b-4c3b-9d7e-2f2d1f0a8b11' } })], { filters: { office: 'unlinked' } }));
  // Période d'un bloc : même règle que partout.
  ko(base([data('d', { filters: { period: { from: '2026-05', to: '2026-01' } } })]));
});

test('intégrité : identifiants uniques (répétitions et colonnes comprises), 200 blocs, 12 images, 900 Ko', () => {
  ko(base([data('a'), { id: 'c', type: 'columns', params: { ratio: '1:1', cols: [[data('a')], []] } }]), /double/);
  ko(base([{ id: 'r', type: 'repeat', params: { over: 'activity', blocks: [data('a')] } }, data('a')]), /double/);
  const many = Array.from({ length: 201 }, (_, i) => ({ id: `d${i}`, type: 'divider', params: {} }));
  ko(base(many));
  const nested = [{ id: 'r', type: 'repeat', params: { over: 'activity', blocks: Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, type: 'divider', params: {} })) } },
    ...Array.from({ length: 165 }, (_, i) => ({ id: `y${i}`, type: 'divider', params: {} }))];
  ko(base(nested), /Trop de blocs/);
  const img = (i) => ({ id: `i${i}`, type: 'image', params: { assetId: '6a0f2a47-5e5b-4c3b-9d7e-2f2d1f0a8b11' } });
  ok(base(Array.from({ length: 12 }, (_, i) => img(i))));
  ko(base(Array.from({ length: 13 }, (_, i) => img(i))), /images/);
  const huge = base(Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: 'é'.repeat(9000) }] }] } } })));
  const r = safeParseDocV2(huge);
  assert.equal(r.success, false);
  assert.ok(r.error.issues.some((i) => i.params && i.params.code === 'doc_too_large'));
  assert.ok(MAX_DOC_BYTES < 1024 * 1024);
});

test('annexes (retour 88) : bloc « en annexe » et orientation, seuil de lignes du document borné', () => {
  const d = ok(base([data('a', { annex: true, annexOrientation: 'landscape' }), data('b', { annex: false })], { annexes: { autoRows: 25 } }));
  assert.equal(d.blocks[0].params.annex, true);
  assert.equal(d.annexes.autoRows, 25);
  ok(base([], { annexes: { autoRows: null } }));
  ko(base([], { annexes: { autoRows: 2 } }));
  ko(base([], { annexes: { autoRows: 25, autre: 1 } }));
  ko(base([data('a', { annexOrientation: 'diagonale' })]));
});

test('texte riche : aucun HTML, types de nœuds fermés', () => {
  ko(base([{ id: 'a', type: 'text', params: { doc: { nodes: [{ t: 'script', c: [{ x: 'alert(1)' }] }] } } }]));
  ko(base([{ id: 'a', type: 'html', params: { html: '<img onerror>' } }]));
  ok(base([{ id: 'a', type: 'text', params: { doc: { nodes: [{ t: 'p', c: [{ x: 'ok', b: true, v: 'periode' }] }] } } }]));
});
