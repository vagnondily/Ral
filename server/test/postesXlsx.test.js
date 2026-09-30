const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplateWorkbook, parsePostesWorkbook } = require('../src/modules/tpm/postesXlsx');
const { normalizeItems, summarize } = require('../src/modules/tpm/reportMath');

const SAMPLE = [
  { lineCode: 'IV.suivi', designation: 'Indemnité des agents', unit: 'homme/jour', unitCount: 60, unitCost: 40000, payBy: 'bailleur' },
  { lineCode: 'V.locaux', designation: 'Loyer bureau', unit: 'mois', unitCount: 1, unitCost: 200000, payBy: 'ong' },
];

test('template round-trips through the parser with every column intact', async () => {
  const buf = await buildTemplateWorkbook({ sampleItems: SAMPLE }).xlsx.writeBuffer();
  const { items, skipped } = await parsePostesWorkbook(buf);
  assert.equal(skipped.length, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0].unit, 'homme/jour');
  assert.equal(items[0].payBy, 'bailleur');
  assert.equal(items[1].unit, 'mois');
  assert.equal(items[1].payBy, 'ong'); // the payer column must survive
});

test('parsed rows still pass the business rules and split bailleur/ONG', async () => {
  const buf = await buildTemplateWorkbook({ sampleItems: SAMPLE }).xlsx.writeBuffer();
  const { items } = await parsePostesWorkbook(buf);
  const s = summarize(normalizeItems(items));
  assert.equal(s.funder, 2400000);
  assert.equal(s.ong, 200000);
  assert.equal(s.total, 2600000);
});

test('the parser accepts either a line code or a line label', async () => {
  // Hand-build a minimal workbook using the same lib to avoid Excel specifics.
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Postes');
  ws.getRow(6).values = ['Ligne', 'Désignation', 'Unité', 'Qté', 'Coût', 'Charge', 'Obs'];
  ws.getRow(7).values = ['Suivi (TPM)', 'Suivi terrain', 'jour', 3, 1000, 'Bailleur', ''];   // by label
  ws.getRow(8).values = ['IV.suivi', 'Transport', 'jour', 2, 500, 'ONG', ''];                 // by code
  const buf = await wb.xlsx.writeBuffer();
  const { items } = await parsePostesWorkbook(buf);
  assert.equal(items.length, 2);
  assert.equal(items[0].lineCode, 'IV.suivi');
  assert.equal(items[1].lineCode, 'IV.suivi');
});

test('a missing « Postes » sheet is rejected clearly', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Autre');
  const buf = await wb.xlsx.writeBuffer();
  await assert.rejects(() => parsePostesWorkbook(buf), (e) => e.code === 'NO_SHEET');
});

test('unrecognized budget lines are skipped, not silently accepted', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Postes');
  ws.getRow(6).values = ['Ligne', 'Désignation', 'Unité', 'Qté', 'Coût', 'Charge', 'Obs'];
  ws.getRow(7).values = ['Ligne inventée', 'Poste douteux', 'u', 1, 1, 'Bailleur', ''];
  const buf = await wb.xlsx.writeBuffer();
  const { items, skipped } = await parsePostesWorkbook(buf);
  assert.equal(items.length, 0);
  assert.equal(skipped.length, 1);
});
