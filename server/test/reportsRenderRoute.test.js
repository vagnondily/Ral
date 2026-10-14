/**
 * Rendu progressif du concepteur (lot 7a, C2) de bout en bout SANS base : dépôts et
 * sources sont des espions. On vérifie : le plan (instances, figures, Server-Timing),
 * le rendu par blocs (8 au plus, identifiant inconnu → 400), l'erreur d'UN bloc qui
 * n'empêche pas les autres, un délai SQL dépassé (57014) devenu l'erreur du bloc, le
 * sémaphore des calculs lourds et le délai par requête posé sur toute transaction.
 */
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'secret-de-test-du-rendu-progressif-0123456789abcdef';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const reportsRepo = require('../src/modules/reports/reports.repository');
const monitoringRepo = require('../src/modules/monitoring/monitoring.repository');
const fieldRepo = require('../src/modules/tpm/field.repository');
const routes = require('../src/modules/reports/reports.routes');
const { errorHandler } = require('../src/middleware/errors');
const { createSemaphore } = require('../src/modules/reports/semaphore');

const TENANT = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-4222-8222-222222222222';
reportsRepo.listOffices = async () => [{ id: '33333333-3333-4333-8333-333333333333', name: 'Bureau Sud', parentId: null, active: true }];
reportsRepo.repeatCandidates = async (t, over) => (over === 'activity' ? [{ id: FORM, label: 'SMP', activityCategory: null, n: 3 }] : []);
let fieldFails = null;
monitoringRepo.reportMonitoringData = async () => ({
  submissions: 3, regions: [{ region: 'Androy', submissions: 3, communes: 1 }],
  forms: [{ id: FORM, label: 'SMP', sitesActive: null, visits: 3, sitesVisited: 2, index: 70, monthly: [], dims: [], indicators: [], bureaux: [] }],
});
fieldRepo.reportFieldData = async () => {
  if (fieldFails) throw fieldFails;
  return { byOffice: [{ bureau: 'Bureau Sud', sitesActive: 4, planned: 2, done: 1 }], monthly: [{ month: '2026-01', planned: 2, done: 1 }] };
};

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.log = { info() {}, error() {} }; next(); });
app.use('/api/report-designer', routes);
app.use(errorHandler);
const viewer = jwt.sign({ sub: 'u2', tenantId: TENANT, role: 'viewer' }, process.env.JWT_SECRET);
const post = (url, body) => request(app).post(url).set({ Authorization: `Bearer ${viewer}` }).send(body);

const DOC = {
  schemaVersion: 2, title: 'Rapport', period: { from: '2026-01', to: '2026-03' },
  blocks: [
    { id: 'h', type: 'heading', params: { text: 'Bilan {periode}', level: 1 } },
    { id: 'reg', type: 'data', params: { dataset: 'mon.by_region', view: 'table' } },
    { id: 'bur', type: 'data', params: { dataset: 'cov.by_office', view: 'bar' } },
    { id: 'rep', type: 'repeat', params: { over: 'activity', blocks: [{ id: 'rk', type: 'kpis', params: { metrics: ['submissions'] } }] } },
  ],
};

test('plan : instances, figures numérotées, éléments répétés, Server-Timing — sans calcul lourd', async () => {
  let calls = 0;
  const orig = monitoringRepo.reportMonitoringData;
  monitoringRepo.reportMonitoringData = async (...a) => { calls += 1; return orig(...a); };
  const r = await post('/api/report-designer/render/plan', { doc: DOC });
  monitoringRepo.reportMonitoringData = orig;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.headers['server-timing'], /^plan;dur=\d+/);
  assert.equal(calls, 0, 'le plan ne calcule aucune donnée');
  const iids = r.body.instances.map((i) => i.iid);
  assert.deepEqual(iids, ['h', 'reg', 'bur', 'rep', `rep~${FORM}~rk`]);
  assert.deepEqual(r.body.instances.find((i) => i.iid === 'reg').figure, { kind: 'table', n: 1 });
  assert.deepEqual(r.body.instances.find((i) => i.iid === 'bur').figure, { kind: 'figure', n: 1 });
  assert.equal(r.body.instances.find((i) => i.iid === 'h').text, 'Bilan Janvier à mars 2026');
  assert.deepEqual(r.body.expansions.rep.map((x) => x.label), ['SMP']);
});

test('blocs : l\'erreur d\'un bloc (délai SQL dépassé) n\'empêche pas les autres ; Server-Timing par bloc', async () => {
  fieldFails = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  const r = await post('/api/report-designer/render/blocks?lang=en', { doc: DOC, iids: ['reg', 'bur', `rep~${FORM}~rk`] });
  fieldFails = null;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.blocks.reg.ok, true);
  assert.deepEqual(r.body.blocks.reg.data.rows, [{ region: 'Androy', submissions: 3, communes: 1 }]);
  assert.equal(r.body.blocks.bur.ok, false);
  assert.equal(r.body.blocks.bur.error.code, 'timeout');
  assert.match(r.body.blocks.bur.error.message, /too long/);
  assert.equal(r.body.blocks[`rep~${FORM}~rk`].ok, true);
  assert.deepEqual(r.body.blocks[`rep~${FORM}~rk`].data.values, { submissions: 3 });
  assert.match(r.headers['server-timing'], /plan;dur=\d+, blk0;dur=\d+;desc="reg", blk1;dur=\d+;desc="bur \(erreur\)"/);
});

test('blocs : 8 au plus par appel, identifiant inconnu → 400 (plan à recharger)', async () => {
  const many = await post('/api/report-designer/render/blocks', { doc: DOC, iids: Array.from({ length: 9 }, () => 'reg') });
  assert.equal(many.status, 400);
  assert.equal(many.body.details.code, 'bad_iids');
  const unknown = await post('/api/report-designer/render/blocks', { doc: DOC, iids: ['reg', 'nope'] });
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body.details, { code: 'unknown_iid', iids: ['nope'] });
  const invalid = await post('/api/report-designer/render/plan', { doc: { ...DOC, blocks: [{ id: 'x', type: 'data', params: { dataset: 'mon.inconnu' } }] } });
  assert.equal(invalid.status, 400);
  assert.match(JSON.stringify(invalid.body.details), /Jeu de données inconnu/);
});

test('57014 hors du rendu par blocs : 503 « Calcul trop long », jamais une erreur interne', async () => {
  fieldFails = Object.assign(new Error('timeout'), { code: '57014' });
  const r = await request(app).post('/api/report-designer/export.xlsx').set({ Authorization: `Bearer ${viewer}` }).send(DOC);
  fieldFails = null;
  // L'export calcule chaque bloc sous garde : le bloc en erreur est omis, le classeur est produit.
  assert.equal(r.status, 200);
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  errorHandler(Object.assign(new Error('x'), { code: '57014' }), { log: { error() {} } }, res, () => {});
  assert.equal(res.code, 503);
  assert.match(res.body.error, /Calcul trop long/);
});

test('sémaphore : au plus N calculs, file d\'attente, délai d\'attente → queue_timeout', async () => {
  let fire = null;
  const sem = createSemaphore(2, { setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  const r1 = await sem.acquire(); const r2 = await sem.acquire();
  assert.equal(sem.active, 2);
  let third = null;
  const p3 = sem.acquire(20000).then((r) => { third = r; });
  assert.equal(sem.waiting, 1);
  r1();
  await p3;
  assert.equal(typeof third, 'function');
  assert.equal(sem.active, 2);
  const p4 = sem.acquire(20000);
  fire(); // délai écoulé
  await assert.rejects(p4, (e) => e.code === 'queue_timeout');
  r2(); r2(); // libérer deux fois ne compte qu'une fois
  third();
  assert.equal(sem.active, 0);
});

test('délai par requête : toute transaction ouverte dans withQueryTimeout reçoit SET LOCAL statement_timeout', async () => {
  const seen = [];
  const origConnect = db.pool.connect;
  db.pool.connect = async () => ({ query: async (sql) => { seen.push(String(sql)); return { rows: [] }; }, release() {} });
  try {
    await db.withQueryTimeout('15s', () => db.withTenantTransaction(TENANT, (c) => c.query('SELECT 1')));
    await db.withTenantTransaction(TENANT, (c) => c.query('SELECT 2'));
  } finally { db.pool.connect = origConnect; }
  const i = seen.indexOf("SET LOCAL statement_timeout = '15s'");
  assert.ok(i > 0 && seen[i - 1] === 'BEGIN', seen.join(' | '));
  assert.equal(seen.filter((q) => q.startsWith('SET LOCAL statement_timeout')).length, 1, 'hors du contexte : aucun délai posé');
  assert.throws(() => db.withQueryTimeout("15s'; DROP TABLE x; --", () => {}), /Délai invalide/);
});
