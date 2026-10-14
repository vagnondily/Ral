/**
 * Période des endpoints (lot 1b) de bout en bout SANS base : les dépôts sont des
 * espions. On vérifie ce qui ARRIVE au dépôt : `?month=` (hérité) ≡ `?from=&to=`
 * d'un mois, la plage transmise telle quelle, aucun paramètre → null (là où la
 * période est facultative), et un 400 avec `details.code` pour chaque erreur.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-de-periode-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mon = require('../src/modules/monitoring/monitoring.repository');
const monitoringRoutes = require('../src/modules/monitoring/monitoring.routes');
const field = require('../src/modules/tpm/field.repository');
const fieldRoutes = require('../src/modules/tpm/field.routes');
const cons = require('../src/modules/tpm/consolidation.repository');
const consolidationRoutes = require('../src/modules/tpm/consolidation.routes');
const { errorHandler } = require('../src/middleware/errors');

const calls = [];
const spy = (name, out = {}) => async (...args) => { calls.push({ name, args }); return typeof out === 'function' ? out(...args) : out; };
mon.processOverview = spy('overview');
mon.coverageDashboard = spy('coverage');
mon.computeValues = spy('values');
mon.dashboard = spy('dashboard');
mon.formSubmissions = spy('formSubmissions', { rows: [] });
mon.listSubmissions = spy('submissions', []);
mon.indicatorPreview = spy('preview', { n: 0 });
mon.monthCounts = spy('monthCounts', [{ month: '2026-07', formId: 'f', n: 74 }, { month: '2026-06', formId: 'f', n: 58 }]);
field.summary = spy('fieldSummary');
field.listVisits = spy('visits', []);
field.coverageRecapSummary = spy('recap');
field.coverageMatrix = spy('matrix');
field.rbmSites = spy('rbm', []);
cons.consolidation = spy('consolidation', { rows: [] });

const app = express();
app.use(express.json());
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/tpm/field', fieldRoutes);
app.use('/api/tpm/consolidation', consolidationRoutes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const get = (url) => request(app).get(url).set({ Authorization: `Bearer ${viewer}` });
const last = () => calls[calls.length - 1];

// [endpoint, nom de l'espion, période extraite des arguments, durée maximale]
const MONITORING_AND_FIELD = [
  ['/api/monitoring/overview', 'overview', (a) => a[1], 24],
  ['/api/monitoring/coverage-dashboard', 'coverage', (a) => a[1], 24],
  [`/api/monitoring/forms/${FORM}/values`, 'values', (a) => a[2].period, 24],
  [`/api/monitoring/forms/${FORM}/dashboard`, 'dashboard', (a) => a[2].period, 24],
  [`/api/monitoring/forms/${FORM}/submissions`, 'formSubmissions', (a) => a[2].period, 12],
  ['/api/monitoring/submissions', 'submissions', (a) => a[1].period, 12],
  ['/api/tpm/field/summary', 'fieldSummary', (a) => a[1].period, 24],
  ['/api/tpm/field/visits', 'visits', (a) => a[1].period, 12],
  ['/api/tpm/field/coverage-recap', 'recap', (a) => a[1].period, 24],
];

const ERRORS = [
  ['month=abc', 'period_format'],
  ['month=2026-13', 'period_format'],
  ['month=2026-01&month=2026-02', 'period_format'],
  ['from=2026-01', 'period_partial'],
  ['to=2026-01', 'period_partial'],
  ['month=2026-07&from=2026-01&to=2026-02', 'period_ambiguous'],
  ['from=2026-06&to=2026-01', 'period_order'],
  ['from=1999-01&to=1999-02', 'period_year'],
];

for (const [url, name, periodOf, maxSpan] of MONITORING_AND_FIELD) {
  test(`${url} : ?month ≡ from=to, plage transmise, sans paramètre → null`, async () => {
    assert.equal((await get(`${url}?month=2026-07`)).status, 200);
    const a = last(); assert.equal(a.name, name);
    assert.deepEqual(periodOf(a.args), { from: '2026-07', to: '2026-07' });
    assert.equal(a.args[0], TENANT, 'le tenant vient du jeton');
    await get(`${url}?from=2026-07&to=2026-07`);
    assert.deepEqual(periodOf(last().args), { from: '2026-07', to: '2026-07' });
    await get(`${url}?from=2026-01&to=2026-06`);
    assert.deepEqual(periodOf(last().args), { from: '2026-01', to: '2026-06' });
    await get(`${url}?month=2026-07-15`);
    assert.deepEqual(periodOf(last().args), { from: '2026-07', to: '2026-07' }, 'AAAA-MM-JJ tronqué au mois');
    await get(url);
    assert.equal(periodOf(last().args), null);
  });

  test(`${url} : 400 avec details.code pour chaque période mal formée, rien n'arrive au dépôt`, async () => {
    const n = calls.length;
    for (const [q, code] of ERRORS) {
      const res = await get(`${url}?${q}`);
      assert.equal(res.status, 400, q);
      assert.equal(res.body.details.code, code, q);
      assert.ok(res.body.error.startsWith('Période'), q);
    }
    // Durée maximale propre à l'endpoint (analyse : 24 mois ; listes : 12 mois) : un mois de plus est refusé.
    const over = await get(`${url}?from=${{ 12: '2025-12', 24: '2024-12', 60: '2021-12' }[maxSpan]}&to=2026-12`);
    assert.equal(over.status, 400);
    assert.equal(over.body.details.code, 'period_span');
    assert.equal(over.body.details.maxSpan, maxSpan);
    assert.equal(over.body.details.span, maxSpan + 1);
    const atMax = `?from=${{ 12: '2026-01', 24: '2025-01', 60: '2022-01' }[maxSpan]}&to=2026-12`;
    assert.equal((await get(`${url}${atMax}`)).status, 200, `${maxSpan} mois acceptés`);
    assert.equal(calls.length, n + 1, 'seule la période valide a atteint le dépôt');
  });
}

test('aperçu du calcul : corps { month } ou { from, to }, ordre et durée contrôlés, null = absent', async () => {
  const post = (b) => request(app).post(`/api/monitoring/forms/${FORM}/indicators/preview`).set({ Authorization: `Bearer ${viewer}` }).send({ sourceField: 'q1', ...b });
  assert.equal((await post({ month: '2026-07' })).status, 200);
  assert.deepEqual(last().args[3], { from: '2026-07', to: '2026-07' });
  await post({ from: '2026-01', to: '2026-06' });
  assert.deepEqual(last().args[3], { from: '2026-01', to: '2026-06' });
  await post({ month: null, from: null, to: null });
  assert.equal(last().args[3], null);
  const order = await post({ from: '2026-06', to: '2026-01' });
  assert.equal(order.status, 400); assert.equal(order.body.details.code, 'period_order');
  const span = await post({ from: '2024-01', to: '2026-06' });
  assert.equal(span.status, 400); assert.equal(span.body.details.code, 'period_span');
  const arr = await post({ month: ['2026-01'] });
  assert.equal(arr.status, 400); assert.equal(arr.body.details.code, 'period_format');
});

test('GET /monitoring/periods : la période par défaut porte from et to (= le mois par défaut)', async () => {
  const res = await get('/api/monitoring/periods?today=2026-10');
  assert.equal(res.status, 200);
  assert.equal(res.body.default.month, '2026-07');
  assert.equal(res.body.default.from, '2026-07');
  assert.equal(res.body.default.to, '2026-07');
});

test('matrice de couverture : ?year= (historique) ou une période (colonnes = mois de la période)', async () => {
  await get('/api/tpm/field/coverage-matrix?year=2026');
  assert.deepEqual(last().args[1], { period: undefined, year: 2026 });
  await get('/api/tpm/field/coverage-matrix?from=2026-01&to=2026-06');
  assert.deepEqual(last().args[1].period, { from: '2026-01', to: '2026-06' });
  await get('/api/tpm/field/coverage-matrix?month=2026-07');
  assert.deepEqual(last().args[1].period, { from: '2026-07', to: '2026-07' });
  const bad = await get('/api/tpm/field/coverage-matrix?from=2026-06&to=2026-01');
  assert.equal(bad.body.details.code, 'period_order');
});

test('RBM : ?from&to → mois de référence = to (un état se lit à un mois), état borné à ce mois', async () => {
  await get('/api/tpm/field/rbm/sites?from=2026-01&to=2026-06&risk=elevee');
  assert.deepEqual(last().args[1], { month: '2026-06', asOf: '2026-06', risk: 'elevee' });
  await get('/api/tpm/field/rbm/sites?month=2026-06');
  assert.deepEqual(last().args[1], { month: '2026-06', asOf: '2026-06', risk: undefined }, '?month ≡ from = to');
  await get('/api/tpm/field/rbm/sites');
  assert.deepEqual(last().args[1], { month: undefined, asOf: null, risk: undefined });
  assert.equal((await get('/api/tpm/field/rbm/sites?month=abc')).body.details.code, 'period_format');
});

test('consolidation : période facultative (null = cumul seul), ?month ≡ from=to, today à part, 60 mois au plus', async () => {
  await get('/api/tpm/consolidation?today=2026-10');
  assert.deepEqual(last().args[1], { today: '2026-10', period: null });
  await get('/api/tpm/consolidation?from=2026-01&to=2026-06&today=2026-10-14');
  assert.deepEqual(last().args[1], { today: '2026-10', period: { from: '2026-01', to: '2026-06' } });
  await get('/api/tpm/consolidation?month=2026-07');
  assert.deepEqual(last().args[1], { today: undefined, period: { from: '2026-07', to: '2026-07' } });
  await get('/api/tpm/consolidation?today=2026-13');
  assert.equal(last().args[1].today, undefined, 'mois de référence invalide ignoré (comportement historique)');
  for (const [q, code] of ERRORS) {
    const res = await get(`/api/tpm/consolidation?${q}`);
    assert.equal(res.status, 400, q);
    assert.equal(res.body.details.code, code, q);
  }
  assert.equal((await get('/api/tpm/consolidation?from=2022-01&to=2026-12')).status, 200, '60 mois acceptés');
  assert.equal((await get('/api/tpm/consolidation?from=2021-12&to=2026-12')).body.details.code, 'period_span');
});
