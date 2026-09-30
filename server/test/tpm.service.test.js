const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMonth, PLAN_TRANSITIONS } = require('../src/modules/tpm/tpm.service');

test('normalizeMonth keeps a "YYYY-MM" month as the 1st of that month', () => {
  assert.equal(normalizeMonth('2026-11'), '2026-11-01');
});

test('normalizeMonth truncates a full date down to the 1st of its month', () => {
  assert.equal(normalizeMonth('2026-11-17'), '2026-11-01');
});

test('plan workflow only moves forward: draft -> submitted -> validated', () => {
  assert.equal(PLAN_TRANSITIONS.draft, 'submitted');
  assert.equal(PLAN_TRANSITIONS.submitted, 'validated');
  assert.equal(PLAN_TRANSITIONS.validated, undefined); // terminal state, nothing past it
});
