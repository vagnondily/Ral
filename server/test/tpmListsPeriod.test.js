/**
 * Rapports TPM et plans de collecte sur une période (lot 1b) — SANS base : un faux
 * client enregistre les requêtes. Un rapport est retenu si [period_month,
 * COALESCE(period_end, period_month)] CHEVAUCHE la période (facture pluri-mensuelle) ;
 * un plan, si son mois tombe dans la période (intervalle semi-ouvert).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const calls = [];
db.withTenantTransaction = async (tenantId, fn) => fn({
  query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [] }; },
});
const reports = require('../src/modules/tpm/reports.repository');
const planning = require('../src/modules/tpm/planning.repository');
const { overlaps } = require('../src/modules/common/period');

const T = '11111111-1111-1111-1111-111111111111';

test('rapports : chevauchement de [period_month, period_end] avec la période', async () => {
  calls.length = 0;
  await reports.listReports(T, { period: { from: '2026-02', to: '2026-06' }, partnerId: 'p' });
  const { sql, params } = calls[0];
  assert.match(sql, /WHERE r\.tenant_id = \$1 AND r\.period_month < \$2::date AND COALESCE\(r\.period_end, r\.period_month\) >= \$3::date AND r\.partner_id = \$4 /);
  assert.deepEqual(params, [T, '2026-07-01', '2026-02-01', 'p']);
  // Jumeau pur : une facture janvier–mars chevauche février–juin ; une facture de janvier, non.
  assert.equal(overlaps({ from: '2026-02', to: '2026-06' }, '2026-01-01', '2026-03-01'), true);
  assert.equal(overlaps({ from: '2026-02', to: '2026-06' }, '2026-01-01', null), false);
});

test('rapports : l\'ancien { month } reste lu, sans période tous les rapports (Centre d\'alertes)', async () => {
  calls.length = 0;
  await reports.listReports(T, { month: '2026-03' });
  assert.deepEqual(calls[0].params, [T, '2026-04-01', '2026-03-01']);
  calls.length = 0;
  await reports.listReports(T, {});
  assert.match(calls[0].sql, /WHERE r\.tenant_id = \$1 ORDER BY/);
  assert.deepEqual(calls[0].params, [T]);
});

test('plans de collecte : mois dans la période (semi-ouvert), contrat filtré', async () => {
  calls.length = 0;
  await planning.listPlans(T, { period: { from: '2026-01', to: '2026-12' }, contractId: 'c' });
  assert.match(calls[0].sql, /WHERE p\.tenant_id = \$1 AND p\.period_month >= \$2::date AND p\.period_month < \$3::date AND p\.contract_id = \$4 /);
  assert.deepEqual(calls[0].params, [T, '2026-01-01', '2027-01-01', 'c']);
  calls.length = 0;
  await planning.listPlans(T, { month: '2026-05' });
  assert.deepEqual(calls[0].params, [T, '2026-05-01', '2026-06-01']);
});
