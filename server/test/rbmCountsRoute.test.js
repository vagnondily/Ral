/**
 * Route des compteurs RBM (GET /api/tpm/field/rbm/counts), SANS base : le dépôt est
 * remplacé par un espion. Mêmes paramètres que /rbm/sites (mois ou période, état lu au
 * dernier mois), compte du jeton seulement, niveau de risque validé au bord (400).
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-de-la-route-rbm-compteurs-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/tpm/field.repository');
const routes = require('../src/modules/tpm/field.routes');
const { errorHandler } = require('../src/middleware/errors');

const calls = [];
const COUNTS = { total: 3, due: 2, dueOpen: 1, upToDate: 1, toPlan: 1, byRisk: { elevee: 1, moyenne: 1, faible: 1 } };
repo.rbmCounts = async (tenantId, opts) => { calls.push({ tenantId, opts }); return { month: opts.month || null, ...COUNTS }; };

const app = express();
app.use(express.json());
app.use('/api/tpm/field', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const as = (tok) => ({ Authorization: `Bearer ${tok}` });

test('GET /rbm/counts : compteurs, compte du jeton, état au dernier mois de la période', async () => {
  const res = await request(app).get('/api/tpm/field/rbm/counts?from=2026-07&to=2026-09&tenantId=autre').set(as(viewer));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { month: '2026-09', ...COUNTS });
  assert.deepEqual(calls.at(-1), { tenantId: TENANT, opts: { month: '2026-09', asOf: '2026-09', risk: undefined } });
  await request(app).get('/api/tpm/field/rbm/counts?month=2026-10&risk=elevee').set(as(viewer));
  assert.deepEqual(calls.at(-1).opts, { month: '2026-10', asOf: '2026-10', risk: 'elevee' });
});

test('GET /rbm/counts : risque inconnu ou période mal formée → 400 sans appel au dépôt ; jeton requis', async () => {
  const n = calls.length;
  assert.equal((await request(app).get('/api/tpm/field/rbm/counts?risk=extreme').set(as(viewer))).status, 400);
  assert.equal((await request(app).get('/api/tpm/field/rbm/counts?month=2026-13').set(as(viewer))).status, 400);
  assert.equal(calls.length, n);
  assert.equal((await request(app).get('/api/tpm/field/rbm/counts')).status, 401);
});
