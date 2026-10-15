/**
 * Sous-activités (retour n° 92) — routes de bout en bout, SANS base : le dépôt
 * est remplacé par des stubs en mémoire. Vérifie le mapping retour → HTTP
 * (NOACT→404, DUP→409, linked→409, code_locked→409, not_found→404), les rôles
 * (lecture pour tous, écriture admin → 403 sinon), la validation d'entrée (400)
 * et que le compte vient toujours du jeton.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-sous-activites-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/settings/subActivities.repository');
const routes = require('../src/modules/settings/subActivities.routes');
const { errorHandler } = require('../src/middleware/errors');

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACT = '22222222-2222-2222-2222-222222222222';
const SUB = '33333333-3333-3333-3333-333333333333';

// ---- Stubs du dépôt (chaque test règle le comportement attendu) --------------
let calls;
let behaviour;
const reset = () => {
  calls = [];
  behaviour = {
    list: [{ id: SUB, activityId: ACT, code: 'GD', label: 'Distribution générale', info: null, sortOrder: 0, active: true }],
    create: { id: SUB },
    update: 'ok',
    del: 'ok',
  };
};
reset();

repo.listSubActivities = async (tenantId, opts) => {
  assert.equal(tenantId, TENANT, 'le compte vient du jeton');
  calls.push(['list', opts]);
  return behaviour.list;
};
repo.createSubActivity = async (tenantId, input) => {
  assert.equal(tenantId, TENANT);
  calls.push(['create', input]);
  if (behaviour.create instanceof Error) throw behaviour.create;
  return behaviour.create;
};
repo.updateSubActivity = async (tenantId, id, patch) => {
  assert.equal(tenantId, TENANT);
  calls.push(['update', id, patch]);
  return behaviour.update;
};
repo.deleteSubActivity = async (tenantId, id) => {
  assert.equal(tenantId, TENANT);
  calls.push(['delete', id]);
  return behaviour.del;
};

const app = express();
app.use(express.json());
app.use('/api/sub-activities', routes);
app.use(errorHandler);

const tokenOf = (role) => jwt.sign({ sub: 'user-1', tenantId: TENANT, role }, process.env.JWT_SECRET);
const as = (role = 'admin') => {
  const token = tokenOf(role);
  const withAuth = (r) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (p) => withAuth(request(app).get(p)),
    post: (p, b) => withAuth(request(app).post(p)).send(b),
    patch: (p, b) => withAuth(request(app).patch(p)).send(b),
    del: (p) => withAuth(request(app).delete(p)),
  };
};

const dupError = () => { const e = new Error('dup'); e.code = 'DUP'; return e; };
const noActError = () => { const e = new Error('act'); e.code = 'NOACT'; return e; };

test('GET / — lecture autorisée à tous, transmet les filtres', async () => {
  reset();
  const res = await as('viewer').get(`/api/sub-activities?activityId=${ACT}&active=true`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.deepEqual(calls[0], ['list', { activityId: ACT, activeOnly: true }]);
});

test('GET / — activityId non-UUID → 400', async () => {
  reset();
  const res = await as('viewer').get('/api/sub-activities?activityId=pas-un-uuid');
  assert.equal(res.status, 400);
});

test('POST / — sans jeton → 401', async () => {
  reset();
  const res = await request(app).post('/api/sub-activities').send({ activityId: ACT, code: 'GD', label: 'Test' });
  assert.equal(res.status, 401);
});

test('POST / — rôle non-admin → 403', async () => {
  reset();
  const res = await as('manager').post('/api/sub-activities', { activityId: ACT, code: 'GD', label: 'Distribution' });
  assert.equal(res.status, 403);
});

test('POST / — création valide → 201', async () => {
  reset();
  const res = await as('admin').post('/api/sub-activities', { activityId: ACT, code: 'GD', label: 'Distribution générale', info: 'note' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: SUB });
  assert.deepEqual(calls[0], ['create', { activityId: ACT, code: 'GD', label: 'Distribution générale', info: 'note' }]);
});

test('POST / — entrée invalide (label trop court, activityId manquant) → 400', async () => {
  reset();
  const res = await as('admin').post('/api/sub-activities', { code: 'GD', label: 'X' });
  assert.equal(res.status, 400);
});

test('POST / — activité parente absente (NOACT) → 404', async () => {
  reset();
  behaviour.create = noActError();
  const res = await as('admin').post('/api/sub-activities', { activityId: ACT, code: 'GD', label: 'Distribution' });
  assert.equal(res.status, 404);
});

test('POST / — code déjà pris (DUP) → 409', async () => {
  reset();
  behaviour.create = dupError();
  const res = await as('admin').post('/api/sub-activities', { activityId: ACT, code: 'GD', label: 'Distribution' });
  assert.equal(res.status, 409);
});

test('PATCH /:id — mise à jour valide → 204', async () => {
  reset();
  const res = await as('admin').patch(`/api/sub-activities/${SUB}`, { label: 'Nouveau libellé', info: '' });
  assert.equal(res.status, 204);
  assert.deepEqual(calls[0], ['update', SUB, { label: 'Nouveau libellé', info: '' }]);
});

test('PATCH /:id — patch vide → 400', async () => {
  reset();
  const res = await as('admin').patch(`/api/sub-activities/${SUB}`, {});
  assert.equal(res.status, 400);
});

test('PATCH /:id — id non-UUID → 400', async () => {
  reset();
  const res = await as('admin').patch('/api/sub-activities/xxx', { label: 'Test' });
  assert.equal(res.status, 400);
});

test('PATCH /:id — introuvable → 404', async () => {
  reset();
  behaviour.update = 'not_found';
  const res = await as('admin').patch(`/api/sub-activities/${SUB}`, { label: 'Test' });
  assert.equal(res.status, 404);
});

test('PATCH /:id — code figé par des sites (code_locked) → 409', async () => {
  reset();
  behaviour.update = 'code_locked';
  const res = await as('admin').patch(`/api/sub-activities/${SUB}`, { code: 'ZZ' });
  assert.equal(res.status, 409);
});

test('PATCH /:id — nouveau code déjà pris (DUP) → 409', async () => {
  reset();
  behaviour.update = 'DUP';
  const res = await as('admin').patch(`/api/sub-activities/${SUB}`, { code: 'ZZ' });
  assert.equal(res.status, 409);
});

test('DELETE /:id — suppression → 204', async () => {
  reset();
  const res = await as('admin').del(`/api/sub-activities/${SUB}`);
  assert.equal(res.status, 204);
});

test('DELETE /:id — rôle non-admin → 403', async () => {
  reset();
  const res = await as('manager').del(`/api/sub-activities/${SUB}`);
  assert.equal(res.status, 403);
});

test('DELETE /:id — utilisée par des sites (linked) → 409', async () => {
  reset();
  behaviour.del = 'linked';
  const res = await as('admin').del(`/api/sub-activities/${SUB}`);
  assert.equal(res.status, 409);
});

test('DELETE /:id — introuvable → 404', async () => {
  reset();
  behaviour.del = 'not_found';
  const res = await as('admin').del(`/api/sub-activities/${SUB}`);
  assert.equal(res.status, 404);
});
