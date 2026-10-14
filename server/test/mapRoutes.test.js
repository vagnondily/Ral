/**
 * Routes de la carte (lot 6a), de bout en bout SANS base : le dépôt est remplacé
 * par un espion (modèle monitoringIndicatorRoute). Entrées bornées au bord : période
 * requise, 36 mois au plus, mois valides, bureau uuid ; le compte vient du jeton.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-carte-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/map/map.repository');

const calls = [];
const RAW = {
  facts: [{ dim: 'total', sites: 3, active: 3, realised: 1, knownAll: false }],
  subs: [{ dim: 'total', submissions: 2, submissionsSite: 1 }],
  areas: { districts: [], regions: [] }, communes: [], links: [], filters: { offices: [], activities: [] },
};
repo.districtData = async (tenantId, opts) => { calls.push({ fn: 'districtData', tenantId, opts }); return RAW; };

const routes = require('../src/modules/map/map.routes');
const { errorHandler } = require('../src/middleware/errors');

const app = express();
app.use(express.json());
app.use('/api/map', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const OFFICE = '22222222-2222-2222-2222-222222222222';
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const as = (tok) => ({ Authorization: `Bearer ${tok}` });
const last = () => calls[calls.length - 1];

test('GET /districts : 200 avec la forme documentée ; tenant tiré du jeton ; filtres transmis', async () => {
  const res = await request(app).get(`/api/map/districts?from=2026-01&to=2026-10&office=${OFFICE}&activity=%20School%20meal%20activities%20&tenant_id=autre`).set(as(viewer));
  assert.equal(res.status, 200);
  assert.deepEqual(last(), { fn: 'districtData', tenantId: TENANT, opts: { period: { from: '2026-01', to: '2026-10' }, officeId: OFFICE, activity: 'School meal activities' } });
  for (const k of ['period', 'filters', 'geometry', 'themes', 'shapes', 'shapeRegions', 'regionOnly', 'unplaced', 'submissionsUnlocated', 'totals', 'filtersAvailable', 'computedAt']) {
    assert.ok(k in res.body, k);
  }
  assert.deepEqual(res.body.period, { from: '2026-01', to: '2026-10', months: 10 });
  assert.equal(res.body.totals.counts.realised, 1);
  assert.equal(res.body.geometry.asset, 'geo/mdg-adm2.v1.json');
});

test('GET /districts : ?month= raccourci d\'un mois ; « Tous » (vide) = sans filtre', async () => {
  const res = await request(app).get('/api/map/districts?month=2026-09&office=&activity=').set(as(viewer));
  assert.equal(res.status, 200);
  assert.deepEqual(last().opts, { period: { from: '2026-09', to: '2026-09' }, officeId: null, activity: null });
});

test('GET /districts : 400 sur mois invalide, from > to, plage > 36 mois, période absente, bureau non uuid', async () => {
  const n = calls.length;
  const bad = [
    ['/api/map/districts?month=2026-13', 'period_format'],
    ['/api/map/districts?from=2026-10&to=2026-01', 'period_order'],
    ['/api/map/districts?from=2023-01&to=2026-01', 'period_span'],
    ['/api/map/districts', 'period_required'],
    ['/api/map/districts?from=2026-01', 'period_partial'],
  ];
  for (const [url, code] of bad) {
    const res = await request(app).get(url).set(as(viewer));
    assert.equal(res.status, 400, url);
    assert.equal(res.body.details?.code, code, url);
  }
  assert.equal((await request(app).get('/api/map/districts?month=2026-09&office=pas-un-uuid').set(as(viewer))).status, 400);
  assert.equal((await request(app).get(`/api/map/districts?month=2026-09&activity=${'x'.repeat(201)}`).set(as(viewer))).status, 400);
  assert.equal(calls.length, n, 'rien n\'a atteint le dépôt');
});

test('GET /districts : jeton requis', async () => {
  assert.equal((await request(app).get('/api/map/districts?month=2026-09')).status, 401);
});
