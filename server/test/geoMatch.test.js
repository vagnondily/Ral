/**
 * District ↔ contour (modules/map/geoMatch.js). Base de démonstration : 119 noms
 * exacts + Antanimora Sud (MG52516a, scindé après 2018) dessiné avec le contour
 * d'Ambovombe-Androy (MG52516) = 120/120.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { matchDistricts, normKey, parentPcode } = require('../src/modules/map/geoMatch');
const index = require('../src/modules/map/shapes/mdg-adm2.v1.json');

const shapes = [
  { key: 'betioky atsimo', name: 'Betioky Atsimo' },
  { key: 'ambovombe androy', name: 'Ambovombe-Androy' },
  { key: 'anosibe anala', name: "Anosibe An'ala" },
  { key: 'toliary ii', name: 'Toliary-II' },
  { key: 'bekily', name: 'Bekily' },
];

test('normKey identique à celui du build des contours (web/scripts/geoBuild.js)', async (t) => {
  const file = path.join(__dirname, '../../web/scripts/geoBuild.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const web = await import(pathToFileURL(file).href);
  for (const s of ["Anosibe-An'ala", 'Fénérive Est', '  Toliary–II ', 'Mananara-Avaratra', 'Port-Bergé (Boriziny-Vaovao)', 'ÎLE  Sainte-Marie', null]) {
    assert.equal(normKey(s), web.normKey(s), String(s));
  }
  for (const s of index.shapes) assert.equal(normKey(s.name), s.key);
});

test('exact, puis normalisé (accents, apostrophes, tirets, casse)', () => {
  const r = matchDistricts({
    shapes,
    districts: [
      { pcode: 'MG51506', name: 'Betioky Atsimo' },
      { pcode: 'MG11', name: 'Anosibe-Anala' },
      { pcode: 'MG12', name: 'TOLIARY II' },
    ],
  });
  assert.deepEqual(r.byPcode.MG51506, { shapeKey: 'betioky atsimo', how: 'exact', sharedWith: [] });
  assert.equal(r.byPcode.MG11.how, 'normalise');
  assert.equal(r.byPcode.MG11.shapeKey, 'anosibe anala');
  assert.equal(r.byPcode.MG12.how, 'normalise');
  assert.deepEqual(r.unmatched, []);
});

test('contour parent : MG52516a (Antanimora Sud) → contour de MG52516, partagé et signalé', () => {
  assert.equal(parentPcode('MG52516a'), 'MG52516');
  assert.equal(parentPcode('MG52516'), null);
  const r = matchDistricts({
    shapes,
    districts: [{ pcode: 'MG52516a', name: 'Antanimora Sud' }, { pcode: 'MG52516', name: 'Ambovombe-Androy' }],
  });
  assert.deepEqual(r.byPcode.MG52516a, { shapeKey: 'ambovombe androy', how: 'parent', sharedWith: ['MG52516'] });
  assert.deepEqual(r.byPcode.MG52516.sharedWith, ['MG52516a']);
  assert.deepEqual(r.byShape['ambovombe androy'].sort(), ['MG52516', 'MG52516a']);
  assert.deepEqual(r.conflicts, []);
});

test('manuel prioritaire ; manuel null = masqué ; contour disparu de l\'index → automatique, signalé', () => {
  const links = new Map([['MG51506', 'bekily'], ['MG2', null], ['MG3', 'contour inconnu']]);
  const r = matchDistricts({
    shapes, links,
    districts: [{ pcode: 'MG51506', name: 'Betioky Atsimo' }, { pcode: 'MG2', name: 'Bekily' }, { pcode: 'MG3', name: 'Toliary-II' }],
  });
  assert.deepEqual(r.byPcode.MG51506, { shapeKey: 'bekily', how: 'manuel', sharedWith: [] });
  assert.deepEqual(r.byPcode.MG2, { shapeKey: null, how: 'masque', sharedWith: [] });
  assert.deepEqual(r.hidden, ['MG2']);
  assert.equal(r.byPcode.MG3.how, 'exact');
  assert.deepEqual(r.staleLinks, ['MG3']);
});

test('conflit : deux districts sur le même contour par le nom → dessinés partagés et listés, jamais écartés', () => {
  const r = matchDistricts({
    shapes,
    districts: [{ pcode: 'A1', name: 'Bekily' }, { pcode: 'A2', name: 'BEKILY' }, { pcode: 'A3', name: 'Inconnu' }],
  });
  assert.deepEqual(r.conflicts, [{ shapeKey: 'bekily', pcodes: ['A1', 'A2'] }]);
  assert.equal(r.byPcode.A1.how, 'conflit');
  assert.equal(r.byPcode.A2.shapeKey, 'bekily');
  assert.deepEqual(r.byPcode.A1.sharedWith, ['A2']);
  assert.deepEqual(r.unmatched, ['A3']);
});

test('index réel : les 119 contours se rapprochent d\'eux-mêmes par leur nom exact', () => {
  const r = matchDistricts({ shapes: index.shapes, districts: index.shapes.map((s, i) => ({ pcode: `P${i}`, name: s.name })) });
  assert.equal(Object.values(r.byPcode).filter((m) => m.how === 'exact').length, 119);
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(r.conflicts, []);
});
