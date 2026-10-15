/**
 * Dépôt du suivi de processus sur une PLAGE (lot 1b) SANS base : un faux client capte
 * le SQL envoyé. Borne semi-ouverte, comptage des soumissions d'une fiche avec ses
 * propres paramètres, fenêtre des tendances, une seule clé « sites (données) » sur
 * tous les écrans, noms de lieux résolus sur les clés distinctes (pas par ligne).
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const { submissionSiteKey } = require('../src/modules/common/submissionSiteKey');

const T = '11111111-1111-1111-1111-111111111111';
const FORM = '22222222-2222-2222-2222-222222222222';
let calls = [];
let rowsFor = () => [];
db.withTenantTransaction = async (_tenantId, fn) => fn({
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params });
    return { rows: rowsFor(s, params) };
  },
});
const repo = require('../src/modules/monitoring/monitoring.repository');
const H1 = { from: '2026-01', to: '2026-06' };

test('formSubmissions : liste et comptage filtrés sur la plage, chacun avec SES paramètres', async () => {
  calls = [];
  rowsFor = (s) => (/count\(\*\)::int AS total/.test(s) ? [{ total: 42, excluded: 3 }] : []);
  const out = await repo.formSubmissions(T, FORM, { period: H1, limit: 50 });
  const list = calls.find((c) => /ORDER BY ms\.submitted_at DESC/.test(c.sql));
  assert.match(list.sql, /ms\.tenant_id = \$1 AND ms\.form_id = \$2 AND ms\.period_month >= \$3::date AND ms\.period_month < \$4::date/);
  assert.match(list.sql, /LIMIT \$5 OFFSET \$6$/);
  assert.deepEqual(list.params, [T, FORM, '2026-01-01', '2026-07-01', 50, 0]);
  const cnt = calls.find((c) => /count\(\*\)::int AS total/.test(c.sql));
  assert.deepEqual(cnt.params, [T, FORM, '2026-01-01', '2026-07-01']);
  assert.match(cnt.sql, /ms\.period_month >= \$3::date AND ms\.period_month < \$4::date$/);
  assert.equal(out.total, 42);
  assert.deepEqual(out.period, { from: '2026-01', to: '2026-06', months: 6 });
  // Ancien appel { month } : même filtre d'un mois.
  calls = [];
  await repo.formSubmissions(T, FORM, { month: '2026-07' });
  assert.deepEqual(calls.find((c) => /count\(\*\)::int AS total/.test(c.sql)).params, [T, FORM, '2026-07-01', '2026-08-01']);
  // Sans période : aucun paramètre de période.
  calls = [];
  await repo.formSubmissions(T, FORM, { period: null });
  assert.deepEqual(calls.find((c) => /count\(\*\)::int AS total/.test(c.sql)).params, [T, FORM]);
});

test('noms de lieux : une lecture par type de clé distincte, jamais une sous-requête par ligne', async () => {
  calls = [];
  const subs = [
    { id: 1, _districtKey: 'MG0101', _communeKey: 'MG010101', _siteId: 'a0000000-0000-4000-8000-000000000001', _officeId: null },
    { id: 2, _districtKey: 'MG0101', _communeKey: 'MG010199', _siteId: null, _officeId: 'b0000000-0000-4000-8000-000000000001' },
  ];
  rowsFor = (s, p) => {
    if (/ORDER BY ms\.submitted_at DESC/.test(s)) return subs.map((r) => ({ ...r }));
    if (/FROM admin_areas WHERE tenant_id = \$1 AND pcode = ANY/.test(s)) return [{ pcode: 'MG0101', name: 'Ambovombe' }];
    if (/DISTINCT ON \(adm3_pcode\)/.test(s)) return [{ k: 'MG010199', name: 'Commune du registre' }];
    if (/FROM sites WHERE tenant_id = \$1 AND id = ANY/.test(s)) return [{ id: p[1][0], name: 'EPP Ambovombe' }];
    if (/FROM field_offices WHERE tenant_id = \$1 AND id = ANY/.test(s)) return [{ id: p[1][0], name: 'Bureau Sud' }];
    return [];
  };
  const out = await repo.listSubmissions(T, { period: H1 });
  assert.deepEqual(out.map((r) => [r.districtName, r.communeName, r.siteName, r.officeName]), [
    ['Ambovombe', null, 'EPP Ambovombe', null],
    ['Ambovombe', 'Commune du registre', null, 'Bureau Sud'],
  ]);
  assert.ok(out.every((r) => !('_siteId' in r) && !('_districtKey' in r) && !('_regionKey' in r) && !('_fokontanyKey' in r)), 'clés internes retirées');
  assert.ok(!calls.some((c) => /\(SELECT a\.name FROM admin_areas a WHERE a\.tenant_id = ms\.tenant_id/.test(c.sql)), 'aucune sous-requête par ligne');
  const areas = calls.find((c) => /FROM admin_areas WHERE tenant_id = \$1 AND pcode = ANY/.test(c.sql));
  assert.deepEqual(areas.params[1].sort(), ['MG0101', 'MG010101', 'MG010199']);
});

test('données d\'une fiche (retour 80) : pages dans un ordre stable, commune codée lue dans la liste de la fiche (« 89 » → « Tomboarivo »)', async () => {
  calls = [];
  const subs = [
    { id: 'x1', admin1: 'MG53', admin3: '89', fieldOffice: '1', _districtKey: null, _communeKey: '89', _regionKey: 'MG53', _fokontanyKey: null, _siteId: null, _officeId: null },
    { id: 'x2', admin1: 'MG53', admin3: '91', fieldOffice: '1', _districtKey: null, _communeKey: '91', _regionKey: 'MG53', _fokontanyKey: null, _siteId: null, _officeId: null },
  ];
  rowsFor = (s, p) => {
    if (/ORDER BY ms\.submitted_at DESC/.test(s)) return subs.map((r) => ({ ...r }));
    if (/count\(\*\)::int AS total/.test(s)) return [{ total: 1311, excluded: 0 }];
    if (/FROM admin_areas WHERE tenant_id = \$1 AND pcode = ANY/.test(s)) return [{ pcode: 'MG53', name: 'Anosy' }];
    if (/FROM monitoring_form_fields/.test(s)) return [{ formId: FORM, name: 'Adm3Code_SMP', listName: 'ADM3CODE' }, { formId: 'autre', name: 'Adm3Code_SMP', listName: 'ADM3CODE' }];
    if (/FROM monitoring_field_map/.test(s)) return p[1] === 'admin3' ? [{ formId: FORM, columnName: 'Adm3Code_SMP' }] : [];
    if (/FROM monitoring_choices c/.test(s)) {
      return [{ formId: FORM, value: '89', label: 'TOMBOARIVO' }, { formId: FORM, value: '91', label: 'TSIVORY' }].filter((c) => p[3].includes(c.value));
    }
    return [];
  };
  const out = await repo.formSubmissions(T, FORM, { limit: 1000, offset: 1000 });
  const list = calls.find((c) => /ORDER BY ms\.submitted_at DESC/.test(c.sql));
  assert.match(list.sql, /ORDER BY ms\.submitted_at DESC NULLS LAST, ms\.period_month DESC, ms\.id LIMIT \$3 OFFSET \$4$/);
  assert.deepEqual(list.params, [T, FORM, 1000, 1000]);
  assert.equal(out.offset, 1000);
  assert.equal(out.limit, 1000);
  assert.equal(out.total, 1311);
  assert.deepEqual(out.rows.map((r) => [r.communeLabel, r.regionName]), [['TOMBOARIVO', 'Anosy'], ['TSIVORY', 'Anosy']]);
  // Une seule fiche, seulement les valeurs présentes dans la page (jamais toute une liste).
  const choices = calls.find((c) => /FROM monitoring_choices c/.test(c.sql));
  assert.deepEqual(choices.params[1], [FORM]);
  assert.deepEqual(choices.params[3].sort(), ['89', '91']);
  // Catalogue de la fiche lu une fois pour toutes les dimensions.
  assert.equal(calls.filter((c) => /FROM monitoring_form_fields/.test(c.sql)).length, 1);
});

test('tendance : fenêtre de 12 mois finissant à `to`, étendue pour une plage plus longue', async () => {
  rowsFor = () => [];
  calls = [];
  await repo.processOverview(T, { from: '2026-07', to: '2026-07' });
  const trend = calls.find((c) => /generate_series\(\$3::date/.test(c.sql));
  assert.deepEqual(trend.params, [T, null, '2025-08-01', '2026-08-01']);
  calls = [];
  await repo.processOverview(T, { from: '2025-01', to: '2026-06' });
  assert.deepEqual(calls.find((c) => /generate_series\(\$3::date/.test(c.sql)).params, [T, null, '2025-01-01', '2026-07-01']);
});

test('une seule clé « sites (données) » : Synthèse, Couverture & performance, résultats d\'une fiche, concepteur', async () => {
  const key = submissionSiteKey('s');
  assert.equal(key, "COALESCE('id:' || s.site_id::text, 'code:' || s.form_id::text || ':' || NULLIF(btrim(s.site), ''))");
  assert.doesNotMatch(key, /admin3/, 'jamais la commune');
  rowsFor = (s) => {
    if (/FROM monitoring_forms WHERE tenant_id = \$1 AND active = true ORDER BY label/.test(s)) return [{ id: FORM, code: 'F', label: 'Fiche' }];
    if (/FROM monitoring_forms f WHERE f\.tenant_id = \$1 AND f\.active = true/.test(s)) return [{ id: FORM, code: 'F', label: 'Fiche' }];
    if (/AS visits/.test(s)) return [{ visits: 0, sitesVisited: 0 }];
    if (/count\(\*\)::int AS submissions/.test(s) && !/GROUP BY/.test(s)) return [{ submissions: 0 }];
    return [];
  };
  for (const run of [
    () => repo.processOverview(T, H1), () => repo.coverageDashboard(T, H1),
    () => repo.dashboard(T, FORM, { period: H1 }), () => repo.reportMonitoringData(T, H1),
  ]) {
    calls = [];
    await run();
    const siteSql = calls.filter((c) => /AS sites\b|AS "sitesVisited"|AS sitekey/.test(c.sql));
    assert.ok(siteSql.length >= 1);
    for (const c of siteSql) {
      assert.ok(c.sql.includes(key), `clé commune absente : ${c.sql.slice(0, 120)}`);
      assert.doesNotMatch(c.sql, /DISTINCT NULLIF\(s?\.?site, ''\)|NULLIF\(s\.admin3, ''\)\)\)::int AS "sitesVisited"/);
    }
  }
});

test('réponses : période { from, to, months } et champs hérités (month = from si un seul mois)', async () => {
  rowsFor = (s) => (/count\(\*\)::int AS submissions/.test(s) && !/GROUP BY/.test(s) ? [{ submissions: 0 }] : []);
  const one = await repo.coverageDashboard(T, { month: '2026-07' });
  assert.deepEqual([one.period, one.month, one.from, one.to], [{ from: '2026-07', to: '2026-07', months: 1 }, '2026-07', '2026-07', '2026-07']);
  const range = await repo.processOverview(T, H1);
  assert.deepEqual([range.period, range.month, range.from, range.to], [{ from: '2026-01', to: '2026-06', months: 6 }, null, '2026-01', '2026-06']);
  const all = await repo.processOverview(T, null);
  assert.deepEqual([all.period, all.month, all.from, all.to], [null, null, null, null]);
});
