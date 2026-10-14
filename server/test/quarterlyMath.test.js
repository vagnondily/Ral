const test = require('node:test');
const assert = require('node:assert/strict');
const { quarterPeriods, rate, band, cell, shapeQuarterly } = require('../src/modules/dashboards/quarterlyMath');

test('périodes : quatre trimestres et l\'année', () => {
  assert.deepEqual(quarterPeriods(2026).map((p) => [p.key, p.from, p.to]), [
    ['Q1', '2026-01', '2026-03'], ['Q2', '2026-04', '2026-06'], ['Q3', '2026-07', '2026-09'],
    ['Q4', '2026-10', '2026-12'], ['year', '2026-01', '2026-12'],
  ]);
  assert.throws(() => quarterPeriods('abc'));
});

test('taux : jamais de division par zéro, bandes rouge → vert', () => {
  assert.equal(rate(5, 0), null);
  assert.equal(rate(0, 4), 0);
  assert.equal(rate(3, 4), 0.75);
  assert.deepEqual([null, 0, 0.39, 0.4, 0.59, 0.6, 0.79, 0.8, 1.2].map(band),
    ['none', 'low', 'low', 'mid', 'mid', 'fair', 'fair', 'high', 'high']);
});

test('cellule : couverture = réalisés ÷ actifs, exécution = réalisés ÷ prévus', () => {
  const c = cell({ active: 208, planned: 180, realised: 170 });
  assert.equal(Math.round(c.coverage * 1000) / 10, 81.7);
  assert.equal(Math.round(c.execution * 1000) / 10, 94.4);
  assert.equal(c.coverageBand, 'high');
  assert.deepEqual(cell({}), { active: 0, planned: 0, realised: 0, coverage: null, execution: null, coverageBand: 'none', executionBand: 'none' });
});

test('mise en forme : activités triées, « Sans activité » en dernier, total = ligne SQL (sites distincts)', () => {
  const byPeriod = {
    Q1: [{ activity: 'SMP', active: 10, planned: 8, realised: 6 }, { activity: '—', active: 2, planned: 0, realised: 0 },
      { activity: 'GD', active: 5, planned: 5, realised: 5 }, { activity: null, active: 17, planned: 13, realised: 11 }],
    year: [{ activity: 'SMP', active: 12, planned: 10, realised: 9 }, { activity: null, active: 19, planned: 15, realised: 14 }],
  };
  const t = shapeQuarterly({ year: 2026, byPeriod, currentMonth: '2026-05' });
  assert.deepEqual(t.rows.map((r) => r.activity), ['GD', 'SMP', '—']);
  assert.equal(t.rows[2].label, null);
  assert.equal(t.total.Q1.active, 17, 'le total vient de la ligne de total, pas d\'une somme');
  assert.equal(t.total.Q2.active, 0);
  assert.equal(t.rows[1].cells.year.realised, 9);
  assert.deepEqual(t.periods.map((p) => p.upcoming), [false, false, true, true, false]);
});
