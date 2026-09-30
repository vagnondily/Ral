const test = require('node:test');
const assert = require('node:assert/strict');
const { computeExpenseAmount } = require('../src/modules/tpm/expenseMath');

test('computeExpenseAmount multiplies daily rate by mission days', () => {
  assert.equal(computeExpenseAmount(85000, 6), 510000);
});

test('computeExpenseAmount returns 0 for zero mission days', () => {
  assert.equal(computeExpenseAmount(90000, 0), 0);
});

test('computeExpenseAmount rounds to the nearest cent', () => {
  // 33.335 * 2 = 66.67 exactly, at the precision that matters for a
  // numeric(14,2) column; guards against floating-point remainders like
  // 66.67000000000001 being sent to Postgres.
  assert.equal(computeExpenseAmount(33.335, 2), 66.67);
});

test('computeExpenseAmount rejects a negative daily rate', () => {
  assert.throws(() => computeExpenseAmount(-1, 5), RangeError);
});

test('computeExpenseAmount rejects a non-integer mission day count', () => {
  assert.throws(() => computeExpenseAmount(1000, 2.5), RangeError);
});

test('computeExpenseAmount rejects a negative mission day count', () => {
  assert.throws(() => computeExpenseAmount(1000, -1), RangeError);
});
