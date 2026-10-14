/**
 * Dépôt terrain sur une PLAGE (lot 1b) SANS base : un faux client capte le SQL.
 * Une requête de faits site × mois (GROUPING SETS + série mensuelle) et une requête
 * prestataires, aux MÊMES bornes semi-ouvertes ; tenant_id filtré dans chaque CTE ;
 * cases « Oui » de la grille lues en ensemble ; listes sans sous-requête par ligne ;
 * état RBM borné au mois de référence.
 */
process.env.LOG_LEVEL = 'silent';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');

const T = '11111111-1111-1111-1111-111111111111';
let calls = [];
let rowsFor = () => [];
db.withTenantTransaction = async (_tenantId, fn) => fn({
  query: async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params });
    return { rows: rowsFor(s, params) };
  },
});
const field = require('../src/modules/tpm/field.repository');
const { siteMonthFactsCtes } = require('../src/modules/common/siteActivitySql');
const today = new Date().toISOString().slice(0, 7);
const H1 = { from: '2026-01', to: '2026-06' };
const factsCall = () => calls.find((c) => /GROUPING SETS/.test(c.sql));
const providerCall = () => calls.find((c) => /AS "sitesPlanned"/.test(c.sql) && /FROM site_visits v LEFT JOIN partners/.test(c.sql));

test('résumé : une requête de faits (GROUPING SETS + mois) et une requête prestataires, mêmes bornes', async () => {
  calls = []; rowsFor = () => [];
  const out = await field.summary(T, { period: H1 });
  assert.equal(calls.length, 2, 'deux requêtes, pas une par site ni par mois');
  const f = factsCall();
  assert.match(f.sql, /GROUP BY GROUPING SETS \(\(\), \(office\), \(dkey\), \(activity\)\) UNION ALL SELECT 'month', to_char\(m, 'YYYY-MM'\)/);
  assert.deepEqual(f.params, [T, '2026-01-01', '2026-06-01', '2026-07-01', `${today}-01`, 2026, 2026]);
  const p = providerCall();
  assert.match(p.sql, /v\.period_month >= \$2::date AND v\.period_month < \$3::date/);
  assert.deepEqual(p.params, [T, '2026-01-01', '2026-07-01']);
  assert.deepEqual(out.period, { from: '2026-01', to: '2026-06', months: 6 });
  // Un mois (?month=) : bornes [1er du mois, 1er du mois suivant[ — jamais une plage vide.
  calls = [];
  await field.summary(T, { month: '2026-09' });
  assert.deepEqual(providerCall().params, [T, '2026-09-01', '2026-10-01']);
  assert.deepEqual(factsCall().params.slice(1, 4), ['2026-09-01', '2026-09-01', '2026-10-01']);
});

test('faits site × mois : tenant_id dans chaque CTE, grille lue en ensemble, une visite = site × mois', () => {
  const params = [T];
  const sql = siteMonthFactsCtes({ period: H1, todayMonth: '2026-10' }, params).replace(/\s+/g, ' ');
  for (const re of [
    /FROM site_month_status g WHERE g\.tenant_id = \$1/, // années avec grille
    /FROM sites s LEFT JOIN admin_areas ad ON ad\.tenant_id = s\.tenant_id AND ad\.pcode = s\.adm2_pcode LEFT JOIN field_offices fo ON fo\.id = s\.field_office_id AND fo\.tenant_id = s\.tenant_id WHERE s\.tenant_id = \$1/,
    /FROM site_month_status x WHERE x\.tenant_id = \$1 AND x\.active AND x\.year BETWEEN \$6 AND \$7/,
    /FROM site_visits v WHERE v\.tenant_id = \$1 AND v\.period_month >= \$2::date AND v\.period_month < \$4::date/,
  ]) assert.match(sql, re);
  // Cases « Oui » lues UNE fois (CTE matérialisé) puis jointes par égalité : aucune lecture par site.
  assert.match(sql, /st AS MATERIALIZED \(/);
  assert.match(sql, /LEFT JOIN st ON st\.site_id = r\.site_id AND st\.m = mm\.m/);
  assert.doesNotMatch(sql, /LATERAL|generate_subscripts/);
  // Actif : jamais en zone interdite ; grille connue → « Oui » explicite ; sinon tout le registre.
  assert.match(sql, /NOT r\.forbidden AND \(NOT mm\.known OR st\.site_id IS NOT NULL\) AS active/);
  // Statut unique d'un site × mois : réalisée > prévue > annulée.
  assert.match(sql, /CASE WHEN bool_or\(v\.status = 'realise'\) THEN 'realise' WHEN bool_or\(v\.status = 'planifie'\) THEN 'planifie' ELSE 'annule' END AS st/);
  // District : nom officiel du découpage, sinon adm2 / district ; regroupé en minuscules.
  assert.match(sql, /lower\(COALESCE\(NULLIF\(btrim\(ad\.name\), ''\), NULLIF\(btrim\(s\.adm2\), ''\), NULLIF\(btrim\(s\.district\), ''\), '—'\)\) AS dkey/);
  assert.deepEqual(params, [T, '2026-01-01', '2026-06-01', '2026-07-01', '2026-10-01', 2026, 2026]);
});

test('faits en mode « bureau » (concepteur) : bureau parent, libellé « non rattaché » en paramètre ; filtre district', () => {
  const params = [T];
  const sql = siteMonthFactsCtes({ period: H1, todayMonth: '2026-10', office: 'bureau', unattached: '(not attached)', district: 'Ambovombe' }, params);
  assert.match(sql, /COALESCE\(par\.name, fo\.name, \$8::text\) AS office/);
  assert.match(sql, /LEFT JOIN field_offices par ON par\.id = fo\.parent_id AND par\.tenant_id = s\.tenant_id/);
  assert.match(sql, /= lower\(btrim\(\$9::text\)\)/);
  assert.deepEqual(params.slice(7), ['(not attached)', 'Ambovombe']);
});

test('récapitulatif : sites ACTIFS sur la période, site × mois réalisés pendant un mois actif ; operationMonths = durée', async () => {
  calls = [];
  rowsFor = (s) => (/FROM per_site WHERE active/.test(s) ? [{ riskLevel: 'elevee', visitCount: 6 }, { riskLevel: 'faible', visitCount: 1 }] : []);
  const out = await field.coverageRecapSummary(T, { period: H1, district: 'Bekily' });
  assert.match(calls[0].sql, /SELECT risk AS "riskLevel", realise_active AS "visitCount" FROM per_site WHERE active$/);
  assert.equal(out.operationMonths, 6, 'durée de la période');
  assert.deepEqual(out.period, { from: '2026-01', to: '2026-06', months: 6 });
  assert.ok(calls[0].params.includes('Bekily'));
  // Liste des districts : même clé (minuscules), un nom par district.
  assert.match(calls[1].sql, /GROUP BY lower\(COALESCE\(NULLIF\(btrim\(ad\.name\), ''\)/);
  const explicit = await field.coverageRecapSummary(T, { period: H1, operationMonths: 12 });
  assert.equal(explicit.operationMonths, 12, 'valeur donnée gardée');
});

test('données terrain du concepteur : noms de champs gardés, sites actifs et réalisés pendant un mois actif', async () => {
  calls = [];
  rowsFor = (s) => (/FROM per_site GROUP BY office/.test(s) ? [
    { dim: 'office', key: 'Bureau Sud', sitesActive: 40, sitesPlanned: 30, sitesRealised: 25, sitesRealisedInactive: 1, smPlanifie: 6, smRealise: 28, smAnnule: 2, planifie: 7, realise: 30, annule: 2 },
    { dim: 'month', key: '2026-02', smPlanifie: 1, smRealise: 4 },
    { dim: 'month', key: '2026-01', smPlanifie: 0, smRealise: 0 },
  ] : []);
  const out = await field.reportFieldData(T, H1, { lang: 'fr' });
  assert.equal(calls.length, 1, 'une seule requête de faits');
  assert.deepEqual(['bureau', 'sitesActive', 'planned', 'done', 'sitesVisited'].map((k) => out.byOffice[0][k]), ['Bureau Sud', 40, 34, 28, 25]);
  assert.deepEqual(out.monthly, [{ month: '2026-01', planned: 0, done: 0 }, { month: '2026-02', planned: 5, done: 4 }]);
});

test('liste des visites : période semi-ouverte, dernière collecte réelle calculée en ensemble (pas par ligne)', async () => {
  calls = [];
  const sid = 'a0000000-0000-4000-8000-000000000001';
  rowsFor = (s) => {
    if (/FROM site_visits v JOIN sites s/.test(s)) return [{ id: 'v1', siteId: sid }, { id: 'v2', siteId: sid }];
    if (/WITH ts AS MATERIALIZED/.test(s)) return [{ id: sid, last: '2026-05-01' }];
    return [];
  };
  const rows = await field.listVisits(T, { period: H1, status: 'realise' });
  assert.match(calls[0].sql, /v\.tenant_id = \$1 AND v\.period_month >= \$2::date AND v\.period_month < \$3::date AND v\.status = \$4/);
  assert.doesNotMatch(calls[0].sql, /SELECT to_char\(max\(ms\.period_month\)/, 'plus de sous-requête par visite');
  assert.deepEqual(calls[1].params, [T, [sid]], 'un site distinct, une seule lecture');
  assert.match(calls[1].sql, /ms\.site_id = ANY \(ARRAY\(SELECT id FROM ts\)\)/);
  assert.match(calls[1].sql, /ms\.site_id IS NULL AND ms\.adm3_pcode = ANY \(ARRAY\(SELECT DISTINCT adm3_pcode FROM ts WHERE adm3_pcode IS NOT NULL\)\)/);
  assert.deepEqual(rows.map((r) => r.dataVisitMonth), ['2026-05', '2026-05']);
});

test('RBM : état au mois de référence — visites réalisées, données et date du registre bornées, plan à venir non borné', async () => {
  calls = []; rowsFor = () => [];
  await field.rbmSites(T, { month: '2026-06', asOf: '2026-06' });
  const q = calls.find((c) => /AS "fieldVisitMonth"/.test(c.sql));
  assert.equal(q.params[1], '2026-06-01');
  assert.match(q.sql, /max\(v\.period_month\) FILTER \(WHERE v\.status = 'realise' AND v\.period_month <= \$2::date\) AS last_done/);
  assert.match(q.sql, /AND ms\.period_month <= \$2::date/);
  assert.match(q.sql, /CASE WHEN s\.last_visit_date < \(\$2::date \+ interval '1 month'\) THEN/);
  assert.match(q.sql, /FILTER \(WHERE v\.status = 'planifie'\) AS planned/, 'les visites prévues ne sont pas bornées');
  // Sans mois de référence : comportement inchangé (aucune borne).
  calls = [];
  await field.rbmSites(T, {});
  assert.doesNotMatch(calls.find((c) => /AS "fieldVisitMonth"/.test(c.sql)).sql, /<= \$2::date/);
});
