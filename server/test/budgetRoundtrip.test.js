const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBudgetWorkbook } = require('../src/modules/contracts/budgetXlsx');
const { parseFlaBudget } = require('../src/modules/contracts/budgetImport');

// The budget Excel the user downloads must be re-importable after offline edits
// (create / update). This locks the export → edit → re-upload round-trip.
test('exported budget workbook re-imports to the same postes', async () => {
  const activities = [{ id: 'act-suivi', label: 'Suivi' }];
  const items = [
    { lineCode: 'IV.suivi', description: 'COLLECTE Indemnité des agents', unitCount: 200, unitCost: 60000, allocations: { 'act-suivi': 1 } },
    { lineCode: 'IV.suivi', description: 'COLLECTE Location voiture', unitCount: 32, unitCost: 300000, allocations: { 'act-suivi': 1 } },
    { lineCode: 'IV.evaluation', description: 'Évaluation finale', unitCount: 1, unitCost: 5000000, allocations: { 'act-suivi': 1 } },
    { lineCode: 'III.formation', description: 'Atelier de restitution', unitCount: 2, unitCost: 1500000, allocations: { 'act-suivi': 1 } },
  ];
  const wb = buildBudgetWorkbook({
    contract: { partnerName: 'ASSOCIATION AINA', reference: 'FLA-2025-AIN', dateDebut: '2025-10-01', dateFin: '2026-09-30' },
    activities, items, feePct: 0.07, months: 12,
  });
  const buffer = await wb.xlsx.writeBuffer();

  const { items: parsed, feePct } = await parseFlaBudget(Buffer.from(buffer));

  assert.equal(parsed.length, items.length, 'every poste is recovered');
  assert.equal(feePct, 0.07, 'commission de gestion round-trips');
  for (const src of items) {
    const got = parsed.find((p) => p.description === src.description);
    assert.ok(got, `poste « ${src.description} » recovered`);
    assert.equal(got.lineCode, src.lineCode, `line code of « ${src.description} »`);
    assert.equal(got.unitCount, src.unitCount, `nb unités of « ${src.description} »`);
    assert.equal(got.unitCost, src.unitCost, `coût unitaire of « ${src.description} »`);
  }
});
