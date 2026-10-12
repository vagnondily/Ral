const test = require('node:test');
const assert = require('node:assert/strict');
const { readXls, isOleFile, rkValue, XlsError } = require('../src/modules/monitoring/xlsReader');
const { parseXlsformRows } = require('../src/modules/monitoring/xlsformImport');
const { oleFile } = require('./helpers/oleFixture');

// ---- Fabrication d'un .xls synthétique (BIFF8 dans un conteneur OLE v3) -------------
const rec = (type, data) => { const h = Buffer.alloc(4); h.writeUInt16LE(type, 0); h.writeUInt16LE(data.length, 2); return Buffer.concat([h, data]); };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const bof = (dt) => rec(0x0809, Buffer.concat([u16(0x0600), u16(dt), Buffer.alloc(12)]));
const eof = () => rec(0x000a, Buffer.alloc(0));
const cell = (row, col) => Buffer.concat([u16(row), u16(col), u16(0)]);
const compressed = (s) => Buffer.concat([u16(s.length), Buffer.from([0]), Buffer.from(s, 'latin1')]);

function workbookStream({ padding = 0 } = {}) {
  // SST : « type », « name » puis « Coordonnées » coupé : 6 caractères compressés dans le SST,
  // la suite en UTF-16 dans un CONTINUE qui commence par un nouvel octet d'options.
  const sst = rec(0x00fc, Buffer.concat([u32(3), u32(3), compressed('type'), compressed('name'),
    u16(11), Buffer.from([0]), Buffer.from('Coordo', 'latin1')]));
  const cont = rec(0x003c, Buffer.concat([Buffer.from([1]), Buffer.from('nnées', 'utf16le')]));
  const sheetName = Buffer.concat([Buffer.from([6, 0]), Buffer.from('survey', 'latin1')]);
  const filler = padding ? rec(0x1234, Buffer.alloc(padding)) : Buffer.alloc(0); // enregistrement inconnu, ignoré
  const head = (pos) => Buffer.concat([bof(0x0005), rec(0x0085, Buffer.concat([u32(pos), Buffer.from([0, 0]), sheetName])), sst, cont, filler, eof()]);
  const sheet = Buffer.concat([
    bof(0x0010),
    rec(0x00fd, Buffer.concat([cell(0, 0), u32(0)])), rec(0x00fd, Buffer.concat([cell(0, 1), u32(1)])), rec(0x00fd, Buffer.concat([cell(0, 2), u32(2)])),
    rec(0x027e, Buffer.concat([cell(1, 0), u32((7 << 2) | 2)])),            // RK entier 7
    rec(0x027e, Buffer.concat([cell(1, 1), u32((1234 << 2) | 3)])),         // RK entier ÷ 100 → 12,34
    rec(0x0203, Buffer.concat([cell(1, 2), (() => { const b = Buffer.alloc(8); b.writeDoubleLE(3.25); return b; })()])),
    rec(0x0006, Buffer.concat([cell(2, 0), Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff]), Buffer.alloc(6)])), // formule → texte
    rec(0x0207, compressed('calcul')),
    rec(0x0204, Buffer.concat([cell(2, 1), compressed('Été')])),          // LABEL
    eof(),
  ]);
  const globals = head(0);
  return Buffer.concat([head(globals.length), sheet]);
}


const EXPECTED = [['type', 'name', 'Coordonnées'], [7, 12.34, 3.25], ['calcul', 'Été']];

test('.xls : flux ordinaire — chaînes partagées coupées (CONTINUE), nombres RK/NUMBER, formule texte, LABEL', () => {
  const buf = oleFile(workbookStream({ padding: 5000 }));
  assert.equal(isOleFile(buf), true);
  const { sheets, order } = readXls(buf);
  assert.deepEqual(order, ['survey']);
  assert.deepEqual(sheets.survey, EXPECTED);
});

test('.xls : petit flux rangé dans le mini-flux', () => {
  const { sheets } = readXls(oleFile(workbookStream()));
  assert.deepEqual(sheets.survey, EXPECTED);
});

test('.xls : erreurs explicites (pas un .xls, fichier protégé)', () => {
  assert.throws(() => readXls(Buffer.from('PK\u0003\u0004 pas un xls')), XlsError);
  const enc = workbookStream({ padding: 5000 });
  enc.writeUInt16LE(0x002f, 20); // le 1er enregistrement après le BOF devient FILEPASS
  assert.throws(() => readXls(oleFile(enc)), /mot de passe/);
});

test('RK : entiers signés, décimaux et ×100', () => {
  assert.equal(rkValue((7 << 2) | 2), 7);
  assert.equal(rkValue(((-5 << 2) | 2) >>> 0), -5);
  assert.equal(rkValue((1234 << 2) | 3), 12.34);
  const b = Buffer.alloc(8); b.writeDoubleLE(0.5); assert.equal(rkValue(b.readUInt32LE(4)), 0.5);
});

test('XLSForm lu depuis un .xls : champs et choix reconnus', () => {
  const rows = [['type', 'name', 'label'], ['select_one oui_non', 'visite', 'Visite faite ?'], ['integer', 'nb', 'Nombre']];
  const choices = [['list_name', 'name', 'label'], ['oui_non', 1, 'Oui'], ['oui_non', 0, 'Non']];
  const parsed = parseXlsformRows(rows, choices, [['form_title'], ['Suivi SMP']]);
  assert.equal(parsed.fields.length, 2);
  assert.deepEqual(parsed.choices.oui_non.map((c) => c.value), ['1', '0']);
  assert.equal(parsed.title, 'Suivi SMP');
});
