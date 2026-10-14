const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, pipeline } = require('../src/modules/pdd/pddMath');

const sample = [
  { periodMonth: '2025-10-01', hazard: 'drought', region: 'Anosy', district: 'Amboasary', commune: 'Ebelo', beneficiaries: 13318, households: 2664, cashUsd: 0, totalFood: 115.958, items: { Sorgho: 95.892, Huile: 6.992 } },
  { periodMonth: '2025-10-01', hazard: 'drought', region: 'Anosy', district: 'Amboasary', commune: 'Ifotaka', beneficiaries: 12167, households: 2433, cashUsd: 65888, totalFood: 0, items: {} },
  { periodMonth: '2025-11-01', hazard: 'cyclone', region: 'Androy', district: 'Ambovombe', commune: 'Ambanisarika', beneficiaries: 7937, households: 1587, cashUsd: 0, totalFood: 11.31, items: { Sorgho: 4.0, Huile: 4.167 } },
];

test('summarize totals', () => {
  const { total } = summarize(sample);
  assert.equal(total.lines, 3);
  assert.equal(total.beneficiaries, 13318 + 12167 + 7937);
  assert.equal(total.households, 2664 + 2433 + 1587);
  assert.equal(total.cashUsd, 65888);
  assert.equal(total.byCommodity.Sorgho, 99.892);
  assert.equal(total.byCommodity.Huile, 11.159);
});

test('summarize by hazard and month', () => {
  const { byHazard, byMonth } = summarize(sample);
  assert.equal(byHazard.drought.beneficiaries, 13318 + 12167);
  assert.equal(byHazard.cyclone.beneficiaries, 7937);
  assert.equal(byMonth['2025-10'].lines, 2);
  assert.equal(byMonth['2025-11'].lines, 1);
});

test('summarize zone tree sorted by beneficiaries', () => {
  const { byZone } = summarize(sample);
  assert.equal(byZone[0].name, 'Anosy');
  assert.equal(byZone[0].beneficiaries, 13318 + 12167);
  const amboasary = byZone[0].districts.find((d) => d.name === 'Amboasary');
  assert.equal(amboasary.communes.length, 2);
  // Ebelo (13318) before Ifotaka (12167)
  assert.equal(amboasary.communes[0].name, 'Ebelo');
});

test('pipeline need vs stock', () => {
  const rows = pipeline({ Sorgho: 100, Huile: 11.159 }, { Sorgho: 60, Huile: 20 });
  const sorgho = rows.find((r) => r.commodity === 'Sorgho');
  assert.equal(sorgho.need, 100);
  assert.equal(sorgho.available, 60);
  assert.equal(sorgho.gap, -40);
  assert.ok(sorgho.shortfall);
  assert.ok(Math.abs(sorgho.coverage - 0.6) < 1e-9);
  const huile = rows.find((r) => r.commodity === 'Huile');
  assert.equal(huile.shortfall, false);
  assert.equal(huile.gap, round(20 - 11.159));
});

function round(n) { return Math.round(n * 1000) / 1000; }

test('pipeline handles zero need (stock only)', () => {
  const rows = pipeline({}, { Riz: 50 });
  assert.equal(rows[0].coverage, 1);
  assert.equal(rows[0].gap, 50);
});

test('empty is safe', () => {
  const { total, byZone } = summarize([]);
  assert.equal(total.lines, 0);
  assert.equal(byZone.length, 0);
  assert.deepEqual(pipeline({}, {}), []);
});

const { latestStock } = require('../src/modules/pdd/pddMath');

test('pipeline sur plusieurs mois : stock du DERNIER mois renseigné par denrée', () => {
  const rows = [
    { commodity: 'Riz', qty: 80, donor: 'A', month: '2025-11' },
    { commodity: 'Riz', qty: 120, donor: 'B', month: '2025-12' },
    { commodity: 'Riz', qty: 50, donor: 'C', month: '2025-10' },
    { commodity: 'Huile', qty: 4, month: '2025-10' },
  ];
  const s = latestStock(rows);
  assert.deepEqual(s.Riz, { qty: 120, donor: 'B', month: '2025-12' });
  assert.deepEqual(s.Huile, { qty: 4, donor: null, month: '2025-10' });
  assert.deepEqual(latestStock([]), {});
});

// ---- Période (lot 1b) ----------------------------------------------------------
const { peakMonth, pipelineOverMonths } = require('../src/modules/pdd/pddMath');

test('latestStock sur les stocks ≤ to : un stock saisi après la période est ignoré par le dépôt', () => {
  const rows = [
    { commodity: 'Riz', qty: 80, month: '2025-11' },
    { commodity: 'Riz', qty: 120, month: '2026-02' },
  ];
  const upTo = (to) => latestStock(rows.filter((r) => r.month <= to));
  assert.equal(upTo('2026-01').Riz.qty, 80);
  assert.equal(upTo('2026-03').Riz.qty, 120);
});

test('summarize : groupes agrégés en SQL (avec `lines`) ≡ lignes brutes', () => {
  const grouped = [
    { periodMonth: '2025-10', hazard: 'drought', region: 'Anosy', district: 'Amboasary', commune: 'Ebelo', lines: 1, beneficiaries: 13318, households: 2664, cashUsd: 0, totalFood: 115.958, items: { Sorgho: 95.892, Huile: 6.992 } },
    { periodMonth: '2025-10', hazard: 'drought', region: 'Anosy', district: 'Amboasary', commune: 'Ifotaka', lines: 1, beneficiaries: 12167, households: 2433, cashUsd: 65888, totalFood: 0, items: {} },
    { periodMonth: '2025-11', hazard: 'cyclone', region: 'Androy', district: 'Ambovombe', commune: 'Ambanisarika', lines: 1, beneficiaries: 7937, households: 1587, cashUsd: 0, totalFood: 11.31, items: { Sorgho: 4.0, Huile: 4.167 } },
  ];
  assert.deepEqual(summarize(grouped), summarize(sample));
  // Deux lignes du même groupe agrégées en une seule ligne avec lines = 2.
  const doubled = summarize([{ ...grouped[0], lines: 2, beneficiaries: 2 * 13318 }]);
  assert.equal(doubled.total.lines, 2);
  assert.equal(doubled.total.beneficiaries, 2 * 13318);
});

test('peakMonth : mois où le plus de bénéficiaires ont été servis (cumul ≠ personnes)', () => {
  const { byMonth } = summarize(sample);
  assert.deepEqual(peakMonth(byMonth), { month: '2025-10', beneficiaries: 13318 + 12167, households: 2664 + 2433 });
  assert.equal(peakMonth({}), null);
  assert.equal(peakMonth({ '2026-02': { beneficiaries: 5, households: 1 }, '2026-01': { beneficiaries: 5, households: 2 } }).month, '2026-01', 'égalité : le plus ancien');
});

test('pipelineOverMonths : besoin de chaque mois face au stock en vigueur ce mois-là, jamais additionné', () => {
  const need = [
    { commodity: 'Riz', month: '2026-01', qty: 50 },
    { commodity: 'Riz', month: '2026-02', qty: 50 },
    { commodity: 'Riz', month: '2026-03', qty: 50 },
    { commodity: 'Huile', month: '2026-02', qty: 2 },
  ];
  const stock = [
    { commodity: 'Riz', month: '2025-12', qty: 60, donor: 'A' },
    { commodity: 'Riz', month: '2026-03', qty: 30, donor: 'B' },
    { commodity: 'Riz', month: '2026-05', qty: 999 }, // après la période : ignoré
    { commodity: 'Huile', month: '2026-01', qty: 5 },
  ];
  const rows = pipelineOverMonths(need, stock, ['2026-01', '2026-02', '2026-03']);
  const riz = rows.find((r) => r.commodity === 'Riz');
  assert.equal(riz.need, 150, 'besoin = somme des mois');
  assert.equal(riz.available, 30, 'stock au dernier mois, pas une somme');
  assert.equal(riz.stockMonth, '2026-03');
  assert.equal(riz.donor, 'B');
  assert.deepEqual(riz.months.map((m) => [m.month, m.available, m.stockMonth, m.shortfall]), [
    ['2026-01', 60, '2025-12', false], ['2026-02', 60, '2025-12', false], ['2026-03', 30, '2026-03', true],
  ]);
  assert.equal(riz.shortfallMonths, 1);
  assert.equal(riz.uncovered, 20);
  assert.equal(riz.gap, -20);
  assert.ok(Math.abs(riz.coverage - 130 / 150) < 1e-9);
  const huile = rows.find((r) => r.commodity === 'Huile');
  assert.equal(huile.shortfall, false);
  assert.equal(huile.months[0].need, 0);
  // Sur un seul mois : la règle de toujours (écart = stock − besoin, couverture = stock ÷ besoin).
  const [one] = pipelineOverMonths(need.filter((r) => r.commodity === 'Riz'), stock, ['2026-01']);
  const legacy = pipeline({ Riz: 50 }, { Riz: 60 })[0];
  assert.equal(one.gap, legacy.gap);
  assert.equal(one.coverage, legacy.coverage);
  assert.deepEqual(pipelineOverMonths(need, stock, []), []);
});
