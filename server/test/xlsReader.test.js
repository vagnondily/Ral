const test = require('node:test');
const assert = require('node:assert/strict');
const { readXls, isOleFile, rkValue, XlsError } = require('../src/modules/monitoring/xlsReader');
const { parseXlsformRows } = require('../src/modules/monitoring/xlsformImport');

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

function oleFile(stream) {
  const SS = 512; const FREE = 0xffffffff; const END = 0xfffffffe;
  const sectors = (buf) => { const n = Math.ceil(buf.length / SS); const out = Buffer.alloc(n * SS); buf.copy(out); return out; };
  const fat = Array(128).fill(FREE); fat[0] = 0xfffffffd; fat[1] = END;
  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x3e, 0x18); header.writeUInt16LE(3, 0x1a); header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e); header.writeUInt16LE(6, 0x20); header.writeUInt32LE(1, 0x2c); header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(4096, 0x38); header.writeUInt32LE(END, 0x44);
  for (let i = 0; i < 109; i += 1) header.writeUInt32LE(i === 0 ? 0 : FREE, 0x4c + i * 4);
  const entry = (name, type, start, size, child = FREE) => {
    const e = Buffer.alloc(128); Buffer.from(`${name}\0`, 'utf16le').copy(e); e.writeUInt16LE((name.length + 1) * 2, 64);
    e[66] = type; e.writeUInt32LE(FREE, 68); e.writeUInt32LE(FREE, 72); e.writeUInt32LE(child, 76); e.writeUInt32LE(start, 116); e.writeUInt32LE(size, 120);
    return e;
  };
  let body; let root; let wbEntry;
  if (stream.length >= 4096) { // flux ordinaire : secteurs 2.. chaînés dans la FAT
    const data = sectors(stream); const n = data.length / SS;
    for (let i = 0; i < n; i += 1) fat[2 + i] = i === n - 1 ? END : 3 + i;
    header.writeUInt32LE(END, 0x3c);
    root = entry('Root Entry', 5, END, 0, 1); wbEntry = entry('Workbook', 2, 2, stream.length);
    body = data;
  } else { // petit flux : mini-secteurs de 64 octets dans le flux de la racine
    const mini = Buffer.alloc(Math.ceil(stream.length / 64) * 64); stream.copy(mini);
    const nMini = mini.length / 64; const miniFat = Array(128).fill(FREE);
    for (let i = 0; i < nMini; i += 1) miniFat[i] = i === nMini - 1 ? END : i + 1;
    const container = sectors(mini); const n = container.length / SS;
    fat[2] = END; for (let i = 0; i < n; i += 1) fat[3 + i] = i === n - 1 ? END : 4 + i;
    header.writeUInt32LE(2, 0x3c); header.writeUInt32LE(1, 0x40);
    const mf = Buffer.alloc(SS); miniFat.forEach((v, i) => mf.writeUInt32LE(v, i * 4));
    root = entry('Root Entry', 5, 3, mini.length, 1); wbEntry = entry('Workbook', 2, 0, stream.length);
    body = Buffer.concat([mf, container]);
  }
  const fatSec = Buffer.alloc(SS); fat.forEach((v, i) => fatSec.writeUInt32LE(v, i * 4));
  const dir = Buffer.concat([root, wbEntry, Buffer.alloc(256)]);
  return Buffer.concat([header, fatSec, dir, body]);
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
