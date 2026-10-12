const test = require('node:test');
const assert = require('node:assert/strict');
const { decisionError } = require('../src/modules/tpm/reportWorkflow');

test('décision sur un rapport : seul un rapport soumis, jamais par son auteur', () => {
  assert.equal(decisionError({ status: 'soumis', createdBy: 'u1' }, 'u2'), null);
  for (const status of ['attendu', 'valide', 'rejete', 'non_applicable']) {
    assert.equal(decisionError({ status, createdBy: 'u1' }, 'u2').code, 'status', status);
  }
  const self = decisionError({ status: 'soumis', createdBy: 'u1' }, 'u1');
  assert.equal(self.code, 'self'); assert.match(self.message, /Séparation des tâches/);
});
