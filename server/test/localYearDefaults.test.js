/**
 * Exercice par défaut = année du mois courant LOCAL (APP_TIMEZONE), jamais celle du fuseau du
 * processus : le 31/12 à 22 h 30 UTC il est déjà 1 h 30 le 1ᵉʳ janvier à Madagascar. Par HTTP
 * (GET /api/tpm/field/months, /coverage-matrix — appelés sans année par l'écran) et par la source
 * « planBoard » des rapports, SANS base (faux client).
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-exercices-par-defaut-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const calls = [];
db.withTenantTransaction = async (_tenantId, fn) => fn({
  query: async (sql, params = []) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [] }; },
});

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const field = require('../src/modules/tpm/field.repository');
const routes = require('../src/modules/tpm/field.routes');
const sources = require('../src/modules/reports/sources/coverage');
const { errorHandler } = require('../src/middleware/errors');
const { withFrozenClock } = require('./helpers/frozenClock');

const app = express();
app.use(express.json());
app.use('/api/tpm/field', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const get = (url) => request(app).get(url).set({ Authorization: `Bearer ${viewer}` });
const NYE = '2026-12-31T22:30:00Z';

test('GET /months sans année : 2027 à Madagascar, 2026 en UTC ; une année donnée est gardée', async () => {
  const local = await withFrozenClock(NYE, () => get('/api/tpm/field/months'));
  assert.equal(local.status, 200);
  assert.equal(local.body.year, 2027);
  assert.equal(local.body.months[0].month, '2027-01');
  const utc = await withFrozenClock(NYE, () => get('/api/tpm/field/months'), { timeZone: 'UTC' });
  assert.equal(utc.status, 200);
  assert.equal(utc.body.year, 2026);
  const asked = await withFrozenClock(NYE, () => get('/api/tpm/field/months?year=2025'));
  assert.equal(asked.body.year, 2025);
});

test('GET /coverage-matrix sans année ni période : colonnes de 2027 à Madagascar, de 2026 en UTC', async () => {
  calls.length = 0;
  const local = await withFrozenClock(NYE, () => get('/api/tpm/field/coverage-matrix'));
  assert.equal(local.status, 200);
  assert.equal(local.body.year, 2027);
  assert.ok(calls.some((c) => c.params.some((p) => String(p).startsWith('2027-01'))), 'bornes de 2027 liées');
  assert.ok(!calls.some((c) => c.params.some((p) => String(p).startsWith('2026-'))));
  const utc = await withFrozenClock(NYE, () => get('/api/tpm/field/coverage-matrix'), { timeZone: 'UTC' });
  assert.equal(utc.status, 200);
  assert.equal(utc.body.year, 2026);
});

test('rapports, source « planBoard » sans année : exercice du mois courant local', async () => {
  const src = sources.find((s) => s.key === 'planBoard');
  const seen = [];
  const saved = field.planBoard;
  field.planBoard = async (tenantId, opts) => { seen.push(opts.year); return { year: opts.year, sites: [] }; };
  try {
    await withFrozenClock(NYE, () => src.load(TENANT, {}));
    await withFrozenClock(NYE, () => src.load(TENANT, {}), { timeZone: 'UTC' });
    await withFrozenClock(NYE, () => src.load(TENANT, { year: 2025 }));
  } finally {
    field.planBoard = saved;
  }
  assert.deepEqual(seen, [2027, 2026, 2025]);
});
