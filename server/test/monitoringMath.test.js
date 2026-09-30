const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIndicator, computeAll, rate } = require('../src/modules/monitoring/monitoringMath');

const subs = (field, values) => values.map((v) => ({ data: { [field]: v } }));

test('percent_yes: share of positive answers among those answered', () => {
  const r = computeIndicator({ sourceField: 'cfm', agg: 'percent_yes' }, subs('cfm', ['yes', 'no', 'oui', '', 'non']));
  assert.equal(r.base, 4);          // the empty one is excluded
  assert.equal(r.value, 50);        // 2 of 4
});

test('percent_value: positive when equal to positiveValue', () => {
  const r = computeIndicator({ sourceField: 'q', agg: 'percent_value', positiveValue: 'A' }, subs('q', ['A', 'B', 'A', 'C']));
  assert.equal(r.value, 50);
});

test('mean averages the numeric answers', () => {
  const r = computeIndicator({ sourceField: 'score', agg: 'mean' }, subs('score', ['10', '20', 'x', '30']));
  assert.equal(r.base, 3);
  assert.equal(r.value, 20);
});

test('count and sum', () => {
  assert.equal(computeIndicator({ sourceField: 'x', agg: 'count' }, subs('x', ['a', '', 'b'])).value, 2);
  assert.equal(computeIndicator({ sourceField: 'x', agg: 'sum' }, subs('x', ['5', '7', ''])).value, 12);
});

test('value is null (na) when nothing was answered', () => {
  const r = computeIndicator({ sourceField: 'x', agg: 'percent_yes' }, subs('x', ['', '']));
  assert.equal(r.value, null);
  assert.equal(r.rating, 'na');
});

test('rating against a higher-better target', () => {
  assert.equal(rate(90, { target: 80, direction: 'higher_better' }), 'exc');
  assert.equal(rate(75, { target: 80, direction: 'higher_better' }), 'sat'); // within 10 %
  assert.equal(rate(50, { target: 80, direction: 'higher_better' }), 'imp');
  assert.equal(rate(null, { target: 80 }), 'na');
});

test('rating against a lower-better target (e.g. % de fraude)', () => {
  assert.equal(rate(2, { target: 5, direction: 'lower_better' }), 'exc');
  assert.equal(rate(30, { target: 5, direction: 'lower_better' }), 'imp');
});

test('computeAll returns one result per indicator', () => {
  const inds = [
    { id: 'i1', code: 'cfm', label: 'CFM utilisé', sourceField: 'cfm', agg: 'percent_yes', target: 80, direction: 'higher_better' },
    { id: 'i2', code: 'sc', label: 'Score', sourceField: 'score', agg: 'mean' },
  ];
  const rows = [{ data: { cfm: 'yes', score: 10 } }, { data: { cfm: 'no', score: 20 } }];
  const out = computeAll(inds, rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].value, 50);
  assert.equal(out[1].value, 15);
});
