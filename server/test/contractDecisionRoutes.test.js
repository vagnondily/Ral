/**
 * Gardes de rôle des routes de décision des contrats (approuver / rejeter, et idem
 * pour les avenants) SANS base : le service est remplacé par un espion.
 *
 * Statuer est réservé à valideur+ (requireRole(...VALIDATE_ROLES)). C'est la
 * défense en profondeur : le service impose déjà que seul le valideur ASSIGNÉ
 * statue (contract.validatorId === actor.userId). Un lecteur ou un éditeur ne doit
 * donc jamais atteindre le service — 403 avant tout traitement.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-decision-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const service = require('../src/modules/contracts/contracts.service');

const calls = [];
service.decide = async (...args) => { calls.push({ name: 'decide', args }); return { ok: true }; };
service.decideAmendment = async (...args) => { calls.push({ name: 'decideAmendment', args }); return { ok: true }; };

const routes = require('../src/modules/contracts/contracts.routes');
const { errorHandler } = require('../src/middleware/errors');

const app = express();
app.use(express.json());
app.use('/api/contracts', routes);
app.use(errorHandler);

const TENANT = '11111111-1111-1111-1111-111111111111';
const CID = '22222222-2222-2222-2222-222222222222';
const AID = '33333333-3333-3333-3333-333333333333';
const sign = (role) => jwt.sign({ sub: `u-${role}`, tenantId: TENANT, role }, process.env.JWT_SECRET);
const as = (role) => ({ Authorization: `Bearer ${sign(role)}` });

const DECISION_ROUTES = [
  `/api/contracts/${CID}/approve`,
  `/api/contracts/${CID}/reject`,
  `/api/contracts/${CID}/amendments/${AID}/approve`,
  `/api/contracts/${CID}/amendments/${AID}/reject`,
];

test('lecteur et éditeur : 403 sur toute route de décision, le service n\'est jamais appelé', async () => {
  for (const role of ['viewer', 'editor']) {
    for (const url of DECISION_ROUTES) {
      calls.length = 0;
      const res = await request(app).post(url).set(as(role)).send({});
      assert.equal(res.status, 403, `${role} ${url}`);
      assert.equal(calls.length, 0, `service appelé pour ${role} ${url}`);
    }
  }
});

test('sans jeton : 401', async () => {
  for (const url of DECISION_ROUTES) {
    const res = await request(app).post(url).send({});
    assert.equal(res.status, 401, url);
  }
});

test('valideur, administrateur, super-utilisateur : atteignent le service (204)', async () => {
  for (const role of ['validator', 'admin', 'superuser']) {
    for (const url of DECISION_ROUTES) {
      calls.length = 0;
      const res = await request(app).post(url).set(as(role)).send({});
      assert.equal(res.status, 204, `${role} ${url} -> ${res.status}`);
      assert.equal(calls.length, 1, `service non appelé pour ${role} ${url}`);
    }
  }
});

test('rôle hérité « manager » (ancien valideur) : autorisé', async () => {
  calls.length = 0;
  const res = await request(app).post(DECISION_ROUTES[0]).set(as('manager')).send({});
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
});
