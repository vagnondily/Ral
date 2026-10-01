const test = require('node:test');
const assert = require('node:assert/strict');
const { monthKey, pickRate, toUsd } = require('../src/modules/common/currencyMath');

test('monthKey normalises strings and dates', () => {
  assert.equal(monthKey('2026-05'), '2026-05');
  assert.equal(monthKey('2026-05-14'), '2026-05');
  assert.equal(monthKey(new Date('2026-05-14T00:00:00Z')), '2026-05');
  assert.equal(monthKey(null), null);
});

test('pickRate uses the latest rate at or before the period (no future extrapolation)', () => {
  const rates = [
    { effectiveMonth: '2026-01', usdRate: 4500 },
    { effectiveMonth: '2026-04', usdRate: 4700 },
    { effectiveMonth: '2026-07', usdRate: 4800 },
  ];
  assert.equal(pickRate(rates, '2026-03'), 4500); // avant avril → janvier
  assert.equal(pickRate(rates, '2026-04'), 4700); // mois exact
  assert.equal(pickRate(rates, '2026-06'), 4700); // reporte avril
  assert.equal(pickRate(rates, '2026-12'), 4800); // reporte juillet
  assert.equal(pickRate(rates, '2025-12'), null); // aucun taux antérieur
  assert.equal(pickRate([], '2026-05'), null);
});

test('pickRate ignores non-positive or malformed rates', () => {
  const rates = [{ effectiveMonth: '2026-01', usdRate: 0 }, { effectiveMonth: '2026-02', usdRate: 4600 }];
  assert.equal(pickRate(rates, '2026-01'), null);
  assert.equal(pickRate(rates, '2026-03'), 4600);
});

test('toUsd converts ariary at the rate, rounded to the cent', () => {
  assert.equal(toUsd(4500, 4500), 1);
  assert.equal(toUsd(1000000, 4700), 212.77);
  assert.equal(toUsd(0, 4500), 0);
  assert.equal(toUsd(1000, 0), null);   // taux invalide
  assert.equal(toUsd(1000, null), null);
});
