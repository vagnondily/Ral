/**
 * GET /api/dashboards/coverage (retour 110) — route de bout en bout SANS base (le dépôt est
 * remplacé par un espion, modèle performanceRoutes) puis requête du dépôt sur un faux client :
 *  - entrées bornées au bord : période requise, 24 mois au plus (faits site × mois), bureau uuid ;
 *    le compte vient du jeton, jamais de la requête ;
 *  - SQL : service unique des faits (siteMonthFactsCtes, mode données), tenant_id = $1, état RBM
 *    lu d'abord, puis UNE requête regroupée (total, activité, bureau, district).
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-des-routes-couverture-0123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const repo = require('../src/modules/dashboards/coverage.repository');

const calls = [];
const ROWS = [
  { dim: 'overall', key: null, registry: 10, forbidden: 1, sites: 6, covered: 3, coveredData: 2, coveredVisit: 2, plannedSites: 4, plannedCovered: 2, plannedData: 1, plannedVisit: 2, visitsPlanned: 5, visitsCovered: 2, visitsData: 1, visitsVisit: 2, refSites: 5, refDue: 2, communes: 3, communesData: 1, knownAll: true, knownAny: true },
  { dim: 'activity', key: 'school meal activities', activityLabel: 'School meal activities', registry: 9, forbidden: 1, sites: 6, covered: 3, coveredData: 2, coveredVisit: 2, plannedSites: 4, plannedCovered: 2, plannedData: 1, plannedVisit: 2, visitsPlanned: 5, visitsCovered: 2, visitsData: 1, visitsVisit: 2, refSites: 5, refDue: 2 },
  { dim: 'activity', key: '—', activityLabel: '—', registry: 1, sites: 0 },
];
const realFacts = repo.coverageFacts;
repo.coverageFacts = async (tenantId, opts) => { calls.push({ tenantId, opts }); return { rows: ROWS, refMonth: opts.period.to }; };

const routes = require('../src/modules/dashboards/coverage.routes');
const { errorHandler } = require('../src/middleware/errors');

const app = express();
app.use(express.json());
app.use('/api/dashboards/coverage', routes);
app.use(errorHandler);
const TENANT = '11111111-1111-1111-1111-111111111111';
const OFFICE = '22222222-2222-2222-2222-222222222222';
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const as = (tok) => ({ Authorization: `Bearer ${tok}` });
const last = () => calls[calls.length - 1];

test('GET / : 200, compte tiré du jeton, mesures mises en forme (univers, suivis, prévus, RBM, communes)', async () => {
  const res = await request(app).get(`/api/dashboards/coverage?from=2026-01&to=2026-09&office=${OFFICE}&tenant_id=autre`).set(as(viewer));
  assert.equal(res.status, 200);
  assert.deepEqual(last(), { tenantId: TENANT, opts: { period: { from: '2026-01', to: '2026-09' }, officeId: OFFICE } });
  const b = res.body;
  assert.deepEqual(b.period, { from: '2026-01', to: '2026-09', months: 9 });
  assert.equal(b.refMonth, '2026-09');
  assert.deepEqual(b.universe, { sites: 6, registry: 10, forbidden: 1, inactive: 3, activation: 'grid' });
  assert.deepEqual(b.overall.coverage, { covered: 3, byData: 2, byVisit: 2, both: 1, rate: 0.5 });
  assert.deepEqual(b.overall.execution, { planned: 5, covered: 2, byData: 1, byVisit: 2, both: 1, upcoming: 0, upcomingUnset: 0, cancelled: 0, rate: 0.4 });
  assert.deepEqual([b.overall.rbm.sites, b.overall.rbm.due, b.overall.rbm.upToDate, b.overall.rbm.rate], [5, 2, 3, 0.6]);
  assert.deepEqual(b.communes, { total: 3, withData: 1, rate: 1 / 3 });
  // Activité sans site de l'univers : non listée (aucune mesure) ; le découpage se somme aux tuiles.
  assert.deepEqual(b.byActivity.map((a) => [a.key, a.label, a.sites]), [['school meal activities', 'School meal activities', 6]]);
  // « Tous » (bureau vide) = sans filtre ; ?month= raccourci d'un mois ; 24 mois acceptés (faits).
  const r2 = await request(app).get('/api/dashboards/coverage?from=2025-01&to=2026-12&office=').set(as(viewer));
  assert.equal(r2.status, 200);
  assert.deepEqual(last().opts, { period: { from: '2025-01', to: '2026-12' }, officeId: null });
});

test('GET / : 401 sans jeton ; 400 sans période, plage > 24 mois, mois invalide, bureau non uuid — rien n\'est lu', async () => {
  assert.equal((await request(app).get('/api/dashboards/coverage?month=2026-09')).status, 401);
  const n = calls.length;
  for (const [url, code] of [
    ['/api/dashboards/coverage', 'period_required'],
    ['/api/dashboards/coverage?from=2024-01&to=2026-06', 'period_span'],
    ['/api/dashboards/coverage?month=2026-13', 'period_format'],
  ]) {
    const res = await request(app).get(url).set(as(viewer));
    assert.equal(res.status, 400, url);
    assert.equal(res.body.details.code, code, url);
  }
  assert.equal((await request(app).get('/api/dashboards/coverage?month=2026-09&office=x').set(as(viewer))).status, 400);
  assert.equal(calls.length, n);
});

test('dépôt : état RBM lu d\'abord, puis UNE requête regroupée sur le service unique, tenant_id = $1, mois de référence = fin de période', async () => {
  const db = require('../src/config/db');
  const field = require('../src/modules/tpm/field.repository');
  const sqls = [];
  const client = {
    query: async (sql, params) => {
      sqls.push({ sql: String(sql), params });
      if (/FROM sites s\b/.test(sql) && /WITH facts AS/.test(sql)) return { rows: [] }; // lignes RBM
      return { rows: [] };
    },
  };
  const realTx = db.withTenantTransaction;
  db.withTenantTransaction = async (tenantId, fn) => fn(client);
  const realRbm = field.rbmSitesTx;
  let rbmArgs = null;
  field.rbmSitesTx = async (c, tenantId, opts) => { rbmArgs = { tenantId, opts }; return [{ id: 'a', due: true }, { id: 'b', due: false }]; };
  try {
    // Recharge le dépôt avec les doublures (il lit withTenantTransaction et rbmSitesTx à l'import).
    delete require.cache[require.resolve('../src/modules/dashboards/coverage.repository')];
    const fresh = require('../src/modules/dashboards/coverage.repository');
    const out = await fresh.coverageFacts(TENANT, { period: { from: '2026-01', to: '2026-09' }, officeId: OFFICE });
    assert.equal(out.refMonth, '2026-09');
    assert.deepEqual(rbmArgs, { tenantId: TENANT, opts: { month: '2026-09', asOf: '2026-09' } });
    const main = sqls.find((s) => /GROUPING SETS/.test(s.sql));
    assert.ok(main, 'requête regroupée');
    assert.equal(main.params[0], TENANT);
    assert.match(main.sql, /GROUPING SETS \(\(\), \(akey\), \(office\), \(dkey\)\)/);
    assert.match(main.sql, /per_site AS MATERIALIZED/, 'service unique des faits');
    assert.match(main.sql, /realised_any/);
    assert.match(main.sql, /WITH RECURSIVE office_tree/, 'bureau et ses antennes');
    assert.ok(main.params.some((p) => Array.isArray(p) && p.length === 1 && p[0] === 'a'), 'seuls les sites « à suivre » sont transmis');
    assert.ok(main.params.includes('2026-09-01'), 'mois de référence');
    for (const s of sqls) assert.doesNotMatch(s.sql, /tenant_id = \$2/);
  } finally {
    db.withTenantTransaction = realTx;
    field.rbmSitesTx = realRbm;
    delete require.cache[require.resolve('../src/modules/dashboards/coverage.repository')];
    repo.coverageFacts = realFacts;
  }
});

/**
 * Dépôt rechargé sur un faux client (SQL capté) et un état RBM simulé — `rbm` compte les lectures RBM.
 * @returns {Promise<{ sqls: {sql:string, params:any[]}[], rbmCalls: number }>}
 */
async function captureFacts(opts) {
  const db = require('../src/config/db');
  const field = require('../src/modules/tpm/field.repository');
  const sqls = [];
  const realTx = db.withTenantTransaction; const realRbm = field.rbmSitesTx;
  let rbmCalls = 0;
  db.withTenantTransaction = async (tenantId, fn) => fn({ query: async (sql, params) => { sqls.push({ sql: String(sql), params }); return { rows: [] }; } });
  field.rbmSitesTx = async () => { rbmCalls += 1; return [{ id: 'a', due: true }]; };
  try {
    delete require.cache[require.resolve('../src/modules/dashboards/coverage.repository')];
    await require('../src/modules/dashboards/coverage.repository').coverageFacts(TENANT, opts);
    return { sqls, rbmCalls };
  } finally {
    db.withTenantTransaction = realTx; field.rbmSitesTx = realRbm;
    delete require.cache[require.resolve('../src/modules/dashboards/coverage.repository')];
  }
}

test('dépôt : « Sans bureau » (unlinked) — chaque référence à office_tree a sa définition ; soumissions de commune sans bureau', async () => {
  for (const officeId of ['unlinked', OFFICE, null]) {
    const { sqls } = await captureFacts({ period: { from: '2026-01', to: '2026-09' }, officeId });
    for (const { sql } of sqls) {
      const refs = (sql.match(/(?:FROM|JOIN) office_tree\b/g) || []).length;
      if (refs) assert.match(sql, /\boffice_tree AS \(/, `${officeId} : office_tree cité ${refs} fois sans définition (42P01)`);
    }
    const main = sqls.find((s) => /GROUPING SETS/.test(s.sql)).sql;
    const cdat = main.slice(main.indexOf('cdat AS MATERIALIZED'), main.indexOf('pcs AS MATERIALIZED'));
    if (officeId === 'unlinked') {
      assert.match(cdat, /ms\.field_office_id IS NULL/, 'données de commune sans bureau');
      assert.doesNotMatch(main, /office_tree/, 'aucun sous-arbre de bureau');
      assert.match(main, /s\.field_office_id IS NULL/, 'sites sans bureau');
    } else if (officeId) {
      assert.match(cdat, /ms\.field_office_id IN \(SELECT id FROM office_tree\)/);
    } else {
      assert.doesNotMatch(cdat, /field_office_id/, 'tous les bureaux');
    }
  }
});

test('dépôt : rbm: false — l\'état RBM n\'est pas lu, aucun site « à suivre » transmis ; par défaut il l\'est', async () => {
  const off = await captureFacts({ period: { from: '2026-09', to: '2026-09' }, rbm: false });
  assert.equal(off.rbmCalls, 0);
  const main = off.sqls.find((s) => /GROUPING SETS/.test(s.sql));
  assert.ok(main.params.some((p) => Array.isArray(p) && p.length === 0), 'liste « à suivre » vide');
  const on = await captureFacts({ period: { from: '2026-09', to: '2026-09' } });
  assert.equal(on.rbmCalls, 1);
});
