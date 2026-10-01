const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSav } = require('../src/modules/monitoring/savParser');

/* --------------------------------------------------------------------------
 * Encodeur .sav minimal (pour les tests) : construit un System File SPSS
 * little-endian avec 3 variables — NUM (numérique), STR4 (chaîne 4), STR16
 * (chaîne 16 → 2 segments) — et des options activables (étiquettes de valeurs,
 * noms longs, encodage, compression bytecode ou non). Permet de tester chaque
 * option de façon déterministe, sans fichier externe.
 * ------------------------------------------------------------------------ */
const BIAS = 100;
function fixed(str, n) { const b = Buffer.alloc(n, 0x20); Buffer.from(String(str), 'latin1').copy(b, 0, 0, n); return b; }
function i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; }
function f64(v) { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b; }

function varRecord(type, name, labelText) {
  const parts = [i32(2), i32(type), i32(labelText ? 1 : 0), i32(0), i32(0), i32(0), fixed(name || '', 8)];
  if (labelText) {
    const lb = Buffer.from(labelText, 'utf8');
    parts.push(i32(lb.length), lb);
    const pad = (4 - (lb.length % 4)) % 4; if (pad) parts.push(Buffer.alloc(pad, 0x20));
  }
  return Buffer.concat(parts);
}

function valueLabelRecord(pairs, varIndex) {
  const parts = [i32(3), i32(pairs.length)];
  for (const [value, label] of pairs) {
    const lb = Buffer.from(label, 'utf8');
    parts.push(f64(value), Buffer.from([lb.length]), lb);
    const used = 1 + lb.length; const pad = (8 - (used % 8)) % 8; if (pad) parts.push(Buffer.alloc(pad, 0x20));
  }
  parts.push(i32(4), i32(1), i32(varIndex));
  return Buffer.concat(parts);
}

function extRecord(subtype, text) {
  const data = Buffer.from(text, 'utf8');
  return Buffer.concat([i32(7), i32(subtype), i32(1), i32(data.length), data]);
}

function packData(items) {
  const chunks = [];
  for (let i = 0; i < items.length; i += 8) {
    const block = items.slice(i, i + 8);
    const cmd = Buffer.alloc(8, 0);
    const datas = [];
    block.forEach((it, j) => { cmd[j] = it.code; if (it.data) datas.push(it.data); });
    chunks.push(cmd, ...datas);
  }
  return Buffer.concat(chunks);
}

function numItem(v) {
  if (v === null) return { code: 255 };
  if (Number.isInteger(v) && v + BIAS >= 1 && v + BIAS <= 251) return { code: v + BIAS };
  return { code: 253, data: f64(v) };
}
function strSeg(text8) { // text8 déjà calé sur 8 octets
  if (/^\s{8}$/.test(text8)) return { code: 254 };
  return { code: 253, data: fixed(text8, 8) };
}
function strItems(value, width) {
  const padded = fixed(value, width).toString('latin1');
  const items = [];
  for (let o = 0; o < width; o += 8) items.push(strSeg(padded.slice(o, o + 8).padEnd(8, ' ')));
  return items;
}

function buildSav({ cases, compression = 1, withLabels = true, withLongNames = true, withEncoding = true } = {}) {
  const header = Buffer.concat([
    fixed('$FL2', 4), fixed('@(#) test', 60), i32(2), i32(4), i32(compression), i32(0), i32(cases.length),
    f64(BIAS), fixed('01 Jan 26', 9), fixed('00:00:00', 8), fixed('TEST', 64), Buffer.alloc(3, 0x20),
  ]);
  const dict = [
    varRecord(0, 'NUM', 'Un nombre'),
    varRecord(4, 'STR4'),
    varRecord(16, 'STR16'),
    varRecord(-1, ''), // continuation de STR16
  ];
  if (withLabels) dict.push(valueLabelRecord([[1, 'Oui'], [0, 'Non']], 1));
  if (withEncoding) dict.push(extRecord(20, 'UTF-8'));
  if (withLongNames) dict.push(extRecord(13, 'NUM=valeur\tSTR4=code\tSTR16=commentaire'));
  dict.push(i32(999), i32(0));

  const items = [];
  for (const [num, s4, s16] of cases) {
    items.push(numItem(num));
    items.push(...strItems(s4, 4));
    items.push(...strItems(s16, 16));
  }
  items.push({ code: 252 }); // fin de fichier
  const data = compression === 1 ? packData(items)
    : Buffer.concat(cases.flatMap(([num, s4, s16]) => [
      f64(num === null ? 0 : num), fixed(s4, 4).subarray(0, 8), fixed(s4, 4).length < 8 ? Buffer.alloc(0) : Buffer.alloc(0),
      fixed(s16, 16),
    ]));
  // uncompressed path réécrit proprement ci-dessous
  if (compression === 0) {
    const raw = [];
    for (const [num, s4, s16] of cases) {
      raw.push(f64(num === null ? 0 : num));
      raw.push(fixed(s4, 8)); // STR4 occupe 1 slot de 8
      const p = fixed(s16, 16); raw.push(p.subarray(0, 8), p.subarray(8, 16));
    }
    return Buffer.concat([header, ...dict, ...raw]);
  }
  return Buffer.concat([header, ...dict, data]);
}

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
