const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { monthKey, pickRate, toUsd, sumUsdCents } = require('../src/modules/common/currencyMath');

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

// Taux de démonstration (Paramétrage) : janvier 4 500, mai 4 650, septembre 4 720 Ar pour 1 $.
const DEMO_RATES = [{ effectiveMonth: '2026-01', usdRate: 4500 }, { effectiveMonth: '2026-05', usdRate: 4650 }, { effectiveMonth: '2026-09', usdRate: 4720 }];
const VALIDATED = [
  { amountAr: 6000000, period: '2026-01-01' }, // 1 333,33 $
  { amountAr: 7500000, period: '2026-05-01' }, // 1 612,90 $
  { amountAr: 1300000, period: '2026-09-01' }, // 275,42 $
];

test('sumUsdCents : chaque montant au taux de SON mois, en cents entiers = somme des cellules du tableau', () => {
  assert.equal(sumUsdCents(VALIDATED, DEMO_RATES), 322165);
  const cells = VALIDATED.map((x) => toUsd(x.amountAr, pickRate(DEMO_RATES, x.period)));
  assert.equal(sumUsdCents(VALIDATED, DEMO_RATES), Math.round(cells.reduce((a, b) => a + b, 0) * 100));
  // Jamais le total converti au taux du dernier mois (14 800 000 / 4 720 = 3 135,59 $).
  assert.notEqual(sumUsdCents(VALIDATED, DEMO_RATES), Math.round(toUsd(14800000, 4720) * 100));
  assert.equal(sumUsdCents([], DEMO_RATES), 0);
  assert.equal(sumUsdCents([{ amountAr: 0, period: '2025-01' }], DEMO_RATES), 0, 'un montant nul n\'a pas besoin de taux');
  assert.equal(sumUsdCents([{ amountAr: 1000, period: '2025-06' }], DEMO_RATES), null, 'sans taux applicable : pas de total');
});

test('sumUsdCents : la règle du navigateur (web/src/lib/currency.js) est celle du serveur', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/currency.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const web = await import(pathToFileURL(file).href);
  for (const items of [VALIDATED, VALIDATED.slice(1), [{ amountAr: 1, period: '2026-02' }], [{ amountAr: 5, period: '2025-01' }]]) {
    assert.equal(web.sumUsdCents(items, DEMO_RATES), sumUsdCents(items, DEMO_RATES));
  }
  assert.equal(web.formatUsdCents(322165).replace(/\s/g, ' '), '$ 3 221,65');
  assert.equal(web.formatUsdCents(null), '—');
});
