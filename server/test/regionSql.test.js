/**
 * Régions des soumissions (lot 1b, préalable de performance) SANS base : un faux
 * client capte le SQL de coverageDashboard et de reportMonitoringData. La requête
 * agrège d'abord par clés distinctes (WITH g AS MATERIALIZED) puis résout chaque
 * clé par un index — jamais un CTE de tout le découpage (DISTINCT ON (pcode))
 * joint à chaque soumission (boucle imbriquée de 6 s sous RLS).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const T = '11111111-1111-1111-1111-111111111111';
let calls = [];
db.withTenantTransaction = async (_tenantId, fn) => fn({
  query: async (sql, params = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/count\(\*\)::int AS submissions/.test(sql) && !/GROUP BY/.test(sql)) return { rows: [{ submissions: 0, sites: 0, agents: 0, partners: 0, communes: 0 }] };
    return { rows: [] };
  },
});
const repo = require('../src/modules/monitoring/monitoring.repository');

const regionCalls = () => calls.filter((c) => /AS region/.test(c.sql));

for (const [name, run] of [
  ['coverageDashboard', () => repo.coverageDashboard(T, { from: '2026-01', to: '2026-06' })],
  ['reportMonitoringData', () => repo.reportMonitoringData(T, { from: '2026-01', to: '2026-06' })],
]) {
  test(`${name} : régions agrégées d'abord, puis résolues clé par clé`, async () => {
    calls = [];
    await run();
    const rc = regionCalls();
    assert.equal(rc.length, 1, 'une seule requête des régions');
    const { sql, params } = rc[0];
    assert.match(sql, /^WITH g AS MATERIALIZED \( SELECT COALESCE\(s\.adm3_pcode, s\.admin3\) AS pc, upper\(btrim\(s\.admin1\)\) AS a1/);
    assert.match(sql, /k AS MATERIALIZED \(SELECT pc AS key FROM g WHERE pc IS NOT NULL UNION SELECT a1 FROM g WHERE a1 IS NOT NULL\)/);
    // Lectures par clé (index) : découpage (lignée), région de niveau 1, registre de sites.
    assert.match(sql, /c\.pcode = k\.key AND cardinality\(c\.lineage\) >= 1 LIMIT 1/);
    assert.match(sql, /r\.depth = 1 AND r\.pcode = k\.key LIMIT 1/);
    assert.match(sql, /st\.adm3_pcode = k\.key AND NULLIF\(st\.adm1, ''\) IS NOT NULL ORDER BY st\.adm1 LIMIT 1/);
    // Même chaîne de repli qu'avant : zone, région de niveau 1, valeur brute, « (non renseigné) ».
    assert.match(sql, /COALESCE\(p3\.region, p1\.region, g\.raw1, '\(non renseigné\)'\) AS region/);
    assert.match(sql, /sum\(g\.n\)::int AS submissions, count\(DISTINCT g\.commune\)::int AS communes/);
    assert.match(sql, /ORDER BY submissions DESC, 1$/);
    assert.doesNotMatch(sql, /DISTINCT ON \(pcode\)/);
    // tenant_id dans chaque lecture, et la période (exclues écartées) sur les soumissions.
    assert.equal((sql.match(/tenant_id = \$1/g) || []).length, 4);
    // Borne semi-ouverte (lot 1b) : une date du 15 n'est jamais perdue.
    assert.match(sql, /WHERE s\.tenant_id = \$1 AND NOT s\.excluded AND s\.period_month >= \$2::date AND s\.period_month < \$3::date/);
    assert.deepEqual(params, [T, '2026-01-01', '2026-07-01']);
  });
}

test('regionRowsSql : le filtre est injecté tel quel après le tenant', () => {
  const sql = repo.regionRowsSql(' AND NOT s.excluded');
  assert.match(sql, /WHERE s\.tenant_id = \$1 AND NOT s\.excluded\s+GROUP BY 1, 2, 3, 4\)/);
});
