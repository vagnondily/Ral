/**
 * Routes des activités de programme (migration 105), de bout en bout SANS base : le service est
 * remplacé par un espion. Lecture pour tous, écriture réservée à l'administrateur ; corps
 * contrôlés (zod, clés inconnues refusées) ; le compte vient toujours du jeton.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-activites-de-programme-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const service = require('../src/modules/programmes/programmeActivities.service');
const routes = require('../src/modules/programmes/programmeActivities.routes');
const { errorHandler, conflict } = require('../src/middleware/errors');

const TENANT = '11111111-1111-1111-1111-111111111111';
const A = '22222222-2222-2222-2222-222222222222';
const B = '33333333-3333-3333-3333-333333333333';
const calls = [];
const spy = (name, result) => async (...args) => { calls.push([name, ...args]); return typeof result === 'function' ? result(...args) : result; };
service.listForSelect = spy('list', [{ id: A, label: 'School meal activities', subActivities: [] }]);
service.referential = spy('referential', { activities: [], unresolved: [] });
service.createActivity = spy('create', { id: A, code: 'SMA', label: 'School meal activities' });
service.updateActivity = spy('update', { id: A });
service.deleteActivity = spy('delete', () => { throw conflict('Cette activité est utilisée (12 sites) : suppression impossible.', { reason: 'linked_data', linked: [{ key: 'sites', count: 12, label: 'sites' }] }); });
service.mergeActivities = spy('merge', { merged: true });
service.convertToSubActivity = spy('convert', { converted: true });
service.linkLabel = spy('link', { linked: true });
service.unlinkAlias = spy('unlink', { removed: true });
service.reprise = spy('reprise', { activities: 0 });

const app = express();
app.use(express.json());
app.use('/api/programme-activities', routes);
app.use(errorHandler);
const tok = (role) => jwt.sign({ sub: 'u1', tenantId: TENANT, role }, process.env.JWT_SECRET);
const as = (role) => ({ Authorization: `Bearer ${tok(role)}` });
const last = () => calls[calls.length - 1];

test('lecture pour tous (lecteur compris), compte tiré du jeton', async () => {
  const r1 = await request(app).get('/api/programme-activities').set(as('viewer'));
  assert.equal(r1.status, 200);
  assert.deepEqual(last(), ['list', TENANT]);
  const r2 = await request(app).get('/api/programme-activities/referential').set(as('viewer'));
  assert.equal(r2.status, 200);
  assert.equal((await request(app).get('/api/programme-activities')).status, 401);
});

test('écritures réservées à l\'administrateur (403 pour un valideur ou un lecteur)', async () => {
  const n = calls.length;
  for (const role of ['manager', 'viewer']) {
    assert.equal((await request(app).post('/api/programme-activities').set(as(role)).send({ label: 'Nouvelle' })).status, 403);
    assert.equal((await request(app).patch(`/api/programme-activities/${A}`).set(as(role)).send({ label: 'X1' })).status, 403);
    assert.equal((await request(app).delete(`/api/programme-activities/${A}`).set(as(role))).status, 403);
    assert.equal((await request(app).post(`/api/programme-activities/${A}/merge`).set(as(role)).send({ targetId: B })).status, 403);
    assert.equal((await request(app).post('/api/programme-activities/reprise').set(as(role))).status, 403);
  }
  assert.equal(calls.length, n, 'rien n\'a atteint le service');
});

test('création : libellé nettoyé, code facultatif contrôlé, clé inconnue refusée ; tenant jamais pris du corps', async () => {
  const ok = await request(app).post('/api/programme-activities').set(as('admin'))
    .send({ label: '  School meal activities ', shortLabel: '', code: 'SMA' });
  assert.equal(ok.status, 201);
  assert.deepEqual(last(), ['create', TENANT, { label: 'School meal activities', shortLabel: null, code: 'SMA' }, 'u1']);
  const n = calls.length;
  assert.equal((await request(app).post('/api/programme-activities').set(as('admin')).send({ label: 'X' })).status, 400, 'libellé trop court');
  assert.equal((await request(app).post('/api/programme-activities').set(as('admin')).send({ label: 'Valide', code: '-x' })).status, 400, 'code invalide');
  assert.equal((await request(app).post('/api/programme-activities').set(as('admin')).send({ label: 'Valide', tenantId: B })).status, 400, 'clé inconnue');
  assert.equal(calls.length, n);
});

test('modification partielle ; suppression refusée avec « Utilisé par » (409) ; identifiants contrôlés', async () => {
  const r = await request(app).patch(`/api/programme-activities/${A}`).set(as('admin')).send({ active: false, description: '' });
  assert.equal(r.status, 200);
  assert.deepEqual(last(), ['update', TENANT, A, { active: false, description: null }, 'u1']);
  assert.equal((await request(app).patch(`/api/programme-activities/${A}`).set(as('admin')).send({})).status, 400);
  const del = await request(app).delete(`/api/programme-activities/${A}`).set(as('admin'));
  assert.equal(del.status, 409);
  assert.deepEqual(del.body.details.linked, [{ key: 'sites', count: 12, label: 'sites' }]);
  assert.equal((await request(app).delete('/api/programme-activities/pas-un-uuid').set(as('admin'))).status, 400);
});

test('fusion, rangement comme sous-activité, liaison et retrait d\'un libellé, reprise', async () => {
  assert.equal((await request(app).post(`/api/programme-activities/${A}/merge`).set(as('admin')).send({ targetId: B })).status, 200);
  assert.deepEqual(last(), ['merge', TENANT, A, B]);
  assert.equal((await request(app).post(`/api/programme-activities/${A}/merge`).set(as('admin')).send({ targetId: 'x' })).status, 400);
  assert.equal((await request(app).post(`/api/programme-activities/${A}/convert`).set(as('admin')).send({ targetId: B, code: 'GD' })).status, 200);
  assert.deepEqual(last(), ['convert', TENANT, A, B, { code: 'GD' }]);
  assert.equal((await request(app).post('/api/programme-activities/aliases').set(as('admin')).send({ label: 'Cantine', programmeActivityId: B })).status, 201);
  assert.deepEqual(last(), ['link', TENANT, { label: 'Cantine', programmeActivityId: B }, 'u1']);
  assert.equal((await request(app).delete(`/api/programme-activities/${A}/aliases/cantine`).set(as('admin'))).status, 200);
  assert.deepEqual(last(), ['unlink', TENANT, A, 'cantine']);
  assert.equal((await request(app).delete(`/api/programme-activities/${A}/aliases/Bad-Key`).set(as('admin'))).status, 400);
  assert.equal((await request(app).post('/api/programme-activities/reprise').set(as('admin'))).status, 200);
});
