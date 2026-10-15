/**
 * Routes de la planification automatique (lot 5), SANS base : le service est remplacé par un
 * espion. Lecture des paramètres pour tous ; modification réservée à l'administrateur ; aperçu
 * et application : administrateur ou gestionnaire. Toute entrée est validée (zod, strict) ; le
 * compte et l'auteur viennent du jeton, jamais du corps.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-du-plan-automatique-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const service = require('../src/modules/tpm/plan.service');
const routes = require('../src/modules/tpm/plan.routes');
const { errorHandler } = require('../src/middleware/errors');
const { DEFAULTS } = require('../src/modules/tpm/planSettings');

const calls = [];
service.getSettings = async (tenantId) => { calls.push({ fn: 'getSettings', tenantId }); return { settings: DEFAULTS, revision: 0 }; };
service.saveSettings = async (tenantId, userId, body) => { calls.push({ fn: 'saveSettings', tenantId, userId, body }); return { ok: true }; };
service.preview = async (tenantId, body) => { calls.push({ fn: 'preview', tenantId, body }); return { proposals: [] }; };
service.apply = async (tenantId, userId, body) => { calls.push({ fn: 'apply', tenantId, userId, body }); return { created: 1 }; };

const app = express();
app.use(express.json({ limit: '1mb' })); // comme app.js
app.use('/api/tpm/plan', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const tok = (role, sub = 'u1') => jwt.sign({ sub, tenantId: TENANT, role }, process.env.JWT_SECRET);
const as = (role) => ({ Authorization: `Bearer ${tok(role)}` });
const SITE = '44444444-4444-4444-4444-444444444444';
const FP = 'a'.repeat(64);
const settingsBody = { ...DEFAULTS, levels: [...DEFAULTS.levels], revision: 0 };

test('GET /settings : tout utilisateur connecté, compte du jeton ; sans jeton → 401', async () => {
  const res = await request(app).get('/api/tpm/plan/settings').set(as('viewer'));
  assert.equal(res.status, 200);
  assert.equal(calls.at(-1).tenantId, TENANT);
  assert.equal((await request(app).get('/api/tpm/plan/settings')).status, 401);
});

test('PUT /settings : administrateur seulement ; corps strict et borné, rien n\'est appelé sur une erreur', async () => {
  for (const role of ['viewer', 'manager']) assert.equal((await request(app).put('/api/tpm/plan/settings').set(as(role)).send(settingsBody)).status, 403);
  const n = calls.length;
  const bad = [
    { ...settingsBody, coverageTargetPct: 0 },
    { ...settingsBody, levels: ['urgent'] },
    { ...settingsBody, levels: ['haute', 'haute'] },
    { ...settingsBody, defaultVisitsPerDay: 0.7 },
    { ...settingsBody, minMonthsSinceVisit: 30 },
    { ...settingsBody, tenantId: '22222222-2222-2222-2222-222222222222' },
    (({ revision, ...rest }) => rest)(settingsBody),
  ];
  for (const b of bad) assert.equal((await request(app).put('/api/tpm/plan/settings').set(as('admin')).send(b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal(calls.length, n);
  const ok = await request(app).put('/api/tpm/plan/settings').set(as('admin')).send({ ...settingsBody, coverageTargetPct: 90 });
  assert.equal(ok.status, 200);
  assert.deepEqual([calls.at(-1).tenantId, calls.at(-1).userId, calls.at(-1).body.coverageTargetPct], [TENANT, 'u1', 90]);
});

test('POST /preview : administrateur ou gestionnaire ; plage, périmètre et critères validés', async () => {
  assert.equal((await request(app).post('/api/tpm/plan/preview').set(as('viewer')).send({ year: 2026, from: 1, to: 12 })).status, 403);
  const n = calls.length;
  for (const b of [{ year: 2026, from: 5, to: 4 }, { year: 2026, from: 0, to: 4 }, { year: 1990, from: 1, to: 2 },
    { year: 2026, from: 1, to: 2, officeId: 'pas-un-uuid' }, { year: 2026, from: 1, to: 2, params: { inconnu: 1 } },
    { year: 2026, from: 1, to: 2, params: { capacityMarginPct: 500 } }, { year: 2026, from: 1, to: 2, tenantId: TENANT }]) {
    assert.equal((await request(app).post('/api/tpm/plan/preview').set(as('manager')).send(b)).status, 400, JSON.stringify(b));
  }
  assert.equal(calls.length, n);
  const res = await request(app).post('/api/tpm/plan/preview').set(as('manager'))
    .send({ year: 2026, from: 10, to: 12, activity: '  ', params: { levels: ['haute'], minMonthsSinceVisit: 3 } });
  assert.equal(res.status, 200);
  const c = calls.at(-1);
  assert.equal(c.tenantId, TENANT);
  assert.equal(c.body.activity, null);
  assert.deepEqual(c.body.params, { levels: ['haute'], minMonthsSinceVisit: 3 });
});

test('POST /apply : empreinte, propositions gardées (1 à 5 000) et coches manuelles validées', async () => {
  const base = { year: 2026, from: 10, to: 12, fingerprint: FP, keep: [{ siteId: SITE, month: 10 }] };
  assert.equal((await request(app).post('/api/tpm/plan/apply').set(as('viewer')).send(base)).status, 403);
  const n = calls.length;
  for (const b of [{ ...base, keep: [] }, { ...base, fingerprint: 'zz' }, { ...base, keep: [{ siteId: SITE, month: 13 }] },
    { ...base, keep: Array.from({ length: 5001 }, () => ({ siteId: SITE, month: 10 })) },
    { ...base, changes: [{ siteId: SITE, month: 10 }] }, { ...base, keep: [{ siteId: SITE, month: 10, providerId: SITE }] }]) {
    assert.equal((await request(app).post('/api/tpm/plan/apply').set(as('admin')).send(b)).status, 400);
  }
  assert.equal(calls.length, n);
  const res = await request(app).post('/api/tpm/plan/apply').set(as('admin')).send({ ...base, changes: [{ siteId: SITE, month: 11, planned: false }] });
  assert.equal(res.status, 200);
  assert.deepEqual([calls.at(-1).tenantId, calls.at(-1).userId, calls.at(-1).body.changes.length, calls.at(-1).body.sections], [TENANT, 'u1', 1, {}]);
});
