/**
 * insertDistributions sans base : un faux client enregistre les requêtes.
 * Le verrou consultatif de transaction vient AVANT l'effacement des mois :
 * deux imports simultanés du même compte passent l'un après l'autre (sinon
 * chacun vide le mois avant que l'autre n'insère, et les lignes s'additionnent
 * — vérifié sur PostgreSQL : 3 imports parallèles de 300 lignes → 900 sans
 * verrou, 300 avec).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const calls = [];
db.withTenantTransaction = async (tenantId, fn) => fn({
  query: async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: /RETURNING id/.test(sql) ? params.slice(3).filter((_, i) => i % 16 === 0).map((_, i) => ({ id: `d${i}` })) : [] };
  },
});
const repo = require('../src/modules/pdd/pdd.repository'); // après le remplacement (déstructuré au chargement)

test('insertDistributions : verrou consultatif du compte, puis effacement des mois, puis insertions', async () => {
  const T = '11111111-1111-1111-1111-111111111111';
  const rows = [
    { periodMonth: '2025-10-01', activity: 'GD', commune: 'Ebelo', modality: 'Inkind', beneficiaries: 10, items: { Riz: 1.5 } },
    { periodMonth: '2025-11-01', activity: 'GD', commune: 'Ifotaka', modality: 'CBT', cashUsd: 300, items: {} },
  ];
  const res = await repo.insertDistributions(T, 'u1', rows, { source: 'xlsx', replaceMonths: true });
  assert.deepEqual(res, { inserted: 2, items: 1 });
  assert.equal(calls[0].sql, "SELECT pg_advisory_xact_lock(hashtext($1::text || ':pdd-import'))");
  assert.deepEqual(calls[0].params, [T]);
  assert.match(calls[1].sql, /^DELETE FROM pdd_distributions WHERE tenant_id = \$1 AND period_month = ANY/);
  assert.deepEqual(calls[1].params, [T, ['2025-10-01', '2025-11-01']]);
  assert.match(calls[2].sql, /^INSERT INTO pdd_distributions/);
  assert.match(calls[3].sql, /^INSERT INTO pdd_distribution_items/);
});
