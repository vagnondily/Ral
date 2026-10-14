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

const admin = jwt.sign({ sub: 'u1', tenantId: TENANT, role: 'admin' }, process.env.JWT_SECRET);
const manager = jwt.sign({ sub: 'u3', tenantId: TENANT, role: 'manager' }, process.env.JWT_SECRET);
const HOUSE = { lat: -24.1222355, lng: 45.3429061 };
repo.pointsData = async (tenantId, opts) => {
  calls.push({ fn: 'pointsData', tenantId, opts });
  const collect = opts.precise
    ? { mode: 'points', points: [{ ...HOUSE, month: '2026-07', form: 'F', siteId: null }], total: 1, rejected: 0, lastMonth: '2026-07' }
    : { mode: 'bins', bins: [{ lat: -24.12, lng: 45.34, n: 1 }], total: 1, rejected: 0, lastMonth: '2026-07' };
  return {
    sites: [{ id: 'S1', name: 'S', code: 'S', hasGps: false, cpcode: 'C1', status: 'non_prevu', visitsPlanned: 0, visitsPlannedRealised: 0 }],
    sitesCap: 3000,
    bySite: [{ key: 'S1', n: 3, ...HOUSE, spreadKm: 0.4 }],
    byCommune: [],
    communes: [],
    collect,
  };
};
repo.search = async (tenantId, q) => { calls.push({ fn: 'search', tenantId, q }); return [{ kind: 'district', pcode: 'MG1', name: q }]; };
const decimals = (v) => (String(v).split('.')[1] || '').length;

test('GET /points : lecteur → carroyage de 2 km (même avec limit), jamais plus de 2 décimales ; admin / gestionnaire → précis', async () => {
  const v = await request(app).get('/api/map/points?month=2026-07&limit=5000').set(as(viewer));
  assert.equal(v.status, 200);
  assert.equal(last().opts.precise, false);
  assert.equal(v.body.collect.mode, 'bins');
  for (const p of [...v.body.sites, ...v.body.collect.bins]) {
    assert.ok(decimals(p.lat) <= 2 && decimals(p.lng) <= 2, `${p.lat}, ${p.lng}`);
  }
  for (const tok of [admin, manager]) {
    const r = await request(app).get('/api/map/points?month=2026-07').set(as(tok));
    assert.equal(r.status, 200);
    assert.equal(last().opts.precise, true);
    assert.equal(r.body.collect.mode, 'points');
    assert.deepEqual(last().opts.layers, ['gps', 'derived', 'communes', 'collect']);
    assert.equal(last().opts.limit, 2000);
  }
});

test('GET /points : couches et limite validées (400) ; GET /search : 2 à 80 caractères', async () => {
  const n = calls.length;
  assert.equal((await request(app).get('/api/map/points?month=2026-07&limit=5001').set(as(admin))).status, 400);
  assert.equal((await request(app).get('/api/map/points?month=2026-07&limit=0').set(as(admin))).status, 400);
  assert.equal((await request(app).get('/api/map/points?month=2026-07&layers=gps,inconnue').set(as(admin))).status, 400);
  assert.equal((await request(app).get('/api/map/points').set(as(admin))).status, 400); // période requise
  assert.equal((await request(app).get('/api/map/search?q=a').set(as(viewer))).status, 400);
  assert.equal((await request(app).get(`/api/map/search?q=${'a'.repeat(81)}`).set(as(viewer))).status, 400);
  assert.equal(calls.length, n);
  const ok = await request(app).get('/api/map/points?month=2026-07&layers=gps,collect&limit=10').set(as(admin));
  assert.equal(ok.status, 200);
  assert.deepEqual(last().opts.layers, ['gps', 'collect']);
  assert.equal(last().opts.limit, 10);
  const s = await request(app).get('/api/map/search?q=%20Bek%20').set(as(viewer));
  assert.equal(s.status, 200);
  assert.deepEqual(last(), { fn: 'search', tenantId: TENANT, q: 'Bek' });
  assert.equal(s.body.results.length, 1);
});

test('soumissions d\'une fiche : un lecteur ne reçoit aucune coordonnée GPS des ménages', async () => {
  const monRepo = require('../src/modules/monitoring/monitoring.repository');
  monRepo.formSubmissions = async () => ({
    rows: [{ id: 'x', data: { '@_HHCoord_latitude': '-24.1222355', '@_HHCoord_longitude': '45.3429061', HHCoord: '-24.1222355 45.3429061 12 4.5', _geolocation: [-24.12, 45.34], q1: 'Oui' } }],
    total: 1,
  });
  const monApp = express();
  monApp.use(express.json());
  monApp.use('/api/monitoring', require('../src/modules/monitoring/monitoring.routes'));
  monApp.use(errorHandler);
  const FORM = '33333333-3333-3333-3333-333333333333';
  const v = await request(monApp).get(`/api/monitoring/forms/${FORM}/submissions`).set(as(viewer));
  assert.equal(v.status, 200);
  assert.deepEqual(v.body.rows[0].data, { q1: 'Oui' });
  assert.doesNotMatch(JSON.stringify(v.body), /\d+\.\d{3,}/, 'aucune coordonnée à plus de 2 décimales');
  const a = await request(monApp).get(`/api/monitoring/forms/${FORM}/submissions`).set(as(manager));
  assert.equal(a.body.rows[0].data['@_HHCoord_latitude'], '-24.1222355');
});
