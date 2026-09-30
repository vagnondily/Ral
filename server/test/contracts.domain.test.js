const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/modules/contracts/contracts.domain');

const ACT = [{ id: 'a1', label: 'Suivi' }];

// The real AINA Suivi items (subset is enough to check the maths).
const AINA_ITEMS = [
  ['COLLECTE Indemnité des agents', 200, 60000],
  ['COLLECTE Location voiture', 32, 300000],
  ['COLLECTE Carburant voiture', 360, 4900],
].map(([description, unitCount, unitCost]) => ({ lineCode: 'IV.suivi', description, unitCount, unitCost, allocations: { a1: 1 } }));

test('workflow transitions', () => {
  assert.equal(d.transitionTarget('submit', 'brouillon'), 'en_validation');
  assert.equal(d.transitionTarget('approve', 'en_validation'), 'actif');
  assert.equal(d.transitionTarget('terminate', 'actif'), 'resilie');
  assert.equal(d.transitionTarget('submit', 'rejete'), 'en_validation');
  assert.equal(d.transitionTarget('approve', 'brouillon'), null);
  assert.equal(d.transitionTarget('approve', 'resilie'), null);
});

test('isEditable only for draft/rejected', () => {
  assert.equal(d.isEditable('brouillon'), true);
  assert.equal(d.isEditable('rejete'), true);
  assert.equal(d.isEditable('actif'), false);
});

test('computeBudget sums items = qty × unit cost, per line/section/activity', () => {
  const b = d.computeBudget(AINA_ITEMS, ACT, 0.07, 0);
  // 12 000 000 + 9 600 000 + 1 764 000 = 23 364 000 direct
  assert.equal(b.direct.total, 23364000);
  assert.equal(b.managementFee.pct, 0.07);
  assert.equal(b.managementFee.amount, Math.round(23364000 * 0.07 * 100) / 100);
  assert.equal(b.total.grand, 23364000 + Math.round(23364000 * 0.07 * 100) / 100);
  const secIV = b.sections.find((s) => s.code === 'IV');
  assert.equal(secIV.total, 23364000);
  const suivi = secIV.lines.find((l) => l.lineCode === 'IV.suivi');
  assert.equal(suivi.total, 23364000);
  assert.equal(suivi.items.length, 3);
  assert.equal(suivi.items[0].amount, 12000000);
  assert.equal(suivi.byActivity.a1, 23364000);
});

test('full AINA Suivi total is exactly 41 164 000 and accord total 44 045 480', () => {
  const rows = [
    [7, 40000], [28, 40000], [140, 40000], [7, 20000], [25, 1000], [25, 3000], [7, 150000], [7, 50000],
    [10, 80000], [40, 70000], [200, 60000], [32, 300000], [360, 4900], [300, 10000], [32, 80000],
  ].map(([unitCount, unitCost], i) => ({ lineCode: 'IV.suivi', description: `poste ${i}`, unitCount, unitCost, allocations: { a1: 1 } }));
  assert.equal(d.directTotal(rows), 41164000);
  assert.equal(d.grandTotal(rows, 0.07), 44045480);
  const b = d.computeBudget(rows, ACT, 0.07, 0);
  assert.equal(b.total.grand, 44045480);
});

test('monitoring line vs validated spend', () => {
  const b = d.computeBudget(AINA_ITEMS, ACT, 0.07, 25000000); // spent > 23.364M
  assert.equal(b.monitoring.budget, 23364000);
  assert.equal(b.monitoring.spent, 25000000);
  assert.equal(b.monitoring.overspent, true);
});

test('monthly ceiling = total ÷ months', () => {
  assert.equal(d.monthlyCeiling(44045480, 12), Math.round((44045480 / 12) * 100) / 100);
  assert.equal(d.monthsBetween('2025-10-01', '2026-09-30'), 12);
  assert.equal(d.monthsBetween('2026-03-01', '2026-11-30'), 9);
});

test('normalizeBudgetItems validates line, description, amounts, allocation', () => {
  assert.throws(() => d.normalizeBudgetItems([{ lineCode: 'Z.foo', description: 'x', unitCount: 1, unitCost: 1, allocations: { a1: 1 } }], ['a1']), /inconnue/);
  assert.throws(() => d.normalizeBudgetItems([{ lineCode: 'IV.suivi', description: 'x', unitCount: 1, unitCost: 1, allocations: { a1: 1 } }], ['a1']), /description/);
  assert.throws(() => d.normalizeBudgetItems([{ lineCode: 'IV.suivi', description: 'Agents', unitCount: -1, unitCost: 1, allocations: { a1: 1 } }], ['a1']), /Quantité/);
  assert.throws(() => d.normalizeBudgetItems([{ lineCode: 'IV.suivi', description: 'Agents', unitCount: 1, unitCost: 1, allocations: { a1: 0.5 } }], ['a1']), /100 %/);
  const ok = d.normalizeBudgetItems([{ lineCode: 'IV.suivi', description: 'Agents', unitCount: 200, unitCost: 60000, allocations: {} }], ['a1']);
  assert.equal(ok[0].allocations.a1, 1); // defaults to 100% on the only activity
});

test('renewal window & date maths', () => {
  assert.equal(d.renewalWindowOpen('2026-11-30', '2026-09-23'), true);
  assert.equal(d.renewalWindowOpen('2026-12-31', '2026-09-23'), false);
  assert.equal(d.daysBetween('2026-09-23', '2026-11-30'), 68);
  assert.equal(d.addDays('2026-12-31', 1), '2027-01-01');
});

test('numbering & reference', () => {
  assert.equal(d.contractNumber(2026, 7), 'CTR-2026-0007');
  assert.equal(d.displayReference('WFP-MDG-2025-AIN-MULTI-003', 2), 'WFP-MDG-2025-AIN-MULTI-003-AM02');
  assert.equal(d.displayReference(null, 1), null);
});

test('normalizeAmendment keeps only real date / fee changes', () => {
  const contract = { dateDebut: '2026-01-01', dateFin: '2026-12-31', managementFeePct: 0.07 };
  assert.deepEqual(d.normalizeAmendment({ newDateFin: '2027-03-31' }, contract), { newDateFin: '2027-03-31' });
  assert.deepEqual(d.normalizeAmendment({ newFeePct: 0.1 }, contract), { newFeePct: 0.1 });
  assert.throws(() => d.normalizeAmendment({ newDateFin: '2026-12-31' }, contract), /aucune modification/);
  assert.throws(() => d.normalizeAmendment({ newFeePct: 2 }, contract), /Commission/);
});
