/**
 * Tableau de bord « Couverture & performance du suivi » — routes de bout en bout SANS base
 * (le dépôt est remplacé par un espion, modèle mapRoutes) puis dépôt avec un faux client
 * (modèle monitoringPeriodRepo) :
 *  - entrées bornées au bord : période requise, 12 mois au plus (analyse), bureau uuid,
 *    activité OU fiches sans activité ; le compte vient du jeton, jamais de la requête ;
 *  - SQL : tenant_id = $1 partout, activité sans la casse, sous-arbre du bureau (récursif),
 *    une passe de faits par fiche, l'une après l'autre.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-performance-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/dashboards/performance.repository');

const calls = [];
const FACTS = { forms: [], registry: [{ activity: 'School meal activities', sites: 4 }], agentNames: new Map() };
repo.performanceFacts = async (tenantId, opts) => { calls.push({ tenantId, opts }); return FACTS; };

const routes = require('../src/modules/dashboards/performance.routes');
const { errorHandler } = require('../src/middleware/errors');

const app = express();
app.use(express.json());
app.use('/api/dashboards/performance', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const OFFICE = '22222222-2222-2222-2222-222222222222';
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const as = (tok) => ({ Authorization: `Bearer ${tok}` });
const last = () => calls[calls.length - 1];

test('GET / : 200, compte tiré du jeton, bureau et période transmis, activités du registre', async () => {
  const res = await request(app).get(`/api/dashboards/performance?from=2026-01&to=2026-06&office=${OFFICE}&tenant_id=autre`).set(as(viewer));
  assert.equal(res.status, 200);
  assert.equal(last().tenantId, TENANT);
  assert.deepEqual(last().opts, { period: { from: '2026-01', to: '2026-06' }, officeId: OFFICE, group: 'bureau_month', visitsKeep: 15, registry: true });
  assert.deepEqual(res.body.period, { from: '2026-01', to: '2026-06', months: 6 });
  assert.deepEqual(res.body.activities.map((a) => [a.label, a.kind, a.templateKey]), [['SMP · Cantines Scolaires', 'modele', 'SMP']]);
  assert.equal(res.body.overall.weightedIndex, null);
  // « Tous » (bureau vide) = sans filtre ; ?month= raccourci d'un mois.
  const r2 = await request(app).get('/api/dashboards/performance?month=2026-09&office=').set(as(viewer));
  assert.equal(r2.status, 200);
  assert.deepEqual([last().opts.period, last().opts.officeId], [{ from: '2026-09', to: '2026-09' }, null]);
});

test('GET / : 401 sans jeton ; 400 sans période, plage > 12 mois, mois invalide, bureau non uuid', async () => {
  assert.equal((await request(app).get('/api/dashboards/performance?month=2026-09')).status, 401);
  const n = calls.length;
  const bad = [
    ['/api/dashboards/performance', 'period_required'],
    ['/api/dashboards/performance?from=2025-01&to=2026-06', 'period_span'],
    ['/api/dashboards/performance?month=2026-13', 'period_format'],
  ];
  for (const [url, code] of bad) {
    const res = await request(app).get(url).set(as(viewer));
    assert.equal(res.status, 400, url);
    assert.equal(res.body.details.code, code, url);
  }
  const r = await request(app).get('/api/dashboards/performance?month=2026-09&office=pas-un-uuid').set(as(viewer));
  assert.equal(r.status, 400);
  assert.equal(calls.length, n, 'aucune lecture sur une entrée refusée');
});

test('GET /trend et /agents : une activité OU les fiches sans activité ; fenêtre des tendances', async () => {
  const t = await request(app).get('/api/dashboards/performance/trend?from=2026-03&to=2026-04&activity=%20School%20meal%20activities%20').set(as(viewer));
  assert.equal(t.status, 200);
  // Fenêtre : au moins 12 mois finissant au dernier mois de la période.
  assert.deepEqual(last().opts, { period: { from: '2025-05', to: '2026-04' }, officeId: null, activity: 'School meal activities', group: 'month', visitsKeep: 1 });
  assert.equal(t.body.months.length, 12);
  assert.deepEqual([t.body.forms, t.body.delta.direction], [0, null]);
  const a = await request(app).get(`/api/dashboards/performance/agents?month=2026-04&none=1&office=${OFFICE}`).set(as(viewer));
  assert.equal(a.status, 200);
  assert.deepEqual(last().opts, { period: { from: '2026-04', to: '2026-04' }, officeId: OFFICE, activity: '', group: 'agent', visitsKeep: 1 });
  assert.deepEqual(a.body.totals, { agents: 0, avgFill: null, lowFill: 0, visits: 0, completeness: null });
  const n = calls.length;
  for (const q of ['month=2026-04', 'month=2026-04&activity=X&none=1', 'month=2026-04&none=0', `month=2026-04&activity=${'x'.repeat(201)}`]) {
    const res = await request(app).get(`/api/dashboards/performance/trend?${q}`).set(as(viewer));
    assert.equal(res.status, 400, q);
  }
  assert.equal(calls.length, n);
});

test('dépôt : tenant_id = $1, activité sans la casse, fiches sans activité, sous-arbre du bureau, une passe par fiche', async () => {
  delete require.cache[require.resolve('../src/modules/dashboards/performance.repository')];
  const db = require('../src/config/db');
  const sqls = [];
  const original = db.withTenantTransaction;
  db.withTenantTransaction = async (tenantId, fn) => fn({
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      sqls.push({ sql: s, params, tenantId });
      if (/FROM monitoring_forms f WHERE f\.tenant_id = \$1/.test(s)) return { rows: [{ id: 'f1', code: 'F1', label: 'Fiche', activityCategory: 'School meal activities' }] };
      return { rows: [] };
    },
  });
  try {
    const fresh = require('../src/modules/dashboards/performance.repository');
    await fresh.performanceFacts(TENANT, { period: { from: '2026-01', to: '2026-03' }, officeId: OFFICE, activity: 'School Meal Activities', group: 'agent', visitsKeep: 1, registry: true });
    const forms = sqls.find((c) => /FROM monitoring_forms f/.test(c.sql));
    assert.match(forms.sql, /f\.tenant_id = \$1 AND f\.active = true AND lower\(btrim\(f\.activity_category\)\) = lower\(btrim\(\$2::text\)\)/);
    assert.deepEqual(forms.params, [TENANT, 'School Meal Activities']);
    const facts = sqls.find((c) => /FROM monitoring_submissions s/.test(c.sql));
    assert.equal(facts.params[0], TENANT);
    assert.equal(facts.params[1], 'f1');
    assert.match(facts.sql, /s\.tenant_id = \$1 AND s\.form_id = \$2/);
    assert.match(facts.sql, /field_office_id IN \(SELECT o\.id FROM field_offices o WHERE o\.tenant_id = s\.tenant_id/);
    const reg = sqls.find((c) => /FROM sites s/.test(c.sql));
    assert.match(reg.sql, /^WITH RECURSIVE office_tree AS \(/);
    assert.match(reg.sql, /s\.tenant_id = \$1 AND NULLIF\(btrim\(s\.activity\), ''\) IS NOT NULL AND s\.field_office_id IN \(SELECT id FROM office_tree\)/);
    assert.deepEqual(reg.params, [TENANT, OFFICE]);
    // Fiches sans activité : catégorie vide, aucun paramètre d'activité.
    sqls.length = 0;
    await fresh.performanceFacts(TENANT, { period: { from: '2026-01', to: '2026-01' }, activity: '', group: 'month' });
    const none = sqls.find((c) => /FROM monitoring_forms f/.test(c.sql));
    assert.match(none.sql, /NULLIF\(btrim\(f\.activity_category\), ''\) IS NULL/);
    assert.deepEqual(none.params, [TENANT]);
    assert.ok(sqls.every((c) => c.tenantId === TENANT));
  } finally {
    db.withTenantTransaction = original;
  }
});
