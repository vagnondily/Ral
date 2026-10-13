const test = require('node:test');
const assert = require('node:assert/strict');
const { monthWithin, spanOverlaps, monthSeries } = require('../src/modules/common/periodSql');

test('monthWithin : borne semi-ouverte, 2 paramètres poussés à la suite des autres', () => {
  const params = ['tenant'];
  const sql = monthWithin('s.period_month', { from: '2026-01', to: '2026-06' }, params);
  assert.equal(sql, 's.period_month >= $2::date AND s.period_month < $3::date');
  assert.deepEqual(params, ['tenant', '2026-01-01', '2026-07-01']);
  // Décembre : la borne haute exclue passe à l'année suivante.
  const p2 = [];
  monthWithin('x', { from: '2026-12', to: '2026-12' }, p2);
  assert.deepEqual(p2, ['2026-12-01', '2027-01-01']);
});

test('monthWithin : sans période → TRUE, aucun paramètre poussé', () => {
  const params = ['tenant'];
  assert.equal(monthWithin('s.period_month', null, params), 'TRUE');
  assert.deepEqual(params, ['tenant']);
});

test('spanOverlaps : [début, COALESCE(fin, début)] chevauche la période', () => {
  const params = ['t', 'c'];
  const sql = spanOverlaps('r.period_month', 'r.period_end', { from: '2026-02', to: '2026-06' }, params);
  assert.equal(sql, 'r.period_month < $3::date AND COALESCE(r.period_end, r.period_month) >= $4::date');
  assert.deepEqual(params, ['t', 'c', '2026-07-01', '2026-02-01']);
  assert.equal(spanOverlaps('a', 'b', null, []), 'TRUE');
});

test('monthSeries : premier et dernier mois de la période', () => {
  const params = ['t'];
  assert.equal(monthSeries({ from: '2026-01', to: '2026-06' }, params),
    "generate_series($2::date, $3::date, interval '1 month')");
  assert.deepEqual(params, ['t', '2026-01-01', '2026-06-01']);
});
