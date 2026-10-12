const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPddTemplate } = require('../src/modules/pdd/pddTemplate');
const { parsePddWorkbook } = require('../src/modules/pdd/pddImport');

const SAMPLE = [
  { month: 2, year: 2026, activity: 'Réponse cyclone — GFD', district: 'Ambovombe', commune: 'Ambanisarika', region: 'Androy',
    partner: 'ONG A', antenne: 'Fort Dauphin', sousBureau: 'Ambovombe', modality: 'Mixte', beneficiaries: 1250, households: 250,
    items: { Riz: 12.5, Huile: 0.75 }, cashUsd: 4200 },
  { month: 12, year: 2026, activity: 'Sécheresse soudure', commune: 'Tsihombe', items: { 'CSB+': 1.2 } },
];

test('le modèle vierge est reconnu par l\'import mais ne contient aucune ligne', async () => {
  const buf = await buildPddTemplate().xlsx.writeBuffer();
  const { rows, sheet } = await parsePddWorkbook(buf);
  assert.equal(sheet, 'PDD base');
  assert.equal(rows.length, 0);
});

test('modèle rempli → import : chaque colonne est relue à la bonne position', async () => {
  const buf = await buildPddTemplate({ sampleRows: SAMPLE }).xlsx.writeBuffer();
  const { rows, skipped } = await parsePddWorkbook(buf);
  assert.equal(rows.length, 2);
  assert.equal(skipped, 0); // les lignes de saisie vides du modèle ne sont pas « ignorées »
  const [a, b] = rows;
  assert.equal(a.periodMonth, '2026-02-01');
  assert.equal(a.hazard, 'cyclone');
  assert.equal(a.district, 'Ambovombe');
  assert.equal(a.commune, 'Ambanisarika');
  assert.equal(a.partner, 'ONG A');
  assert.equal(a.modality, 'Mixte');
  assert.equal(a.beneficiaries, 1250);
  assert.equal(a.households, 250);
  assert.deepEqual(a.items, { Riz: 12.5, Huile: 0.75 });
  assert.equal(a.totalFood, 13.25);
  assert.equal(a.cashUsd, 4200);
  assert.equal(b.periodMonth, '2026-12-01');
  assert.equal(b.hazard, 'drought');
  assert.deepEqual(b.items, { 'CSB+': 1.2 });
});

test('modèle : la liste Modalité propose les valeurs canoniques ; un synonyme est ramené à sa valeur', async () => {
  const ExcelJS = require('exceljs');
  const buf = await buildPddTemplate({ sampleRows: [{ ...SAMPLE[0], modality: 'Vivres' }] }).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.getWorksheet('PDD base').getCell('V7').dataValidation.formulae, ['"Inkind,CBT,Mixte"']);
  const { rows } = await parsePddWorkbook(buf);
  assert.equal(rows[0].modality, 'Inkind');
});
