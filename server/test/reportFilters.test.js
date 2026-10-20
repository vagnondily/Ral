/**
 * Retour 102 — un test PAR FILTRE du concepteur de rapport, sur les requêtes du catalogue (fragments
 * SQL, sources, mises en forme) : période (plage ET mois cochés, retour 68), bureau avec TOUTES ses
 * antennes (retour 78), activité, prestataire (TPM) ou titulaire, district. La preuve en base réelle,
 * par les chiffres, est test/reportFiltersDb.test.js (base jetable) ; ici, sans base.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const period = require('../src/modules/common/period');
const { monthWithin, spanOverlaps, monthSeries } = require('../src/modules/common/periodSql');
const { siteMonthFactsCtes } = require('../src/modules/common/siteActivitySql');
const { factFilter } = require('../src/modules/monitoring/indicatorFacts.repository');
const { parseDocV2 } = require('../src/modules/reports/reportSchema');
const { datasetDef, kpiDef } = require('../src/modules/reports/catalog');
const { SOURCES } = require('../src/modules/reports/sources');
const { periodFor } = require('../src/modules/reports/sources/scope');
const { effectiveFilters } = require('../src/modules/reports/renderPlan');
const { unsupportedNote } = require('../src/modules/reports/reports.service');
const { dashScope } = require('../src/modules/reports/catalog/coverage');
const { contractPartnerMatch } = require('../src/modules/reports/catalog/budget');
const { shapeCoverage } = require('../src/modules/dashboards/coverageDefinitions');

const T = '11111111-1111-4111-8111-111111111111';
const LIST = { from: '2026-01', to: '2026-06', months: ['2026-01', '2026-03', '2026-06'] };
const ctx = (lang = 'fr') => ({ lang, args: {}, officeParents: new Map() });
const doc = (extra = {}) => parseDocV2({ schemaVersion: 2, title: 'R', period: { from: '2026-01', to: '2026-06' }, blocks: [], ...extra });

test('période : plage OU mois cochés — lecture, forme canonique, schéma du rapport et du bloc, libellés', () => {
  // Lecture au bord : seulement là où c'est permis (jamais une liste ignorée en silence).
  assert.deepEqual(period.parsePeriod({ months: '2026-06,2026-01,2026-03' }, { allowList: true }).period, LIST);
  assert.equal(period.parsePeriod({ months: '2026-01,2026-03' }).code, 'period_list_unsupported');
  assert.equal(period.parsePeriod({ months: '2026-01', from: '2026-01', to: '2026-02' }, { allowList: true }).code, 'period_ambiguous');
  assert.equal(period.parsePeriod({ months: '2026-13' }, { allowList: true }).code, 'period_months');
  assert.equal(period.parsePeriod({ months: '2020-01,2026-01' }, { allowList: true }).code, 'period_span');
  // Une liste qui couvre toute sa plage EST une plage.
  assert.deepEqual(period.periodOfMonths(['2026-02', '2026-01', '2026-03', '2026-02']), { from: '2026-01', to: '2026-03' });
  // Schéma du rapport ET d'un bloc : canonique (from / to recalculés depuis la liste).
  const d = doc({ period: { from: '2025-01', to: '2026-12', months: ['2026-06', '2026-01', '2026-03'] }, blocks: [{ id: 'k', type: 'kpis', params: { metrics: ['submissions'], filters: { period: { from: '2026-01', to: '2026-02', months: ['2026-02'] } } } }] });
  assert.deepEqual(d.period, LIST);
  assert.deepEqual(d.blocks[0].params.filters.period, { from: '2026-02', to: '2026-02' });
  assert.throws(() => doc({ period: { from: '2026-01', to: '2026-02', months: ['2026-13'] } }));
  // Filtres effectifs et paramètres des sources : la liste passe telle quelle ; « situation au » = dernier mois coché.
  const eff = effectiveFilters(d, {});
  assert.deepEqual(periodFor('range', eff), LIST);
  assert.deepEqual(periodFor('asOf', eff), { from: '2026-06', to: '2026-06' });
  assert.deepEqual(period.monthsOf(LIST), LIST.months);
  assert.deepEqual(period.trendWindow(LIST, '2026-10'), LIST);
  assert.equal(period.overlaps(LIST, '2026-02'), false);
  assert.equal(period.overlaps(LIST, '2026-02', '2026-03'), true);
  assert.deepEqual(period.periodInfo(LIST), { from: '2026-01', to: '2026-06', months: 3, selected: LIST.months });
  // Libellés : suites de 3 mois et plus regroupées ; forme courte bornée.
  assert.equal(period.periodLabel(LIST, 'fr'), 'Janvier, mars et juin 2026');
  assert.equal(period.periodLabel(LIST, 'en'), 'January, March and June 2026');
  assert.equal(period.periodLabel(period.periodOfMonths(['2026-01', '2026-02', '2026-03', '2026-05', '2026-08']), 'fr'), 'Janvier à mars, mai et août 2026');
  assert.equal(period.periodLabel(period.periodOfMonths(['2025-11', '2025-12', '2026-02']), 'fr'), 'Novembre et décembre 2025, février 2026');
  assert.equal(period.periodLabel(LIST, 'fr', { short: true }), 'Janv., mars, juin 2026');
  assert.equal(period.periodLabel(period.periodOfMonths(['2026-01', '2026-03', '2026-05', '2026-07']), 'en', { short: true }), '4 months · Jan – Jul 2026');
});

test('période : les requêtes du catalogue respectent les mois cochés (prédicats SQL, faits site × mois, tendance)', () => {
  // Prédicat d'un mois : la plage (index) ET un mois de la liste ; une plage reste inchangée.
  const p = [T];
  const w = monthWithin('s.period_month', LIST, p);
  assert.match(w, /s\.period_month >= \$2::date AND s\.period_month < \$3::date AND date_trunc\('month', s\.period_month\)::date = ANY\(\$4::date\[\]\)/);
  assert.deepEqual(p, [T, '2026-01-01', '2026-07-01', ['2026-01-01', '2026-03-01', '2026-06-01']]);
  assert.doesNotMatch(monthWithin('s.period_month', { from: '2026-01', to: '2026-06' }, [T]), /ANY/);
  assert.match(spanOverlaps('r.period_month', 'r.period_end', LIST, [T]), /EXISTS \(SELECT 1 FROM unnest\(\$4::date\[\]\) AS pm\(m\)/);
  assert.equal(monthSeries(LIST, [T]), 'unnest($2::timestamp[])');
  // Faits site × mois (couverture, carte, récapitulatif) : les mois de la période SONT la liste.
  const q = [T];
  const ctes = siteMonthFactsCtes({ period: LIST, todayMonth: '2026-10', withData: true }, q);
  const k = q.findIndex((x) => Array.isArray(x)) + 1;
  assert.ok(k > 0, 'liste des mois en paramètre');
  assert.match(ctes, new RegExp(`FROM unnest\\(\\$${k}::date\\[\\]\\) AS m`));
  assert.match(ctes, new RegExp(`make_date\\(x\\.year, x\\.month, 1\\) = ANY\\(\\$${k}::date\\[\\]\\)`), 'grille des sites actifs');
  assert.match(ctes, new RegExp(`date_trunc\\('month', v\\.period_month\\)::date = ANY\\(\\$${k}::date\\[\\]\\)`), 'visites');
  assert.match(ctes, new RegExp(`date_trunc\\('month', ms\\.period_month\\)::date = ANY\\(\\$${k}::date\\[\\]\\)`), 'données reçues');
  assert.doesNotMatch(siteMonthFactsCtes({ period: { from: '2026-01', to: '2026-06' }, todayMonth: '2026-10' }, [T]), /ANY\(/);
  // Mises en forme : complétude mensuelle = une colonne par mois COCHÉ.
  const c = datasetDef('cov.completeness_monthly').shape({ monthly: [], monthlyByActivity: [], byActivity: [] }, { period: LIST }, ctx());
  assert.deepEqual(c.columns.slice(2).map((x) => x.key), ['m:2026-01', 'm:2026-03', 'm:2026-06']);
  // Une source qui ne sait pas lire une liste : le bloc le DIT (jamais la plage entière en silence).
  assert.equal(SOURCES.amendments.monthList, undefined);
  assert.equal(unsupportedNote(datasetDef('ctr.amendments'), { period: LIST }, 'fr'), 'Non disponible pour des mois non consécutifs : choisissez une plage « du … au … ».');
  for (const key of ['mon.kpis_data', 'cov.kpis', 'cov.by_activity', 'cov.monthly', 'bud.monthly', 'tpm.reports_status']) {
    assert.equal(unsupportedNote(datasetDef(key), { period: LIST }, 'fr'), null, key);
  }
  // Un jeu « situation au » ou « année » lit le dernier mois coché : jamais refusé.
  assert.equal(unsupportedNote(datasetDef('bud.kpis'), { period: LIST }, 'fr'), null);
});

test('période : libellé des mois cochés identique côté web et côté serveur', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/period.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const web = await import(pathToFileURL(file).href);
  const lists = [['2026-01', '2026-03', '2026-06'], ['2026-01', '2026-02', '2026-03', '2026-05', '2026-08'], ['2025-11', '2025-12', '2026-02'], ['2026-04', '2026-09'], ['2025-12', '2026-01', '2026-02', '2026-03', '2026-05']];
  for (const l of lists) {
    const p = period.periodOfMonths(l);
    assert.deepEqual(web.periodOfMonths(l), p);
    for (const lang of ['fr', 'en']) for (const short of [false, true]) assert.equal(web.periodLabel(p, lang, { short }), period.periodLabel(p, lang, { short }), `${l} ${lang} ${short}`);
    assert.deepEqual(web.monthsOf(p), period.monthsOf(p));
    assert.equal(web.overlaps(p, '2026-02'), period.overlaps(p, '2026-02'));
  }
  assert.deepEqual(web.periodParams(LIST), { months: '2026-01,2026-03,2026-06' });
  assert.equal(web.samePeriod(LIST, { from: '2026-01', to: '2026-06' }), false);
});

test('bureau : le bureau et TOUTES ses antennes (sous-arbre récursif) dans les faits de sites et les soumissions', () => {
  const p = [T];
  const sql = siteMonthFactsCtes({ period: { from: '2026-01', to: '2026-06' }, todayMonth: '2026-10', officeId: '22222222-2222-4222-8222-222222222222' }, p);
  assert.match(sql, /^WITH RECURSIVE office_tree AS \(/);
  assert.match(sql, /UNION\s+SELECT f\.id FROM field_offices f JOIN office_tree o ON f\.parent_id = o\.id/);
  assert.match(sql, /s\.field_office_id IN \(SELECT id FROM office_tree\)/);
  const q = [T];
  const f = factFilter('s', { officeKey: 'id:22222222-2222-4222-8222-222222222222' }, q, null);
  assert.match(f, /WITH RECURSIVE ot AS/);
  assert.doesNotMatch(f, /o\.parent_id = \$2/, 'jamais un seul niveau d\'antennes');
  // Les jeux de couverture et de suivi déclarent le filtre bureau ; une clé de fiche n'a pas de sens pour des sites.
  assert.equal(unsupportedNote(datasetDef('cov.by_activity'), { office: 'id:o1' }, 'fr'), null);
  assert.equal(unsupportedNote(datasetDef('mon.kpis_data'), { office: 'id:o1' }, 'fr'), null);
  assert.equal(unsupportedNote(datasetDef('bud.by_contract'), { office: 'id:o1' }, 'fr'), 'Non disponible par bureau.');
});

const R = (o) => ({ registry: 0, forbidden: 0, sites: 0, covered: 0, coveredData: 0, coveredVisit: 0, plannedSites: 0, plannedCovered: 0, plannedData: 0, plannedVisit: 0, visitsPlanned: 0, visitsCovered: 0, visitsData: 0, visitsVisit: 0, visitsUpcoming: 0, refSites: 0, refDue: 0, ...o });
const DASH = shapeCoverage([
  R({ dim: 'overall', key: null, registry: 10, sites: 10, covered: 4, coveredVisit: 4 }),
  R({ dim: 'activity', key: 'cantine', activityLabel: 'Cantine', registry: 6, sites: 6, covered: 3, coveredVisit: 3 }),
  R({ dim: 'activity', key: 'nutrition', activityLabel: 'Nutrition', registry: 4, sites: 4, covered: 1, coveredVisit: 1 }),
  R({ dim: 'district', key: 'ambovombeandroy', districtLabel: 'Ambovombe-Androy', registry: 7, sites: 7, covered: 1, coveredVisit: 1 }),
  R({ dim: 'district', key: 'bekily', districtLabel: 'Bekily', registry: 3, sites: 3, covered: 3, coveredVisit: 3 }),
], { refMonth: '2026-06' });

test('activité : le groupe de l\'activité (couverture des tableaux de bord), les sites (faits) et les fiches (suivi)', () => {
  const k = datasetDef('cov.kpis').shape(dashScope(DASH, {}) && DASH, { activity: ' cantine ' }, ctx()).rows[0];
  assert.deepEqual([k.sitesActive, k.sitesRealised], [6, 3]);
  assert.equal(kpiDef('sites_active').pick(DASH, { activity: 'NUTRITION' }).value, 4);
  assert.equal(kpiDef('sites_active').pick(DASH, {}).value, 10);
  assert.deepEqual(SOURCES.covFacts.params(datasetDef('cov.monthly'), { period: LIST, activity: 'Cantine' }), { period: LIST, officeId: null, activity: 'Cantine', district: null });
  assert.match(siteMonthFactsCtes({ period: LIST, todayMonth: '2026-10', activity: 'Cantine' }, [T]), /lower\(btrim\(s\.activity\)\) = lower\(btrim\(\$\d+::text\)\)/);
  assert.match(factFilter('s', { activity: 'Cantine' }, [T], null), /f\.activity_category\)\) = lower\(btrim\(\$2\)\)/);
});

test('prestataire (TPM) ou titulaire : visites et soumissions du prestataire ; budget du titulaire OU d\'un TPM rattaché', () => {
  const P = '33333333-3333-4333-8333-333333333333'; const Q = '44444444-4444-4444-8444-444444444444';
  // Budget : contrat de Q (titulaire) où P est le TPM rattaché par un plan, une facture ou une visite.
  const raw = {
    rows: [
      { contractId: 'c1', partnerId: P, numero: 'FLA-1', budget: 100, planned: 10, actual: 5, monthly: {} },
      { contractId: 'c2', partnerId: Q, numero: 'FLA-2', budget: 200, planned: 20, actual: 15, monthly: {} },
      { contractId: 'c3', partnerId: Q, numero: 'FLA-3', budget: 300, planned: 0, actual: 0, monthly: {} },
    ],
    tpmByContract: { c2: [P, Q], c3: [Q] }, today: '2026-06',
  };
  assert.equal(contractPartnerMatch(raw.rows[0], P, raw.tpmByContract), true, 'titulaire');
  assert.equal(contractPartnerMatch(raw.rows[1], P, raw.tpmByContract), true, 'TPM rattaché');
  assert.equal(contractPartnerMatch(raw.rows[2], P, raw.tpmByContract), false);
  const shape = (pid) => datasetDef('bud.by_contract').shape(raw, { period: LIST, partnerId: pid }, ctx()).rows.filter((r) => !r._total).map((r) => r.contract);
  assert.deepEqual(shape(P), ['FLA-1', 'FLA-2']);
  assert.deepEqual(shape(Q), ['FLA-2', 'FLA-3']);
  assert.equal(kpiDef('budget_total').pick(raw, { partnerId: P }).value, 300);
  // Visites par prestataire et soumissions : le prestataire de la visite / de la soumission.
  const cov = { byProvider: [{ key: P, label: 'P', planifie: 1, realise: 2, annule: 0, sites: { planned: 1, realised: 2 } }, { key: Q, label: 'Q', planifie: 0, realise: 1, annule: 0, sites: { planned: 0, realised: 1 } }] };
  assert.deepEqual(datasetDef('cov.visits_by_provider').shape(cov, { partnerId: P }, ctx()).rows.map((r) => r.realise), [2]);
  assert.match(factFilter('s', { partnerId: P }, [T], null), /s\.partner_id = \$2::uuid/);
  // Jeux sans prestataire : la note le dit.
  assert.equal(unsupportedNote(datasetDef('cov.kpis'), { partnerId: P }, 'fr'), 'Non disponible par partenaire.');
});

test('district : groupe du district (tableaux de bord), faits de sites, soumissions (nom ou P-code) ; combinaisons non lues = note', () => {
  const k = datasetDef('cov.kpis').shape(DASH, { district: 'BEKILY' }, ctx()).rows[0];
  assert.deepEqual([k.sitesActive, k.sitesRealised], [3, 3]);
  assert.equal(kpiDef('coverage').pick(DASH, { district: 'ambovombe androy' }).value, 14.3);
  assert.deepEqual(datasetDef('cov.by_district').shape(DASH, { district: 'Bekily' }, ctx()).rows.map((r) => r.district), ['Bekily']);
  assert.equal(kpiDef('sites_active').pick(DASH, { district: 'Inconnu' }).value, 0);
  // Faits site × mois : district par son nom affiché ou une graphie du registre.
  assert.match(siteMonthFactsCtes({ period: LIST, todayMonth: '2026-10', district: 'Bekily' }, [T]), /sd\.dkey IN \(SELECT x\.dkey FROM sdist x WHERE x\.dkey = /);
  assert.deepEqual(SOURCES.covFacts.params(datasetDef('cov.monthly'), { period: LIST, district: 'Bekily' }).district, 'Bekily');
  // Soumissions : district en nom, en P-code d'un district de ce nom, ou commune d'un district de ce nom.
  const p = [T];
  const f = factFilter('s', { district: 'Ambovombe-Androy' }, p, null);
  assert.equal(p[1], 'ambovombeandroy');
  assert.match(f, /regexp_replace\(lower\(COALESCE\(s\.admin2, ''\)\), '\[\^a-z0-9\]\+', '', 'g'\) = \$2/);
  assert.match(f, /upper\(btrim\(s\.admin2\)\) IN \(SELECT upper\(d\.pcode\) FROM admin_areas d WHERE d\.tenant_id = \$1 AND d\.depth = 2/);
  assert.match(f, /s\.adm3_pcode IN \(SELECT c\.pcode FROM admin_areas c JOIN admin_areas d ON d\.id = c\.parent_id/);
  // Schéma : district du rapport et d'un bloc (« Tous » permis sur un bloc).
  const d = doc({ filters: { district: 'Bekily' }, blocks: [{ id: 'k', type: 'kpis', params: { metrics: ['sites_active'], filters: { district: 'all' } } }] });
  assert.equal(d.filters.district, 'Bekily');
  assert.equal(effectiveFilters(d, d.blocks[0].params.filters).district, undefined);
  assert.equal(effectiveFilters(d, {}).district, 'Bekily');
  // Non lus : le plan de suivi et le RBM (graphie du registre), activité ET district d'une couverture.
  assert.equal(unsupportedNote(datasetDef('plan.kpis'), { district: 'Bekily' }, 'fr'), 'Non disponible par district.');
  assert.equal(unsupportedNote(datasetDef('rbm.kpis'), { district: 'Bekily' }, 'en'), 'Not available by district.');
  assert.match(unsupportedNote(datasetDef('cov.kpis'), { district: 'Bekily', activity: 'Cantine' }, 'fr'), /activité ET un district/);
  assert.equal(unsupportedNote(datasetDef('cov.monthly'), { district: 'Bekily', activity: 'Cantine' }, 'fr'), null, 'faits site × mois : les deux à la fois');
});
