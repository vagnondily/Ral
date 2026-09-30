const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConsolidation, monthRange, monthsRemaining } = require('../src/modules/tpm/consolidation');

const CONTRACTS = [
  {
    id: 'c1', numero: 'CTR-2025-0001', partnerId: 'p1', partnerName: 'AINA',
    dateDebut: '2025-11-01', dateFin: '2026-08-31', periodMonths: 10, monitoringBudget: 10000,
  },
  {
    id: 'c2', numero: 'CTR-2025-0002', partnerId: 'p2', partnerName: 'YPA',
    dateDebut: '2025-11-01', dateFin: '2026-08-31', periodMonths: 10, monitoringBudget: 20000,
  },
];

const MONTHLY = [
  { contractId: 'c1', month: '2025-11', planned: 1000, actual: 1200 },
  { contractId: 'c1', month: '2025-12', planned: 1000, actual: 800 },
  { contractId: 'c2', month: '2025-11', planned: 2000, actual: 0 },
];

test('monthRange lists inclusive months in order', () => {
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('monthRange is empty when end precedes start', () => {
  assert.deepEqual(monthRange('2026-02', '2025-11'), []);
});

test('monthsRemaining counts the current month in and clamps at the period', () => {
  assert.equal(monthsRemaining('2026-08-31', 10, '2026-06'), 3); // Jun, Jul, Aug
  assert.equal(monthsRemaining('2026-08-31', 10, '2026-09'), 0); // past the end
  assert.equal(monthsRemaining('2026-08-31', 10, '2025-01'), 10); // capped at period
});

test('buildConsolidation sums planned and actual per contract', () => {
  const { rows } = buildConsolidation(CONTRACTS, MONTHLY, { today: '2026-01' });
  const aina = rows.find((r) => r.contractId === 'c1');
  assert.equal(aina.budget, 10000);
  assert.equal(aina.planned, 2000);
  assert.equal(aina.actual, 2000);
  assert.equal(aina.remaining, 8000);
});

test('buildConsolidation computes rates against the budget', () => {
  const { rows } = buildConsolidation(CONTRACTS, MONTHLY, { today: '2026-01' });
  const aina = rows.find((r) => r.contractId === 'c1');
  assert.equal(aina.actualRate, 0.2); // 2000 / 10000
  assert.equal(aina.plannedRate, 0.2);
  assert.equal(aina.planVsActual, 1); // 2000 actual / 2000 planned
});

test('buildConsolidation flags overspend when actual exceeds budget', () => {
  const over = buildConsolidation(
    [{ id: 'x', partnerName: 'Z', dateDebut: '2025-11-01', dateFin: '2026-01-31', periodMonths: 3, monitoringBudget: 100 }],
    [{ contractId: 'x', month: '2025-11', planned: 100, actual: 150 }],
    { today: '2025-12' }
  );
  assert.equal(over.rows[0].overspent, true);
  assert.ok(over.rows[0].remaining < 0);
});

test('buildConsolidation grand total recomputes rates on the summed cents', () => {
  const { totals } = buildConsolidation(CONTRACTS, MONTHLY, { today: '2026-01' });
  assert.equal(totals.budget, 30000);
  assert.equal(totals.planned, 4000);
  assert.equal(totals.actual, 2000);
  assert.equal(totals.actualRate, 2000 / 30000);
  assert.equal(totals.contracts, 2);
});

test('buildConsolidation builds the month matrix across every contract period', () => {
  const { months, monthlyTotals } = buildConsolidation(CONTRACTS, MONTHLY, { today: '2026-01' });
  assert.equal(months[0], '2025-11');
  assert.equal(months[months.length - 1], '2026-08');
  const nov = monthlyTotals.find((m) => m.month === '2025-11');
  assert.equal(nov.planned, 3000); // 1000 + 2000
  assert.equal(nov.actual, 1200);
  assert.equal(nov.ecart, -1800);
});

test('buildConsolidation projects remaining consumption from the average burn', () => {
  // 2000 actual over ~9 elapsed months, 1 month remaining.
  const { rows } = buildConsolidation(CONTRACTS, MONTHLY, { today: '2026-08' });
  const aina = rows.find((r) => r.contractId === 'c1');
  assert.equal(aina.monthsRemaining, 1);
  assert.ok(aina.projectedTotal >= aina.actual);
});

test('buildConsolidation tolerates empty inputs', () => {
  const res = buildConsolidation([], [], { today: '2026-01' });
  assert.deepEqual(res.rows, []);
  assert.equal(res.totals.budget, 0);
  assert.deepEqual(res.months, []);
});
