const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classify, classDistribution, dimGroups, topFlop,
  progressPct, progressStatus,
} = require('../src/modules/monitoring/coverageDashboard');

// --- classify: 5 bands vs target + direction ---------------------------------
test('classify: no value or no target → na', () => {
  assert.equal(classify({ value: null, target: 80 }), 'na');
  assert.equal(classify({ value: 50, target: null }), 'na');
  assert.equal(classify({ value: 50, target: '' }), 'na');
});

test('classify: higher-is-better bands', () => {
  // target 80, higher better
  assert.equal(classify({ value: 85, target: 80 }), 'exc');            // meets
  assert.equal(classify({ value: 74, target: 80 }), 'sat');            // gap 7.5% ≤ 10
  assert.equal(classify({ value: 60, target: 80 }), 'imp');            // gap 25% ≤ 30
  assert.equal(classify({ value: 40, target: 80 }), 'urg');            // gap 50% > 30
});

test('classify: lower-is-better flips the comparison', () => {
  assert.equal(classify({ value: 5, target: 10, direction: 'lower_better' }), 'exc');
  assert.equal(classify({ value: 20, target: 10, direction: 'lower_better' }), 'urg');
});

// --- classDistribution -------------------------------------------------------
test('classDistribution counts each band and scored excludes na', () => {
  const results = [
    { value: 90, target: 80 },                       // exc
    { value: 74, target: 80 },                       // sat
    { value: 60, target: 80 },                       // imp
    { value: 10, target: 80 },                       // urg
    { value: null, target: 80 },                     // na
    { value: 50, target: null },                     // na
  ];
  const d = classDistribution(results);
  assert.deepEqual(
    { exc: d.exc, sat: d.sat, imp: d.imp, urg: d.urg, na: d.na, scored: d.scored },
    { exc: 1, sat: 1, imp: 1, urg: 1, na: 2, scored: 4 },
  );
});

// --- dimGroups: group percent indicators by module, score = mean, sorted asc --
test('dimGroups groups by module, averages, sorts weakest first', () => {
  const results = [
    { label: 'A', module: 'Accès', agg: 'percent_yes', value: 40 },
    { label: 'B', module: 'Accès', agg: 'percent_yes', value: 60 },
    { label: 'C', module: 'Sécurité', agg: 'percent_yes', value: 99 },
    { label: 'D', module: 'Sécurité', agg: 'percent_value', value: 91 },
    { label: 'E', module: 'Accès', agg: 'mean', value: 7 },     // non-percent → ignored
    { label: 'F', module: 'Accès', agg: 'percent_yes', value: null }, // not computed → ignored
  ];
  const dims = dimGroups(results);
  assert.equal(dims.length, 2);
  // weakest first
  assert.equal(dims[0].name, 'Accès');
  assert.equal(dims[0].score, 50);   // mean(40,60)
  assert.equal(dims[0].n, 2);
  assert.deepEqual(dims[0].inds.map((i) => i.pct), [40, 60]); // sorted asc
  assert.equal(dims[1].name, 'Sécurité');
  assert.equal(dims[1].score, 95);   // mean(99,91)
});

test('dimGroups falls back to a default dimension name', () => {
  const dims = dimGroups([{ label: 'X', agg: 'percent_yes', value: 50 }]);
  assert.equal(dims[0].name, '(sans dimension)');
});

// --- topFlop -----------------------------------------------------------------
test('topFlop returns best (desc) and worst (asc), bounded', () => {
  const results = [
    { label: 'a', agg: 'percent_yes', value: 10 },
    { label: 'b', agg: 'percent_yes', value: 99 },
    { label: 'c', agg: 'percent_yes', value: 50 },
    { label: 'd', agg: 'percent_value', value: 80 },
    { label: 'e', agg: 'mean', value: 5 }, // ignored (non-percent)
  ];
  const { top, flop } = topFlop(results, { nTop: 2, nFlop: 2 });
  assert.deepEqual(top.map((t) => t.label), ['b', 'd']);
  assert.deepEqual(flop.map((f) => f.label), ['a', 'c']);
});

// --- progress (plan vs réalisé) ---------------------------------------------
test('progressPct: realized/planned %, clamped, 0 when no plan', () => {
  assert.equal(progressPct(8, 10), 80);
  assert.equal(progressPct(0, 10), 0);
  assert.equal(progressPct(5, 0), 0);       // no plan
  assert.equal(progressPct(15, 10), 150);   // over-achieved is allowed (not capped)
  assert.equal(progressPct(-3, 10), 0);     // negative realized floored
});

test('progressStatus thresholds', () => {
  assert.equal(progressStatus(90), 'ok');
  assert.equal(progressStatus(80), 'ok');
  assert.equal(progressStatus(60), 'warn');
  assert.equal(progressStatus(50), 'warn');
  assert.equal(progressStatus(20), 'low');
});
