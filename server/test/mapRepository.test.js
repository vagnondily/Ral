/**
 * Dépôt de la carte SANS base : un faux client capte le SQL (modèle pddRepository).
 * SET LOCAL jit = off en premier ordre ; $1 = tenant et tenant_id = $1 sur chaque
 * table ; requêtes l'une après l'autre ; sous-arbre de bureaux récursif ;
 * « réalisée » sans repli sur la commune ; faits venant du service unique.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const T = '11111111-1111-1111-1111-111111111111';
const OFFICE = '22222222-2222-2222-2222-222222222222';
let calls = [];
let inFlight = 0;
let maxInFlight = 0;
db.withTenantTransaction = async (_tenantId, fn) => fn({
  query: async (sql, params = []) => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight -= 1;
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: [] };
  },
});
const repo = require('../src/modules/map/map.repository');

/** Tables lues par une requête, avec leur alias (FROM / JOIN). */
const tablesOf = (sql) => [...sql.matchAll(/(?:FROM|JOIN) (sites|site_visits|site_month_status|monitoring_submissions|monitoring_forms|admin_areas|field_offices|map_shape_links)(?: (\w+))?/g)]
  .map((m) => ({ table: m[1], alias: m[2] && !/^(WHERE|ON|LEFT|JOIN|GROUP|ORDER|CROSS)$/.test(m[2]) ? m[2] : null }));

test('districtData : jit off en premier, requêtes séquentielles, tenant $1 partout', async () => {
  calls = []; maxInFlight = 0;
  await repo.districtData(T, { period: { from: '2026-01', to: '2026-10' } });
  assert.equal(calls[0].sql, 'SET LOCAL jit = off');
  assert.equal(maxInFlight, 1, 'jamais deux requêtes en même temps sur le client');
  for (const c of calls.slice(1)) {
    assert.equal(c.params[0], T, `$1 = tenant : ${c.sql.slice(0, 80)}`);
    for (const { table, alias } of tablesOf(c.sql)) {
      const col = alias ? `${alias}.tenant_id` : 'tenant_id';
      assert.ok(c.sql.includes(`${col} = $1`) || c.sql.includes(`${col} = s.tenant_id`) || c.sql.includes(`${col} = ms.tenant_id`) || c.sql.includes(`${col} = c.tenant_id`),
        `${table} ${alias || ''} filtré par tenant dans : ${c.sql.slice(0, 120)}…`);
    }
  }
});

test('faits par zone : service unique (withData + geo), réalisée = données AU SITE ou déclarée, jamais par la commune', async () => {
  calls = [];
  await repo.districtData(T, { period: { from: '2026-09', to: '2026-09' } });
  const facts = calls.find((c) => /per_site AS/.test(c.sql));
  assert.ok(facts);
  assert.match(facts.sql, /dat AS \( SELECT ms\.site_id, date_trunc\('month', ms\.period_month\)::date AS m FROM monitoring_submissions ms JOIN monitoring_forms mf ON mf\.id = ms\.form_id AND mf\.tenant_id = ms\.tenant_id JOIN reg r ON r\.site_id = ms\.site_id WHERE ms\.tenant_id = \$1 AND NOT ms\.excluded AND ms\.site_id IS NOT NULL/);
  assert.match(facts.sql, /bool_or\(active AND \(st = 'realise' OR wd\)\)/);
  // Une donnée de commune n'est qu'une indication (communeDataOnly), jamais une réalisation.
  assert.match(facts.sql, /cdat AS MATERIALIZED \(.* ms\.site_id IS NULL .*\)/);
  const dat = facts.sql.slice(facts.sql.indexOf('dat AS ('), facts.sql.indexOf('fact AS MATERIALIZED'));
  assert.doesNotMatch(dat, /adm3_pcode|commune/, 'les données qui réalisent sont celles DU site');
  assert.match(facts.sql, /COALESCE\(bool_or\(active AND \(st = 'realise' OR wd\)\), false\) AS realised_any/);
  assert.match(facts.sql, /d\.site_id IS NOT NULL AS wd FROM act a LEFT JOIN vis v ON v\.site_id = a\.site_id AND v\.m = a\.m LEFT JOIN dat d ON d\.site_id = a\.site_id AND d\.m = a\.m/);
  assert.match(facts.sql, /GROUP BY GROUPING SETS \(\(did, rid\), \(rid\), \(office_id\), \(activity\), \(cpcode\), \(\)\)/);
  // Bornes semi-ouvertes de la période.
  assert.deepEqual(facts.params.slice(1, 4), ['2026-09-01', '2026-09-01', '2026-10-01']);
});

test('filtre bureau : sous-arbre RÉCURSIF (bureau + antennes) sur les sites et les soumissions ; filtre activité', async () => {
  calls = [];
  await repo.districtData(T, { period: { from: '2026-01', to: '2026-03' }, officeId: OFFICE, activity: 'School meal activities' });
  const facts = calls.find((c) => /per_site AS/.test(c.sql));
  assert.match(facts.sql, /^WITH RECURSIVE office_tree AS \( SELECT id FROM field_offices WHERE tenant_id = \$1 AND id = \$\d+::uuid UNION SELECT f\.id FROM field_offices f JOIN office_tree o ON f\.parent_id = o\.id WHERE f\.tenant_id = \$1\)/);
  assert.match(facts.sql, /AND s\.field_office_id IN \(SELECT id FROM office_tree\)/);
  assert.match(facts.sql, /AND lower\(btrim\(s\.activity\)\) = lower\(btrim\(\$\d+::text\)\)/);
  assert.ok(facts.params.includes(OFFICE));
  assert.ok(facts.params.includes('School meal activities'));
  const subs = calls.find((c) => /submissionsSite/.test(c.sql));
  assert.match(subs.sql, /^WITH RECURSIVE office_tree AS/);
  assert.match(subs.sql, /COALESCE\(sk\.fo, g\.fo\) IN \(SELECT id FROM office_tree\)/);
  // Soumission rattachée : site de l'activité + fiche compatible ; non rattachée : fiche de l'activité ou sans catégorie.
  assert.match(subs.sql, /CASE WHEN g\.site_id IS NOT NULL THEN sk\.act = lower\(btrim\(\$\d+::text\)\) AND \(g\.cat IS NULL OR g\.cat = sk\.act\) ELSE \(g\.cat IS NULL OR g\.cat = lower\(btrim\(\$\d+::text\)\)\) END/);
});

test('soumissions : résolues par clés distinctes (une sonde par commune), district du site sinon de la commune', async () => {
  calls = [];
  await repo.districtData(T, { period: { from: '2026-09', to: '2026-09' } });
  const subs = calls.find((c) => /submissionsSite/.test(c.sql));
  assert.match(subs.sql, /g AS MATERIALIZED \(/);
  assert.match(subs.sql, /FROM \(SELECT DISTINCT pc FROM g WHERE pc IS NOT NULL\) k LEFT JOIN LATERAL/);
  assert.match(subs.sql, /COALESCE\(sk\.did, ck\.did\) AS did/);
  const regions = calls.find((c) => /FROM admin_areas d LEFT JOIN admin_areas r ON r\.id = d\.parent_id AND r\.tenant_id = \$1/.test(c.sql));
  assert.ok(regions, 'jointure des régions filtrée par tenant');
});
