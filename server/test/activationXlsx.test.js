const test = require('node:test');
const assert = require('node:assert/strict');
const { buildActivationWorkbook, parseActivationWorkbook, HEADERS } = require('../src/modules/tpm/activationXlsx');

const sites = [
  { code: 'PLAN-0001', publicId: 'S-7K3F-9Q2X', locationId: 'MG23209031001001', tagCode: 'STUNT', name: 'Tsaravary', officeName: 'Manakara', officeCode: '4',
    adm1: 'Vatovavy', district: 'Mananjary', commune: 'Tsaravary', fokontany: 'Tsaravary', activity: 'Prevention of stunting',
    lat: -21.23748, lng: 48.29978, months: { 1: true, 2: true, 3: false }, reason: 'fin du cycle' },
  { code: 'PLAN-0002', locationId: null, tagCode: null, name: 'Sans code POI', months: {} },
];

test('export : colonnes de la feuille « Site Actif », formules vivantes avec leur résultat', async () => {
  const wb = buildActivationWorkbook({ year: 2026, sites });
  const ws = wb.getWorksheet('Site Actif');
  assert.deepEqual(ws.getRow(1).values.slice(1), HEADERS);
  assert.equal(ws.getCell('A3').value.formula, 'C3&O3');
  assert.equal(ws.getCell('A3').value.result, 'MG23209031001001STUNT');
  assert.match(ws.getCell('S3').value.formula, /COUNTIF\(T3:AE3,"Oui"\)/);
  assert.equal(ws.getCell('S3').value.result, 'Oui');
  assert.equal(ws.getCell('T3').value, 'Oui');
  assert.equal(ws.getCell('V3').value, 'Non');
  assert.equal(ws.getCell('W3').value, '');
  assert.equal(ws.getCell('T3').dataValidation.formulae[0], '"Oui,Non"');
  assert.equal(wb.getWorksheet('_mems').state, 'veryHidden');
});

test('aller-retour : mois remplis seulement (vide = inchangé), motif, exercice, ligne d\'instructions ignorée', async () => {
  const buf = await buildActivationWorkbook({ year: 2026, sites }).xlsx.writeBuffer();
  const p = await parseActivationWorkbook(Buffer.from(buf));
  assert.equal(p.sheet, 'Site Actif');
  assert.equal(p.year, 2026);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.rows[0], { line: 3, ident: 'MG23209031001001STUNT', codePoi: 'MG23209031001001', tagCode: 'STUNT', name: 'Tsaravary',
    months: { 1: true, 2: true, 3: false }, reason: 'fin du cycle', publicId: 'S-7K3F-9Q2X' });
  // Sans Code POI : l'identifiant exporté est le code MEMS (résultat de la formule).
  assert.equal(p.rows[1].ident, 'PLAN-0002');
  assert.equal(p.rows[1].name, 'Sans code POI');
});

test('import : valeur de mois invalide nommée avec sa ligne ; plusieurs exercices refusés', async () => {
  const wb = buildActivationWorkbook({ year: 2026, sites: [sites[0]] });
  const ws = wb.getWorksheet('Site Actif');
  ws.getCell('U3').value = 'Peut-être';
  const p = await parseActivationWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.deepEqual(p.errors, [{ line: 3, message: 'Fév : « Peut-être » — Oui ou Non attendu.' }]);
  ws.getCell('U3').value = 'Oui';
  ws.addRow(['X1', 'Autre', 'X1']).getCell(18).value = 2025;
  ws.getCell('T4').value = 'Oui'; for (let c = 21; c <= 31; c += 1) ws.getRow(4).getCell(c).value = 'Non';
  const p2 = await parseActivationWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.ok(p2.errors.some((e) => /Plusieurs exercices/.test(e.message)));
});

test('classeur sans feuille reconnue → NO_SHEET', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Feuil1').addRow(['a', 'b']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await assert.rejects(() => parseActivationWorkbook(buf), (e) => e.code === 'NO_SHEET');
});
