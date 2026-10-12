const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSav } = require('../src/modules/monitoring/savParser');

const { buildSav } = require('./helpers/savFixture');

/* ------------------------------------------------------------------ tests */

test('en-tête et méta (cases, encodage, bias, caseSize)', () => {
  const buf = buildSav({ cases: [[1, 'AB', 'HELLO']] });
  const r = parseSav(buf);
  assert.equal(r.meta.cases, 1);
  assert.equal(r.meta.declaredCases, 1);
  assert.equal(r.meta.encoding, 'UTF-8');
  assert.equal(r.meta.bias, 100);
  assert.equal(r.meta.caseSize, 4);
});

test('noms longs (extension 13) appliqués, types et largeurs', () => {
  const r = parseSav(buildSav({ cases: [[1, 'AB', 'HELLO']] }));
  assert.deepEqual(r.variables.map((v) => v.name), ['valeur', 'code', 'commentaire']);
  assert.deepEqual(r.variables.map((v) => v.type), ['numeric', 'string', 'string']);
  assert.equal(r.variables[2].width, 16);
});

test('noms courts conservés quand extension 13 absente', () => {
  const r = parseSav(buildSav({ cases: [[1, 'AB', 'HELLO']], withLongNames: false }));
  assert.deepEqual(r.variables.map((v) => v.name), ['NUM', 'STR4', 'STR16']);
});

test('numérique : entier compressé, double brut (253), system-missing (255→null)', () => {
  const r = parseSav(buildSav({ cases: [[42, 'A', 'x'], [1234.5, 'B', 'y'], [null, 'C', 'z']] }));
  assert.equal(r.rows[0].valeur, 42);     // compressé (142-100)
  assert.equal(r.rows[1].valeur, 1234.5); // brut 253
  assert.equal(r.rows[2].valeur, null);   // sysmiss 255
});

test('chaînes : brut, espaces (254→vide), multi-segments concaténés et détourés', () => {
  const r = parseSav(buildSav({ cases: [[1, 'ABCD', 'LONGTEXTE_12345'], [2, '', 'ABCDEFGHij']] }));
  assert.equal(r.rows[0].code, 'ABCD');
  assert.equal(r.rows[0].commentaire, 'LONGTEXTE_12345');  // 16 → 2 segments, concat + trim
  assert.equal(r.rows[1].code, '');                         // 254 espaces → vide
  assert.equal(r.rows[1].commentaire, 'ABCDEFGHij');        // seg1 brut + seg2 brut
});

test('étiquettes de valeurs : brutes par défaut, libellées avec applyValueLabels', () => {
  const buf = buildSav({ cases: [[1, 'A', 'x'], [0, 'B', 'y']] });
  const raw = parseSav(buf);
  assert.equal(raw.rows[0].valeur, 1);
  assert.equal(raw.rows[1].valeur, 0);
  const lab = parseSav(buf, { applyValueLabels: true });
  assert.equal(lab.rows[0].valeur, 'Oui');
  assert.equal(lab.rows[1].valeur, 'Non');
});

test('données non compressées (compression=0)', () => {
  const r = parseSav(buildSav({ cases: [[7, 'ABCD', 'HELLO WORLD'], [9, 'EF', 'z']], compression: 0 }));
  assert.equal(r.meta.compression, 0);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].valeur, 7);
  assert.equal(r.rows[0].code, 'ABCD');
  assert.equal(r.rows[0].commentaire, 'HELLO WORLD');
  assert.equal(r.rows[1].valeur, 9);
});

test('plusieurs cas : nombre de lignes correct', () => {
  const cases = Array.from({ length: 25 }, (_, i) => [i, `C${i}`, `site ${i}`]);
  const r = parseSav(buildSav({ cases }));
  assert.equal(r.rows.length, 25);
  assert.equal(r.rows[24].code, 'C24');
  assert.equal(r.rows[10].commentaire, 'site 10');
});

test('erreurs claires : signature invalide et ZSAV', () => {
  assert.throws(() => parseSav(Buffer.from('NOPE' + 'x'.repeat(200))), /signature|invalide/i);
  const z = buildSav({ cases: [[1, 'A', 'x']] }); z.write('$FL3', 0, 'latin1');
  assert.throws(() => parseSav(z), /ZSAV/i);
  assert.throws(() => parseSav(Buffer.alloc(10)), /court|vide/i);
});
