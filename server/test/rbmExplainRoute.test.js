/**
 * Route « pourquoi ce score / ce drapeau » d'un site RBM (retour n° 48), SANS
 * base : le dépôt est remplacé par un espion. Lecture ouverte à tout
 * utilisateur connecté ; le compte vient du jeton ; identifiant invalide → 400,
 * site inconnu → 404 ; le mois demandé est transmis (mois courant par défaut).
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-de-la-route-rbm-explication-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/tpm/field.repository');
const routes = require('../src/modules/tpm/field.routes');
const { errorHandler } = require('../src/middleware/errors');

const SITE = '44444444-4444-4444-4444-444444444444';
const calls = [];
repo.rbmSiteExplain = async (tenantId, id, opts) => {
  calls.push({ tenantId, id, opts });
  return id === SITE ? { id, name: 'Site', reasons: [], consequence: { due: true }, actions: [] } : null;
};

const app = express();
app.use(express.json());
app.use('/api/tpm/field', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const as = (tok) => ({ Authorization: `Bearer ${tok}` });

test('GET /rbm/sites/:id : explication d\'un site, compte du jeton, mois transmis', async () => {
  const res = await request(app).get(`/api/tpm/field/rbm/sites/${SITE}?month=2026-10`).set(as(viewer));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['actions', 'consequence', 'id', 'name', 'reasons']);
  assert.deepEqual(calls.at(-1), { tenantId: TENANT, id: SITE, opts: { month: '2026-10', asOf: '2026-10' } }); // état au mois de référence (lot 1b)
});

test('GET /rbm/sites/:id : sans mois → mois courant ; site inconnu → 404 ; identifiant invalide → 400 sans appel au dépôt', async () => {
  await request(app).get(`/api/tpm/field/rbm/sites/${SITE}`).set(as(viewer));
  assert.equal(calls.at(-1).opts.month, new Date().toISOString().slice(0, 7));
  const missing = await request(app).get('/api/tpm/field/rbm/sites/55555555-5555-5555-5555-555555555555').set(as(viewer));
  assert.equal(missing.status, 404);
  const n = calls.length;
  const bad = await request(app).get('/api/tpm/field/rbm/sites/pas-un-uuid').set(as(viewer));
  assert.equal(bad.status, 400);
  assert.equal(calls.length, n);
});

test('GET /rbm/sites/:id : authentification requise', async () => {
  const res = await request(app).get(`/api/tpm/field/rbm/sites/${SITE}`);
  assert.equal(res.status, 401);
});
