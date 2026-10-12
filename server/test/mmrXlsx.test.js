const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildMmrWorkbook, parseMmrWorkbook, officeResolver } = require('../src/modules/tpm/mmrXlsx');

const OFFICES = [
  { id: 'amp', code: 'AMP', name: 'Bureau Ampanihy' },
  { id: 'ftd', code: 'FTD', name: 'Bureau Fort Dauphin' },
  { id: 'dau', code: 'DAU', name: 'Bureau Dauphin' },
];
const ROWS = [
  { fieldOfficeId: null, activityCategory: 'School meal activities', operationDuration: 10, numberOfSites: 717, riskLevel: 2, feasible: 52 },
  { fieldOfficeId: 'amp', fieldOfficeName: 'Bureau Ampanihy', activityCategory: 'School meal activities', operationDuration: 9, numberOfSites: 213, riskLevel: 2, personsToDeploy: 3, visitsPerDay: 1.5, workingDays: 20, note: 'Dérogation saison' },
];

test('export MEMS → import : portée, saisies et note relues, dérivés ignorés', async () => {
  const buf = await buildMmrWorkbook(ROWS, OFFICES).xlsx.writeBuffer();
  const { rows, errors, skipped } = await parseMmrWorkbook(buf, OFFICES);
  assert.deepEqual(errors, []); assert.deepEqual(skipped, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fieldOfficeId, null);
  assert.equal(rows[0].feasible, 52);
  assert.equal(rows[1].fieldOfficeId, 'amp');
  assert.equal(rows[1].visitsPerDay, 1.5);
  assert.equal(rows[1].workingDays, 20);
  assert.equal(rows[1].note, 'Dérogation saison');
});

test('feuille « Overreaching Parameters » du classeur RBM : en-têtes anglais, bureau en clair, formules externes', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Overreaching Parameters');
  ws.addRow(['CSP Activity Number', 'Field Ofice', 'ID', 'Activity Category', 'Operation duration a year (in months)', 'Number of sites',
    'Risk level\n1=Low\n2=Medium\n3=High', 'Minimum required interval', 'Minimum required frequency', 'Targeted number of sites to visit (per month)',
    'Feasible number of sites to visit (per month)', 'Column1', 'CO adjusted frequency', 'CO adjusted interval', 'Feasible number of sites / Targeted number of sites to visit']);
  ws.addRow([1, 'RBJ Madagascar, Ampanihy Sub Office', '', 'School meal activities ', 9, { formula: "COUNTIFS('[2]Co-Monitoring'!L:L,D2)", result: 213 }, 2, null, null, null, 30]);
  ws.addRow([2, 'RBJ Madagascar, Ampanihy Sub Office', '', 'Nutrition treatment activities ', 12, { formula: "COUNTIFS('[2]Co-Monitoring'!L:L,D3)", result: { error: '#VALUE!' } }, 2, null, null, null, 12]);
  ws.addRow([3, 'RBJ Madagascar, Ampanihy Sub Office', '', 'Emergency preparedness activities ']);
  ws.addRow([4, 'RBJ Madagascar, Fort Dauphin Sub Office', '', 'School meal activities', 6, 10, 3, null, null, null, 2]);
  ws.addRow([5, 'Bureau inconnu', '', 'School meal activities', 6, 10, 3]);
  const { rows, errors, skipped, sheet } = await parseMmrWorkbook(await wb.xlsx.writeBuffer(), OFFICES);
  assert.equal(sheet, 'Overreaching Parameters');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].fieldOfficeId, 'amp');
  assert.equal(rows[0].activityCategory, 'School meal activities'); // espace final retiré
  assert.equal(rows[0].numberOfSites, 213);
  assert.equal(rows[0].feasible, 30); // « Feasible number … per month », pas le ratio
  assert.equal(rows[1].numberOfSites, 0);
  assert.equal(rows[1].numberOfSitesMissing, true); // #VALUE! ⇒ à reprendre du référentiel
  assert.equal(rows[2].fieldOfficeId, 'ftd'); // « Fort Dauphin » l'emporte sur « Dauphin »
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].message, /non paramétrée/);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /non reconnu/);
});

test('résolution de bureau : code, nom exact, puis nom cœur le plus long', () => {
  const r = officeResolver(OFFICES);
  assert.equal(r('amp').id, 'amp');
  assert.equal(r('Bureau Fort Dauphin').id, 'ftd');
  assert.equal(r('RBJ Madagascar, Dauphin Sub Office').id, 'dau');
  assert.equal(r('Toliara'), null);
});
