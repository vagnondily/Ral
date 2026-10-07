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
