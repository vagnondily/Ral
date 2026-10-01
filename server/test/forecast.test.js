const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForecast } = require('../src/modules/contracts/forecast');

const base = {
  budget: 12000000,
  dateDebut: '2026-01', dateFin: '2026-12',
  monthlyActual: [
    { month: '2026-01', actual: 900000 },
    { month: '2026-02', actual: 1100000 },
    { month: '2026-03', actual: 1000000 },
  ],
  asOf: '2026-03',
};

test('projects remaining months at the observed average burn', () => {
  const f = buildForecast(base);
  assert.equal(f.realizedToDate, 3000000);
  assert.equal(f.elapsedMonths, 3);
  assert.equal(f.avgMonthlyBurn, 1000000);          // 3,000,000 / 3
  // 12 mois : 3 réalisés (3M) + 9 projetés × 1M = 12M
  assert.equal(f.projectedTotal, 12000000);
  assert.equal(f.projectedRemaining, 0);
  assert.equal(f.willOverspend, false);
  assert.equal(f.series.length, 12);
  assert.equal(f.series[2].isFuture, false);
  assert.equal(f.series[3].isFuture, true);
  assert.equal(f.series[3].amount, 1000000);
});

test('flags an overspend when the burn outpaces the budget', () => {
  const f = buildForecast({ ...base, budget: 9000000 });
  assert.equal(f.projectedTotal, 12000000);
  assert.equal(f.willOverspend, true);
  assert.equal(f.projectedOverrun, 3000000);
});

test('honours a target month earlier than contract end, clamped to [now, end]', () => {
  const f = buildForecast({ ...base, until: '2026-06' });
  assert.equal(f.until, '2026-06');
  assert.equal(f.series.length, 6);                 // jan..juin
  assert.equal(f.projectedTotal, 6000000);          // 3M + 3×1M
  // cible avant le mois courant → ramenée au mois courant
  assert.equal(buildForecast({ ...base, until: '2026-01' }).until, '2026-03');
  // cible après la fin → ramenée à la fin du contrat
  assert.equal(buildForecast({ ...base, until: '2027-05' }).until, '2026-12');
});

test('no realized yet → zero burn, projection stays flat', () => {
  const f = buildForecast({ ...base, monthlyActual: [], asOf: '2026-01' });
  assert.equal(f.avgMonthlyBurn, 0);
  assert.equal(f.projectedTotal, 0);
  assert.equal(f.projectedRemaining, 12000000);
});
