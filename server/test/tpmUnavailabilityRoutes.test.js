/**
 * Routes des indisponibilités des TPM et des rapports attendus (retour 114) SANS base : les services
 * sont remplacés par des espions. Entrées bornées au bord (zod + règle commune des périodes) ;
 * écriture admin / manager ; compte et auteur du jeton, jamais du corps.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-indisponibilites-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const unavailability = require('../src/modules/tpm/tpmUnavailability.service');
const reportsRepo = require('../src/modules/tpm/reports.repository');

const calls = [];
for (const name of ['list', 'preview', 'setUnavailable', 'endUnavailable']) {
  unavailability[name] = async (...args) => { calls.push({ name, args }); return { ok: true }; };
}
reportsRepo.expectedReports = async (...args) => { calls.push({ name: 'expectedReports', args }); return { rows: [], counts: {} }; };

const routes = require('../src/modules/tpm/tpmAttribution.routes');
const reportRoutes = require('../src/modules/tpm/reports.routes');
const { errorHandler } = require('../src/middleware/errors');

const app = express();
app.use(express.json());
app.use('/api/tpm/attribution', routes);
app.use('/api/tpm/reports', reportRoutes);
app.use(errorHandler);

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROV = '44444444-4444-4444-4444-444444444444';
const manager = jwt.sign({ sub: 'u1', tenantId: TENANT, role: 'manager' }, process.env.JWT_SECRET);
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const as = (tok) => ({ Authorization: `Bearer ${tok}` });
const last = () => calls[calls.length - 1];
const body = { providerId: PROV, from: '2026-11', to: '2027-01', reason: 'Équipe mobilisée ailleurs', stamp: 'abc' };

test('GET /unavailability : période par défaut (mois courant + 11), compte du jeton', async () => {
  const res = await request(app).get('/api/tpm/attribution/unavailability?tenantId=autre').set(as(viewer));
  assert.equal(res.status, 200);
  const [tenantId, opts] = last().args;
  assert.equal(tenantId, TENANT);
  assert.match(opts.period.from, /^\d{4}-\d{2}$/);
});

test('aperçu : un TPM, une plage de 24 mois au plus, un mode connu ; lecture permise au lecteur', async () => {
  const ok = await request(app).post('/api/tpm/attribution/unavailability/preview').set(as(viewer)).send({ ...body, mode: 'poser' });
  assert.equal(ok.status, 200);
  assert.deepEqual(last().args, [TENANT, { providerId: PROV, from: '2026-11', to: '2027-01', reason: body.reason, mode: 'poser' }]);
  const n = calls.length;
  for (const bad of [{ ...body, mode: 'oublier' }, { ...body, mode: 'poser', providerId: 'x' }, { ...body, mode: 'poser', from: '2026-13' },
    { ...body, mode: 'poser', from: '2025-01', to: '2027-06' }, { ...body, mode: 'poser', to: '2026-10' }]) {
    const r = await request(app).post('/api/tpm/attribution/unavailability/preview').set(as(viewer)).send(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(calls.length, n, 'rien n atteint le service');
});

test('déclarer / mettre fin : admin ou manager seulement, empreinte exigée, auteur du jeton (jamais du corps)', async () => {
  const denied = await request(app).put('/api/tpm/attribution/unavailability').set(as(viewer)).send(body);
  assert.equal(denied.status, 403);
  const put = await request(app).put('/api/tpm/attribution/unavailability').set(as(manager)).send({ ...body, tenantId: 'autre', userId: 'autre' });
  assert.equal(put.status, 200);
  const [tenantId, actor, input] = last().args;
  assert.deepEqual([tenantId, actor.userId, input.stamp, input.tenantId], [TENANT, 'u1', 'abc', undefined]);
  const noStamp = await request(app).post('/api/tpm/attribution/unavailability/end').set(as(manager)).send({ ...body, stamp: '' });
  assert.equal(noStamp.status, 400);
  const end = await request(app).post('/api/tpm/attribution/unavailability/end').set(as(manager)).send({ ...body, reason: null });
  assert.equal(end.status, 200);
  assert.equal(last().name, 'endUnavailable');
});

test('GET /reports/expected : période (60 mois au plus), compte du jeton, mois courant transmis', async () => {
  const res = await request(app).get('/api/tpm/reports/expected?from=2026-01&to=2026-06').set(as(viewer));
  assert.equal(res.status, 200);
  const [tenantId, opts] = last().args;
  assert.equal(tenantId, TENANT);
  assert.deepEqual(opts.period, { from: '2026-01', to: '2026-06' });
  assert.match(opts.today, /^\d{4}-\d{2}$/);
  const dflt = await request(app).get('/api/tpm/reports/expected').set(as(viewer));
  assert.equal(dflt.status, 200);
  assert.equal(last().args[1].period.to, last().args[1].today, 'défaut : les 3 derniers mois');
  const tooLong = await request(app).get('/api/tpm/reports/expected?from=2020-01&to=2026-06').set(as(viewer));
  assert.equal(tooLong.status, 400);
});
