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
let rowCount = 0;
db.withTenantTransaction = async (_tenantId, fn) => fn({
  query: async (sql, params = []) => {
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight -= 1;
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return { rows: [], rowCount };
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
  // Données rattachées AU SITE : soumissions de la période d'abord (matérialisées), puis le registre.
  assert.match(facts.sql, /datraw AS MATERIALIZED \( SELECT ms\.site_id, ms\.form_id, date_trunc\('month', ms\.period_month\)::date AS m FROM monitoring_submissions ms WHERE ms\.tenant_id = \$1 AND NOT ms\.excluded AND ms\.site_id IS NOT NULL/);
  assert.match(facts.sql, /dat AS \( SELECT x\.site_id, x\.m FROM datraw x JOIN monitoring_forms mf ON mf\.id = x\.form_id AND mf\.tenant_id = \$1 JOIN sites s ON s\.id = x\.site_id AND s\.tenant_id = \$1 WHERE x\.site_id IN \(SELECT site_id FROM reg\)/);
  assert.match(facts.sql, /bool_or\(active AND \(st = 'realise' OR wd\)\)/);
  // Une donnée de commune n'est qu'une indication (communeDataOnly), jamais une réalisation.
  assert.match(facts.sql, /cdat AS MATERIALIZED \(.* ms\.site_id IS NULL .*\)/);
  const dat = facts.sql.slice(facts.sql.indexOf('datraw AS'), facts.sql.indexOf('fact AS MATERIALIZED'));
  assert.doesNotMatch(dat, /adm3_pcode|commune/, 'les données qui réalisent sont celles DU site');
  assert.match(facts.sql, /COALESCE\(bool_or\(active AND \(st = 'realise' OR wd\)\), false\) AS realised_any/);
  // per_site : faits creux (visites et données réunies par FULL JOIN), jamais la grille complète site × mois.
  assert.match(facts.sql, /FROM vis v FULL JOIN dat d ON d\.site_id = v\.site_id AND d\.m = v\.m/);
  assert.match(facts.sql, /sf AS MATERIALIZED \(/);
  const perSite = facts.sql.slice(facts.sql.indexOf('per_site AS ('));
  assert.doesNotMatch(perSite.slice(0, perSite.indexOf('ever AS')), /FROM fact\b/, 'per_site ne lit pas fact');
  assert.match(perSite, /FROM reg r FULL JOIN \(SELECT site_id,/, 'jointure hachée ou fusionnée, jamais une boucle');
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

test('points : précision maximale en paramètre, médianes sur tout l\'historique, collecte bornée à la période, LIMIT', async () => {
  calls = []; maxInFlight = 0;
  await repo.pointsData(T, { period: { from: '2026-01', to: '2026-03' }, layers: ['gps', 'derived', 'communes', 'collect'], limit: 2000, precise: true, maxAccuracyM: 100 });
  assert.equal(calls[0].sql, 'SET LOCAL jit = off');
  assert.equal(maxInFlight, 1);
  const medians = calls.filter((c) => /percentile_cont\(0\.5\)/.test(c.sql));
  assert.equal(medians.length, 2, 'par site et par commune');
  for (const m of medians) {
    assert.match(m.sql, /COALESCE\(ms\.gps_accuracy_m, 0\) <= \$2/);
    assert.doesNotMatch(m.sql, /period_month/, 'une position est une propriété du lieu : tout l\'historique');
    assert.deepEqual(m.params, [T, 100]);
  }
  const stats = calls.find((c) => /AS "lastMonth"/.test(c.sql));
  assert.match(stats.sql, /ms\.period_month >= \$2::date AND ms\.period_month < \$3::date/);
  assert.deepEqual(stats.params.slice(0, 4), [T, '2026-01-01', '2026-04-01', 100]);
  // Rôle précis, total ≤ limit : points les plus récents, plafonnés ; sinon carroyage de 2 km.
  const pts = calls.find((c) => /ORDER BY ms\.period_month DESC, ms\.id LIMIT \$\d+/.test(c.sql));
  assert.ok(pts);
  assert.equal(pts.params[pts.params.length - 1], 2000);
  assert.ok(!calls.find((c) => /round\(ms\.gps_lat \/ 0\.02\)/.test(c.sql)));
  calls = [];
  await repo.pointsData(T, { period: { from: '2026-01', to: '2026-03' }, layers: ['collect'], limit: 2000, precise: false, maxAccuracyM: 100 });
  assert.ok(calls.find((c) => /round\(round\(ms\.gps_lat \/ 0\.02\) \* 0\.02, 2\)/.test(c.sql)), 'lecteur : carroyage');
  assert.ok(!calls.find((c) => /ORDER BY ms\.period_month DESC, ms\.id LIMIT/.test(c.sql)), 'lecteur : jamais de point précis');
  assert.ok(!calls.find((c) => /percentile_cont/.test(c.sql)), 'couches non demandées : non lues');
  calls = [];
  await repo.pointsData(T, { period: { from: '2026-01', to: '2026-03' }, layers: ['gps', 'derived', 'communes', 'collect'], limit: 2000, precise: true, maxAccuracyM: 100 });
  const statuses = calls.find((c) => /AS status/.test(c.sql));
  assert.match(statuses.sql, /CASE WHEN NOT p\.active THEN 'inactif' WHEN p\.realised_any AND p\.planned THEN 'realise' WHEN p\.realised_any THEN 'hors_plan' WHEN p\.planned THEN 'prevu' ELSE 'non_prevu' END AS status/);
  assert.match(statuses.sql, /LIMIT \$\d+$/);
  assert.equal(statuses.params[statuses.params.length - 1], repo.SITES_CAP + 1);
  // Faits calculés pour les seuls sites dessinables (GPS du registre ou candidats), jamais tout le registre.
  assert.match(statuses.sql, /AND \(\(s\.gps_lat IS NOT NULL AND s\.gps_lng IS NOT NULL\) OR s\.id = ANY\(\$\d+::uuid\[\]\)\)\)/);
  assert.ok(calls.findIndex((c) => /percentile_cont/.test(c.sql)) < calls.indexOf(statuses), 'médianes d\'abord : les candidats sont connus');
  // Comptes du périmètre COMPLET : registre seul, sans LIMIT, tenant $1.
  const totals = calls.find((c) => /AS perimeter/.test(c.sql));
  assert.ok(totals);
  assert.doesNotMatch(totals.sql, /LIMIT/);
  assert.match(totals.sql, /FROM sites s WHERE s\.tenant_id = \$1/);
});

test('points : comptes du périmètre filtrés comme les faits (bureau + antennes, activité) ; sites sans position par commune', async () => {
  const fake = { query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params });
    if (/AS perimeter/.test(s)) return { rows: [{ perimeter: 10, gps: 2 }] };
    return { rows: [] };
  } };
  calls = [];
  const out = await repo.perimeterCountsTx(fake, T, { officeId: OFFICE, activity: 'School meal', candidateIds: ['c1'], communeKeys: ['MG1'] });
  assert.deepEqual(out.totals, { perimeter: 10, gps: 2 });
  const [tot, com] = calls;
  for (const c of [tot, com]) {
    assert.match(c.sql, /^WITH RECURSIVE office_tree AS/);
    assert.match(c.sql, /s\.field_office_id IN \(SELECT id FROM office_tree\)/);
    assert.match(c.sql, /lower\(btrim\(s\.activity\)\) = lower\(btrim\(\$\d+::text\)\)/);
    assert.equal(c.params[0], T);
  }
  assert.match(com.sql, /NOT \(s\.id = ANY\(\$\d+::uuid\[\]\)\)/, 'candidats exclus (rendus un par un)');
  assert.match(com.sql, /GROUP BY 1$/);
  assert.deepEqual(com.params.slice(-2), [['MG1'], ['c1']]);
});

test('corrections de contour : district du compte vérifié, upsert ON CONFLICT, updated_by ; centres : valeurs vides seulement', async () => {
  calls = [];
  await repo.upsertShapeLink(T, 'u1', 'MG52516a', 'bekily');
  assert.match(calls[0].sql, /FROM admin_areas WHERE tenant_id = \$1 AND depth = 2 AND pcode = \$2/);
  // Le faux client ne trouve aucun district : rien n'est écrit (404 côté service).
  assert.equal(calls.length, 1);
  rowCount = 1; // le district existe
  calls = [];
  assert.equal(await repo.upsertShapeLink(T, 'u1', 'MG52516a', null), true);
  assert.match(calls[1].sql, /INSERT INTO map_shape_links \(tenant_id, shape_set, area_pcode, shape_key, updated_by, updated_at\) VALUES \(\$1, \$2, \$3, \$4, \$5, now\(\)\) ON CONFLICT \(tenant_id, shape_set, area_pcode\) DO UPDATE SET shape_key = EXCLUDED\.shape_key, updated_by = EXCLUDED\.updated_by/);
  assert.deepEqual(calls[1].params, [T, 'mdg-adm2.v1', 'MG52516a', null, 'u1']);
  calls = [];
  await repo.deleteShapeLink(T, 'MG52516a');
  assert.match(calls[1].sql, /^DELETE FROM map_shape_links WHERE tenant_id = \$1 AND shape_set = \$2 AND area_pcode = \$3$/);
  calls = [];
  await repo.fillDistrictCentres(T, [{ pcode: 'MG1', lat: -24.1, lng: 45.3 }]);
  assert.match(calls[0].sql, /a\.tenant_id = \$1 AND a\.depth = 2 AND a\.pcode = v\.pcode AND a\.lat IS NULL AND a\.lng IS NULL/);
  assert.deepEqual(calls[0].params, [T, ['MG1'], [-24.1], [45.3]]);
  rowCount = 0;
});

test('recherche : métacaractères de LIKE échappés, une requête par profondeur (index), tenant $1', async () => {
  calls = [];
  assert.equal(repo.likeEscape('50%_a\\b'), '50\\%\\_a\\\\b');
  await repo.search(T, '50%_x');
  const areas = calls.filter((c) => /FROM admin_areas a/.test(c.sql));
  assert.deepEqual(areas.map((c) => c.params[1]), [2, 3]);
  for (const c of areas) {
    assert.match(c.sql, /a\.tenant_id = \$1 AND a\.depth = \$2 AND \(lower\(a\.name\) LIKE \$3 ESCAPE '\\'/); // un seul caractère d'échappement
    assert.equal(c.params[2], '50\\%\\_x%');
  }
  const sites = calls.find((c) => /FROM sites s/.test(c.sql));
  assert.match(sites.sql, /s\.tenant_id = \$1/);
  assert.equal(sites.params[0], T);
});
