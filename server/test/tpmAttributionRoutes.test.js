/**
 * Routes de l'affectation des TPM (retour 58) SANS base : le service est remplacé par un espion.
 * Entrées bornées au bord (zod + règle de période commune) : 24 mois au plus, au moins une zone,
 * 500 visites ; « '' » = null ; écriture réservée à admin / manager ; compte et auteur du jeton.
 * Visites (field.routes) : `contractId` d'un ancien client ignoré, raison du TPM nettoyée.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-attribution-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const service = require('../src/modules/tpm/tpmAttribution.service');
const fieldRepo = require('../src/modules/tpm/field.repository');

const calls = [];
const spy = (name) => { service[name] = async (...args) => { calls.push({ name, args }); return { ok: true }; }; };
['getTable', 'providers', 'resolve', 'listLog', 'preview', 'setOverrides', 'revert', 'reapply', 'setVisitsProvider'].forEach(spy);
fieldRepo.createVisit = async (...args) => { calls.push({ name: 'createVisit', args }); return 'v-new'; };
fieldRepo.updateVisit = async (...args) => { calls.push({ name: 'updateVisit', args }); return true; };

const routes = require('../src/modules/tpm/tpmAttribution.routes');
const fieldRoutes = require('../src/modules/tpm/field.routes');
const { errorHandler } = require('../src/middleware/errors');

const app = express();
app.use(express.json());
app.use('/api/tpm/attribution', routes);
app.use('/api/tpm/field', fieldRoutes);
app.use(errorHandler);

const TENANT = '11111111-1111-1111-1111-111111111111';
const AREA = '22222222-2222-2222-2222-222222222222';
const SITE = '33333333-3333-3333-3333-333333333333';
const PROV = '44444444-4444-4444-4444-444444444444';
const manager = jwt.sign({ sub: 'u1', tenantId: TENANT, role: 'manager' }, process.env.JWT_SECRET);
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const as = (tok) => ({ Authorization: `Bearer ${tok}` });
const last = () => calls[calls.length - 1];

test('GET / : période par défaut (mois courant + 5), compte du jeton ; 24 mois au plus', async () => {
  const res = await request(app).get('/api/tpm/attribution?tenant_id=autre').set(as(viewer));
  assert.equal(res.status, 200);
  const [tenantId, opts] = last().args;
  assert.equal(tenantId, TENANT);
  assert.equal(opts.all, false);
  assert.match(opts.period.from, /^\d{4}-\d{2}$/);
  const r2 = await request(app).get('/api/tpm/attribution?from=2025-01&to=2027-01').set(as(viewer));
  assert.equal(r2.status, 400);
  assert.equal(r2.body.details.code, 'period_span');
  const r3 = await request(app).get('/api/tpm/attribution?from=2026-10&to=2026-08').set(as(viewer));
  assert.equal(r3.body.details.code, 'period_order');
});

test('PUT /overrides : au moins une zone ; chaîne vide = aucun TPM ; écriture admin / manager ; auteur du jeton', async () => {
  const body = { areaIds: [AREA], from: '2026-10', to: '2026-12', providerId: '', reason: 'Contrat AINA échu', stamp: 'abc' };
  const res = await request(app).put('/api/tpm/attribution/overrides').set(as(manager)).send(body);
  assert.equal(res.status, 200);
  const [tenantId, actor, valid] = last().args;
  assert.equal(tenantId, TENANT);
  assert.deepEqual(actor, { userId: 'u1', role: 'manager' });
  assert.deepEqual(valid, { target: { areaIds: [AREA], regionIds: [], from: '2026-10', to: '2026-12' }, providerId: null, reason: 'Contrat AINA échu', stamp: 'abc' });
  assert.equal((await request(app).put('/api/tpm/attribution/overrides').set(as(viewer)).send(body)).status, 403);
  const none = await request(app).put('/api/tpm/attribution/overrides').set(as(manager)).send({ ...body, areaIds: [] });
  assert.equal(none.status, 400);
  const noStamp = await request(app).put('/api/tpm/attribution/overrides').set(as(manager)).send({ ...body, stamp: undefined });
  assert.equal(noStamp.status, 400);
  const tooLong = await request(app).put('/api/tpm/attribution/overrides').set(as(manager)).send({ ...body, from: '2025-01', to: '2027-01' });
  assert.equal(tooLong.body.details.code, 'period_span');
});

test('POST /preview et /revert ; POST /visits borné à 500 ; GET /resolve exige un site et un mois', async () => {
  const p = await request(app).post('/api/tpm/attribution/preview').set(as(viewer)).send({ regionIds: [AREA], from: '2026-10', to: '2026-10', providerId: PROV });
  assert.equal(p.status, 200);
  assert.equal(last().args[1].mode, 'modifier');
  assert.equal((await request(app).post('/api/tpm/attribution/revert').set(as(manager)).send({ areaIds: [AREA], from: '2026-10', to: '2026-10', stamp: 's' })).status, 200);
  const many = Array.from({ length: 501 }, () => SITE);
  assert.equal((await request(app).post('/api/tpm/attribution/visits').set(as(manager)).send({ visitIds: many, action: 'zone' })).status, 400);
  assert.equal((await request(app).post('/api/tpm/attribution/visits').set(as(manager)).send({ visitIds: [SITE], action: 'nimporte' })).status, 400);
  const ok = await request(app).post('/api/tpm/attribution/visits').set(as(manager)).send({ visitIds: [SITE], action: 'set', providerId: PROV, reason: 'Visite confiée au TPM' });
  assert.equal(ok.status, 200);
  assert.equal((await request(app).get('/api/tpm/attribution/resolve?siteId=x&month=2026-10').set(as(viewer))).status, 400);
  const r = await request(app).get(`/api/tpm/attribution/resolve?siteId=${SITE}&month=2026-10`).set(as(viewer));
  assert.equal(r.status, 200);
  assert.deepEqual(last().args, [TENANT, { siteId: SITE, month: '2026-10' }]);
});

test('visites : contractId d\'un ancien client ignoré ; raison du TPM nettoyée ou refusée ; zone et TPM exclusifs', async () => {
  const res = await request(app).post('/api/tpm/field/visits').set(as(manager))
    .send({ siteId: SITE, periodMonth: '2026-10', contractId: AREA, providerId: PROV, providerReason: '  Accès   difficile au site  ' });
  assert.equal(res.status, 201);
  const [, , v] = last().args;
  assert.equal('contractId' in v, false);
  assert.equal(v.providerReason, 'Accès difficile au site');
  const short = await request(app).post('/api/tpm/field/visits').set(as(manager)).send({ siteId: SITE, periodMonth: '2026-10', providerId: PROV, providerReason: 'court' });
  assert.equal(short.status, 400);
  assert.equal(short.body.details.code, 'reason_short');
  const both = await request(app).patch(`/api/tpm/field/visits/${SITE}`).set(as(manager)).send({ followZone: true, providerId: PROV });
  assert.equal(both.status, 400);
  const zone = await request(app).patch(`/api/tpm/field/visits/${SITE}`).set(as(manager)).send({ followZone: true, contractId: AREA });
  assert.equal(zone.status, 204);
  assert.deepEqual(last().args.slice(1), [SITE, { followZone: true, providerReason: null }, 'u1']);
});
