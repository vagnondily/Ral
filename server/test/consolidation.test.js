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

// ---- Période (lot 1b) : budget de la période en centimes entiers, flux sommés sur la plage ----
const { monthlyBudgetCents, periodBudgetCents } = require('../src/modules/tpm/consolidation');

test('monthlyBudgetCents : reste réparti sur les premiers mois, somme exacte', () => {
  assert.deepEqual(monthlyBudgetCents(100000, 3), [33334, 33333, 33333]); // 1 000,00 sur 3 mois
  for (const [total, n] of [[100000, 3], [1, 7], [999999999, 11], [0, 4], [123457, 10]]) {
    const parts = monthlyBudgetCents(total, n);
    assert.equal(parts.length, n);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, `${total} sur ${n}`);
    assert.ok(parts.every((p) => Number.isInteger(p)));
  }
  assert.deepEqual(monthlyBudgetCents(100, 0), []);
});

test('periodBudgetCents : somme des parts des mois communs (chevauchement partiel, hors contrat, sans date)', () => {
  const c = { dateDebut: '2025-11-01', dateFin: '2026-01-31', periodMonths: 3 };
  assert.equal(periodBudgetCents(c, 100000, { from: '2025-11', to: '2026-01' }), 100000);
  assert.equal(periodBudgetCents(c, 100000, { from: '2025-11', to: '2025-11' }), 33334);
  assert.equal(periodBudgetCents(c, 100000, { from: '2025-12', to: '2026-06' }), 66666);
  assert.equal(periodBudgetCents(c, 100000, { from: '2026-02', to: '2026-06' }), 0);
  assert.equal(periodBudgetCents({ dateDebut: null, dateFin: null }, 100000, { from: '2026-01', to: '2026-01' }), null);
  // Sans periodMonths : mois entre début et fin, mois partiels compris, sans plafond de 60.
  const long = { dateDebut: '2020-01-15', dateFin: '2027-12-10', periodMonths: 0 };
  assert.equal(periodBudgetCents(long, 9600, { from: '2027-12', to: '2027-12' }), 100); // 96 mois
});

test('buildConsolidation sans période : sortie profondément égale à la sortie historique', () => {
  const a = buildConsolidation(CONTRACTS, MONTHLY, { today: '2026-01' });
  const b = buildConsolidation(CONTRACTS, MONTHLY.map((m) => ({ ...m, pending: 999 })), { today: '2026-01' });
  assert.deepEqual(a, b, 'le montant en attente ne change rien sans période');
  assert.equal('period' in a, false);
  assert.equal('period' in a.totals, false);
  assert.equal(a.rows.some((r) => 'period' in r), false);
});

test('buildConsolidation avec période : budget de la période, flux de la plage, matrice limitée', () => {
  const monthly = [...MONTHLY, { contractId: 'c1', month: '2026-02', planned: 500, actual: 300, pending: 200 }];
  const out = buildConsolidation(CONTRACTS, monthly, { today: '2026-03', period: { from: '2025-12', to: '2026-02' } });
  assert.deepEqual(out.period, { from: '2025-12', to: '2026-02', months: 3 });
  assert.deepEqual(out.months, ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(out.monthlyTotals.map((m) => m.month), out.months);
  const aina = out.rows.find((r) => r.contractId === 'c1');
  // Cumul « à date » inchangé.
  assert.equal(aina.actual, 2300);
  assert.equal(aina.budget, 10000);
  // Budget 10 000 sur 10 mois → 1 000 par mois × 3 mois communs.
  assert.equal(aina.period.budget, 3000);
  assert.equal(aina.period.planned, 1500); // décembre 1 000 + février 500
  assert.equal(aina.period.actual, 1100); // 800 + 300
  assert.equal(aina.period.pending, 200);
  assert.equal(aina.period.actualRate, 1100 / 3000);
  assert.equal(aina.period.planVsActual, 1100 / 1500);
  const ypa = out.rows.find((r) => r.contractId === 'c2');
  assert.equal(ypa.period.planned, 0);
  assert.equal(ypa.period.planVsActual, null, '— aucun plan, jamais 0 %');
  assert.equal(out.totals.period.budget, 9000);
  assert.equal(out.totals.period.actual, 1100);
  assert.equal(out.totals.period.actualRate, 1100 / 9000);
  const feb = out.monthlyTotals.find((m) => m.month === '2026-02');
  assert.equal(feb.actual, 300);
});

test('buildConsolidation : plage hors contrat → budget de la période 0, taux null ; contrat sans date → inconnu', () => {
  const out = buildConsolidation(
    [...CONTRACTS, { id: 'x', partnerName: 'Z', dateDebut: null, dateFin: null, periodMonths: 0, monitoringBudget: 500 }],
    MONTHLY, { today: '2027-03', period: { from: '2027-01', to: '2027-03' } });
  const aina = out.rows.find((r) => r.contractId === 'c1');
  assert.equal(aina.period.budget, 0);
  assert.equal(aina.period.actualRate, null);
  assert.equal(aina.period.plannedRate, null);
  const x = out.rows.find((r) => r.contractId === 'x');
  assert.equal(x.period.budget, null);
  assert.equal(x.period.budgetKnown, false);
  assert.equal(out.totals.period.budgetUnknown, 1);
  assert.equal(out.totals.period.actualRate, null);
});
