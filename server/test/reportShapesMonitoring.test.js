/**
 * Concepteur de rapport (lot 7a, C4) — mises en forme du catalogue « Suivi de processus »,
 * « Couverture et plan » et chiffres clés, sur des faits synthétiques (aucune base).
 * Reprend les garanties de l'ancien test/reportData.test.js et de reportBureauLabels.test.js :
 *  - couverture = sites actifs réalisés ÷ sites actifs ; « — aucun plan » (null), jamais 0 % ;
 *  - jeux « une fiche » : exigent une activité (note dans la langue du rapport) ;
 *  - bureau non relié nommé (« Code 7 (non relié) » / « Code 7 (not linked) »), sans le nom de
 *    la fiche dans un tableau d'UNE fiche, avec lui quand les fiches sont mêlées ;
 *  - n dans meta ; filtre non pris en charge → note (jamais un total national).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { pageFacts, mergeAll, mergeVisits } = require('../src/modules/monitoring/indicatorTallies');
const { overallIndex, computeAll } = require('../src/modules/monitoring/monitoringMath');
const { shapeCoverageFacts } = require('../src/modules/tpm/fieldMath');
const { shapeCoverage } = require('../src/modules/dashboards/coverageDefinitions');
const { datasetDef, kpiDef } = require('../src/modules/reports/catalog');
const { bulletinDoc, bulletinFindings, monthsBetween } = require('../src/modules/reports/reportData');
const { unsupportedNote } = require('../src/modules/reports/reports.service');

const PERIOD = { from: '2026-01', to: '2026-03' };
const ctx = (lang = 'fr', args = {}) => ({ lang, args, officeParents: new Map() });

const IND = [
  { id: 'i1', code: 'C1', label: 'Cuisine présente', module: 'D1 Cuisine', sourceField: 'cuisine', agg: 'percent_yes', target: 90, direction: 'higher_better' },
  { id: 'i2', code: 'G1', label: 'Comité actif', module: 'D6 Gouvernance', sourceField: 'comite', agg: 'percent_yes', target: null, direction: 'higher_better' },
  { id: 'i3', code: 'B1', label: 'Bénéficiaires', module: 'D1 Cuisine', sourceField: 'benef', agg: 'mean', target: null, direction: 'higher_better' },
];

/** Faits d'une fiche (forme de monitoring.repository.reportFormsFacts) depuis des réponses par groupe. */
function form(id, label, groups) {
  const g = new Map(); const counts = new Map(); const vg = new Map();
  for (const [k, x] of Object.entries(groups)) {
    const rows = x.rows.map((data, i) => ({ data, meta: { id: `${id}-${k}-${i}`, month: k.split('|')[1], site: `S${i}`, agent: 'A', group: k } }));
    const f = pageFacts(IND, rows, [], { visits: true, keep: 50 });
    g.set(k, f.tallies); vg.set(k, f.visits);
    counts.set(k, { g: k, total: rows.length, ...x.meta });
  }
  return { id, code: id, label, activityCategory: null, facts: { inds: IND, defs: [], overall: mergeAll([...g.values()], IND.length), groups: g, counts, visitGroups: vg, visits: mergeVisits([...vg.values()]) } };
}
const yes = (n, extra = {}) => Array.from({ length: n }, () => ({ cuisine: 'oui', comite: 'oui', benef: '10', ...extra }));
const no = (n, extra = {}) => Array.from({ length: n }, () => ({ cuisine: 'non', comite: 'non', benef: '20', ...extra }));
const CODE7 = { officeStatus: 'non_relie', officeName: null, officeCode: '7' };
const SUD = { officeStatus: 'relie', officeName: 'Antenne Bekily', officeCode: null };
const LONG = 'Suivi de la distribution générale — fiche de supervision post-distribution (version 3)';

const SMP = form('f-smp', LONG, {
  'code:f-smp:7|2026-01': { meta: CODE7, rows: [...yes(3), ...no(1)] },
  'code:f-smp:7|2026-02': { meta: CODE7, rows: [...no(2)] },
  'id:o1|2026-03': { meta: SUD, rows: [...yes(4)] },
});
const MIARO = form('f-miaro', 'MIARO', { 'id:o1|2026-01': { meta: SUD, rows: [...yes(1), ...no(1)] } });
const VIDE = form('f-vide', 'Résilience', {});
const MON = { forms: [SMP, MIARO, VIDE] };
const shape = (key, raw, eff = {}, c = ctx()) => datasetDef(key).shape(raw, { period: PERIOD, ...eff }, c);

test('résultats des faits = calcul d\'un seul tenant (computeAll), bureaux et mois réunis', () => {
  const all = [...yes(3), ...no(1), ...no(2), ...yes(4)].map((data) => ({ data }));
  const ref = computeAll(IND, all);
  const rows = shape('mon.indicators', MON, { formId: 'f-smp' }).rows;
  assert.deepEqual(rows.map((r) => r.value), ref.map((r) => (r.value == null ? null : Math.round(r.value * 10) / 10)));
  assert.deepEqual(rows.map((r) => r.base), ref.map((r) => r.base));
});

test('conformité par activité : seules les fiches AYANT des données ; indice = overallIndex', () => {
  const d = shape('mon.forms_index', MON);
  assert.deepEqual(d.rows.map((r) => r.activity), [LONG, 'MIARO']);
  assert.equal(d.meta.n, 12);
  const kpi = kpiDef('conformity').pick(MON, { period: PERIOD }, ctx());
  const all = [...datasetDef('mon.indicators').shape(MON, { formId: 'f-smp', period: PERIOD }, ctx()).rows];
  assert.ok(all.length === 3);
  assert.equal(kpi.value, overallIndex([...require('../src/modules/reports/catalog/facts').formResults(SMP), ...require('../src/modules/reports/catalog/facts').formResults(MIARO)]));
});

test('scores par domaine : colonnes dynamiques (union triée), indice en dernier', () => {
  const d = shape('mon.domains_by_activity', MON);
  assert.deepEqual(d.columns.map((c) => c.key), ['activity', 'd:D1 Cuisine', 'd:D6 Gouvernance', 'score']);
  assert.equal(d.rows[1]['d:D1 Cuisine'], 50);
});

test('jeux « une fiche » : exigent une activité (note dans la langue du rapport) ; filtre de domaine', () => {
  assert.equal(shape('mon.domains_by_bureau', MON).meta.note, 'Choisissez une activité (fiche).');
  assert.equal(shape('mon.indicators', MON, {}, ctx('en')).meta.note, 'Choose an activity (form).');
  const i = shape('mon.indicators', MON, { formId: 'f-smp', module: 'D6 Gouvernance' });
  assert.deepEqual(i.rows.map((r) => [r.label, r.value, r.base, r.band]), [['Comité actif', 70, 10, 'sat']]);
  // Une fiche sans soumission : chaque indicateur dit pourquoi il n'est pas évalué.
  const v = shape('mon.indicators', MON, { formId: 'f-vide' }, ctx('en'));
  assert.ok(v.rows.every((r) => r.band === 'na' && r.reason === 'No submission over the period'));
});

test('bureau non relié nommé dans la langue du rapport ; sans le nom de la fiche dans un tableau d\'UNE fiche', () => {
  const en = shape('mon.domains_by_bureau', MON, { formId: 'f-smp' }, ctx('en'));
  assert.deepEqual(en.rows.map((r) => [r.bureau, r.n]), [['Code 7 (not linked)', 6], ['Antenne Bekily', 4]]);
  const fr = shape('mon.domains_by_bureau', MON, { formId: 'f-smp' });
  assert.equal(fr.rows[0].bureau, 'Code 7 (non relié)');
  // Plusieurs fiches mêlées : le code reste propre à SA fiche (nom de la fiche ajouté).
  const cmp = shape('mon.bureau_compare', MON, {}, ctx('en'));
  assert.ok(cmp.rows.some((r) => r.bureau === `Code 7 (not linked) · ${LONG}`));
  assert.ok(cmp.rows.some((r) => r.bureau === 'Antenne Bekily'));
});

test('tendance de l\'indice : un point par mois de la période, mois sans donnée = null (jamais 0)', () => {
  const d = shape('mon.index_trend', MON);
  assert.deepEqual(d.rows.map((r) => r.month), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(d.rows.map((r) => r.submissions), [6, 2, 4]);
  assert.equal(d.rows[1].index, 0);
  assert.deepEqual(shape('mon.index_trend', { forms: [VIDE] }).rows, []);
});

test('visites : classes par visite (somme = visites), % urgentes sur les notées, signaux', () => {
  const d = shape('mon.visit_classes', MON);
  const total = d.rows.find((r) => r._key === 'total');
  assert.equal(total.visits, 12);
  assert.equal(total.exc + total.sat + total.imp + total.urg + total.na, 12);
  assert.equal(total.urgentPct, Math.round((total.urg / (12 - total.na)) * 1000) / 10);
  const s = shape('mon.risk_signals', MON, {}, ctx('en'));
  assert.match(s.rows[0].signal, /visit\(s\) rated “Urgent action”/);
  const u = shape('mon.urgent_visits', MON);
  assert.equal(u.rows.length, total.urg);
  assert.ok(u.rows.every((r, i, a) => i === 0 || a[i - 1].score <= r.score));
});

test('qualité de saisie par agent : vides ou hors base ÷ réponses attendues (indicateurs notés)', () => {
  const f = form('f-ag', 'AG', {
    'id:a1': { meta: {}, rows: [{ cuisine: 'oui', comite: '', benef: '1' }, { cuisine: '', comite: 'oui', benef: '1' }] },
    'raw:Jean ': { meta: {}, rows: [{ cuisine: 'oui', comite: 'oui', benef: '1' }] },
  });
  const d = datasetDef('mon.agent_quality').shape({ forms: [f], agentNames: new Map([['id:a1', 'Agent Un']]) }, { period: PERIOD }, ctx());
  const a1 = d.rows.find((r) => r.agent === 'Agent Un');
  assert.equal(a1.blankPct, 33.3); // 2 vides sur 6 réponses attendues (3 indicateurs notés × 2)
  assert.equal(d.rows.find((r) => r.agent === 'Jean').blankPct, 0);
});

// ---- Couverture : faits site × mois ---------------------------------------------------------
const F = (o) => ({ sitesActive: 0, sitesPlanned: 0, sitesRealised: 0, sitesRealisedInactive: 0, smPlanifie: 0, smRealise: 0, smAnnule: 0, duePlanifie: 0, dueRealise: 0, upcoming: 0, planifie: 0, realise: 0, annule: 0, sitesTotal: 0, ...o });
const COV = {
  ...shapeCoverageFacts([
    F({ dim: 'overall', key: null, sitesActive: 100, sitesPlanned: 40, sitesRealised: 30, smPlanifie: 10, smRealise: 30, duePlanifie: 10, dueRealise: 30, planifie: 10, realise: 30 }),
    F({ dim: 'activity', key: 'Cantine', sitesActive: 80, sitesPlanned: 40, sitesRealised: 30, smPlanifie: 10, smRealise: 30, duePlanifie: 10, dueRealise: 30, planifie: 10, realise: 30 }),
    F({ dim: 'activity', key: 'Nutrition', sitesActive: 20 }),
    F({ dim: 'activity', key: 'Hors registre', sitesActive: 0, sitesRealisedInactive: 2, realise: 2 }),
    F({ dim: 'month_activity', key: '2026-01', sub: 'Cantine', sitesActive: 80, sitesRealised: 20, known: true }),
    F({ dim: 'month_activity', key: '2026-03', sub: 'Cantine', sitesActive: 0, known: true }),
    F({ dim: 'month', key: '2026-01', sitesActive: 100, sitesRealised: 20, smRealise: 20, smPlanifie: 5, known: true }),
  ]),
  byProvider: [],
};

// ---- Couverture : la source des TABLEAUX DE BORD (retour 110, une seule source) ----------------
const R = (o) => ({ registry: 0, forbidden: 0, sites: 0, covered: 0, coveredData: 0, coveredVisit: 0, plannedSites: 0, plannedCovered: 0, plannedData: 0, plannedVisit: 0, visitsPlanned: 0, visitsCovered: 0, visitsData: 0, visitsVisit: 0, visitsUpcoming: 0, refSites: 0, refDue: 0, ...o });
const DASH = shapeCoverage([
  R({ dim: 'overall', key: null, registry: 130, sites: 100, covered: 30, coveredData: 10, coveredVisit: 25, plannedSites: 40, plannedCovered: 28, visitsPlanned: 40, visitsCovered: 30, visitsUpcoming: 5, knownAll: true }),
  R({ dim: 'activity', key: 'cantine', activityLabel: 'Cantine', registry: 90, sites: 80, covered: 30, coveredData: 10, coveredVisit: 25, plannedSites: 40, plannedCovered: 28, visitsPlanned: 40, visitsCovered: 30, visitsUpcoming: 5 }),
  R({ dim: 'activity', key: 'nutrition', activityLabel: 'Nutrition', registry: 20, sites: 20 }),
  // Activité sans site actif sur la période (ses visites ne comptent pas : hors univers) : jamais listée.
  R({ dim: 'activity', key: 'hors registre', activityLabel: 'Hors registre', registry: 20, sites: 0 }),
  R({ dim: 'office', key: 'Bureau Sud', registry: 130, sites: 100, covered: 30, coveredData: 10, coveredVisit: 25, plannedSites: 40, plannedCovered: 28, visitsPlanned: 40, visitsCovered: 30, visitsUpcoming: 5 }),
], { refMonth: '2026-03' });

test('couverture par activité = celle des tableaux de bord : univers des sites actifs, suivi = visite OU données, jamais « 0 site actif » avec des visites prévues', () => {
  assert.equal(datasetDef('cov.by_activity').source, 'covDash');
  const d = shape('cov.by_activity', DASH);
  const by = Object.fromEntries(d.rows.map((r) => [r.activity, r]));
  assert.deepEqual(Object.keys(by), ['Cantine', 'Nutrition']); // « Hors registre » (0 site actif) n'est pas listée
  assert.equal(by.Cantine.coverage, 37.5); assert.equal(by.Cantine.status, 'faible');
  assert.equal(by.Cantine.sitesRealised, 30); assert.equal(by.Cantine.planned, 40); assert.equal(by.Cantine.done, 30); assert.equal(by.Cantine.execution, 75);
  assert.equal(by.Nutrition.coverage, 0); assert.equal(by.Nutrition.status, 'critique');
  assert.equal(by.Nutrition.execution, null); // aucune visite prévue : « — », jamais 0 %
  // Aucune ligne ne porte des visites prévues sans site actif (la contradiction du retour 110).
  assert.ok(d.rows.every((r) => r.sitesActive > 0 || !(r.planned > 0)));
  // Les lignes se somment aux chiffres clés (une partition de l'univers).
  const kpi = shape('cov.kpis', DASH).rows[0];
  assert.equal(d.rows.reduce((n, r) => n + r.sitesActive, 0), kpi.sitesActive);
  assert.equal(d.rows.reduce((n, r) => n + r.sitesRealised, 0), kpi.sitesRealised);
  assert.equal(kpi.byData, 10); assert.equal(kpi.byVisit, 25); assert.equal(kpi.upcoming, 5);
  assert.equal(d.meta.n, 100);
  assert.ok(d.meta.definition.startsWith('Couverture = sites suivis ÷ sites actifs'));
  assert.ok(shape('cov.by_activity', DASH, {}, ctx('en')).meta.definition.startsWith('Coverage = monitored sites'));
  assert.ok(d.rows.every((r) => r.coverage == null || r.coverage <= 100));
});

test('filtre d\'activité sur la couverture des tableaux de bord : passé à la requête (groupe d\'activité), par bureau et par district aussi', () => {
  const { SOURCES } = require('../src/modules/reports/sources');
  // La source des tableaux de bord reçoit l'activité : la réponse est la ligne de cette activité.
  const eff = { period: PERIOD, office: 'id:o1', activity: 'Cantine' };
  assert.deepEqual(SOURCES.covDash.params(datasetDef('cov.by_office'), eff, {}), { period: PERIOD, officeId: 'o1', activity: 'Cantine' });
  assert.deepEqual(SOURCES.covDash.params(datasetDef('cov.kpis'), { period: PERIOD }, {}), { period: PERIOD, officeId: null, activity: null });
  // Réponse déjà filtrée (ligne de l'activité) : les jeux la montrent telle quelle, découpages compris.
  const CANTINE = shapeCoverage([
    R({ dim: 'overall', key: null, registry: 90, sites: 80, covered: 30, coveredData: 10, coveredVisit: 25, plannedSites: 40, plannedCovered: 28, visitsPlanned: 40, visitsCovered: 30, knownAll: true }),
    R({ dim: 'activity', key: 'cantine', activityLabel: 'Cantine', registry: 90, sites: 80, covered: 30, coveredData: 10, coveredVisit: 25, plannedSites: 40, plannedCovered: 28, visitsPlanned: 40, visitsCovered: 30 }),
    R({ dim: 'office', key: 'Bureau Sud', registry: 60, sites: 50, covered: 20, coveredData: 5, coveredVisit: 18, plannedSites: 30, plannedCovered: 20, visitsPlanned: 30, visitsCovered: 22 }),
    R({ dim: 'office', key: 'Bureau Nord', registry: 30, sites: 30, covered: 10, coveredData: 5, coveredVisit: 7, plannedSites: 10, plannedCovered: 8, visitsPlanned: 10, visitsCovered: 8 }),
  ], { refMonth: '2026-03' });
  const k = shape('cov.kpis', CANTINE, eff).rows[0];
  assert.equal(k.sitesActive, 80); assert.equal(k.sitesRealised, 30); assert.equal(k.coverage, 37.5);
  assert.equal(kpiDef('sites_active').pick(CANTINE, eff, ctx()).value, 80);
  const offices = shape('cov.by_office', CANTINE, eff).rows;
  assert.deepEqual(offices.map((r) => r.bureau), ['Bureau Sud', 'Bureau Nord']);
  // Σ des bureaux d'une activité = la ligne de cette activité.
  const act = shape('cov.by_activity', CANTINE, eff).rows[0];
  for (const c of ['sitesActive', 'sitesRealised', 'sitesPlanned', 'planned', 'done']) {
    assert.equal(offices.reduce((n, r) => n + r[c], 0), act[c], `Σ bureaux ${c} = ligne de l'activité`);
  }
  // Plus de « Non disponible par activité » : bureau et district prennent le filtre.
  assert.equal(unsupportedNote(datasetDef('cov.by_office'), { activity: 'Cantine' }, 'fr'), null);
  assert.equal(unsupportedNote(datasetDef('cov.by_district'), { activity: 'Cantine' }, 'fr'), null);
  assert.equal(unsupportedNote(datasetDef('cov.by_office'), { office: 'id:o1' }, 'fr'), null);
  assert.equal(shape('cov.by_office', DASH).rows[0].bureau, 'Bureau Sud');
});

test('chiffres clés de couverture (tableaux de bord) et complétude mensuelle (un % par mois, null sans site actif)', () => {
  const eff = { period: PERIOD };
  assert.equal(kpiDef('coverage').source, 'covDash');
  assert.equal(kpiDef('coverage').pick(DASH, eff, ctx()).value, 30);
  assert.equal(kpiDef('execution_rate').pick(DASH, eff, ctx()).value, 75);
  assert.equal(kpiDef('sites_realised').pick(DASH, eff, ctx()).value, 30);
  assert.equal(kpiDef('visits_planned').pick(DASH, eff, ctx()).value, 40);
  assert.equal(kpiDef('planning_rate').pick(DASH, eff, ctx()).value, 40);
  const c = shape('cov.completeness_monthly', COV);
  assert.deepEqual(c.columns.slice(2).map((x) => x.key), ['m:2026-01', 'm:2026-02', 'm:2026-03']);
  assert.equal(c.rows[0]['m:2026-01'], 25); assert.equal(c.rows[0]['m:2026-02'], null); assert.equal(c.rows[0]['m:2026-03'], null);
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('filtres non pris en charge → note, jamais un total national présenté comme celui d\'un bureau', () => {
  assert.equal(unsupportedNote(datasetDef('bud.by_contract'), { office: 'id:o1' }, 'fr'), 'Non disponible par bureau.');
  assert.equal(unsupportedNote(kpiDef('pdd_food'), { office: 'id:o1' }, 'en'), 'Not available by office.');
  // Une clé « libellé / code » de fiche n'a pas de sens pour des faits de sites.
  assert.equal(unsupportedNote(datasetDef('cov.by_activity'), { office: 'code:f:7' }, 'fr'), 'Non disponible pour ce bureau (bureau non relié).');
  assert.equal(unsupportedNote(datasetDef('cov.by_activity'), { office: 'id:o1' }, 'fr'), null);
  assert.equal(unsupportedNote(datasetDef('mon.bureau_compare'), { office: 'code:f:7' }, 'fr'), null);
});

test('bulletin auto : chiffres des chiffres clés, domaines faibles, couverture insuffisante (fr / en)', () => {
  const kpis = { sites_active: 100, sites_realised: 30, coverage: 30, visits_realised: 30, visits_planned: 40, execution_rate: 75, conformity: 61.5 };
  const f = bulletinFindings(MON, DASH);
  assert.deepEqual(f.lowCov, [{ label: 'Nutrition', pct: 0 }]);
  const fr = JSON.stringify(bulletinDoc(kpis, f, 'Janvier à mars 2026'));
  assert.match(fr, /Sur la période janvier à mars 2026/); assert.match(fr, /30 site\(s\) actif\(s\) sur 100/); assert.match(fr, /Nutrition \(0 %\)/);
  const en = JSON.stringify(bulletinDoc(kpis, f, 'January to March 2026', 'en'));
  assert.match(en, /Over the period January to March 2026/); assert.match(en, /30 of 100 active site\(s\)/);
  assert.doesNotMatch(en, /Sur la période|Domaines sous/);
});

test('chiffres clés : « Sites suivis hors mois actif » = outside de la source unique ; groupe sans bureau = « Sans bureau »', () => {
  const OUT = shapeCoverage([
    R({ dim: 'overall', key: null, registry: 10, sites: 6, covered: 2, coveredInactive: 3, coveredInactiveForbidden: 1, knownAll: true }),
    R({ dim: 'office', key: 'Bureau Sud', registry: 6, sites: 4, covered: 2 }),
    R({ dim: 'office', key: '—', registry: 4, sites: 2 }),
    R({ dim: 'activity', key: '—', activityLabel: '—', registry: 4, sites: 2 }),
  ], { refMonth: '2026-03' });
  const k = shape('cov.kpis', OUT).rows[0];
  assert.equal(k.realisedInactive, 3, 'jamais « — » : le total de la source unique');
  assert.equal(datasetDef('cov.kpis').columns.find((c) => c.key === 'realisedInactive').label, 'Sites suivis hors mois actif (non comptés)');
  assert.deepEqual(shape('cov.by_office', OUT).rows.map((r) => r.bureau), ['Bureau Sud', 'Sans bureau']);
  assert.deepEqual(shape('cov.by_office', OUT, {}, ctx('en')).rows.map((r) => r.bureau), ['Bureau Sud', 'No office']);
  assert.deepEqual(shape('cov.by_activity', OUT).rows.map((r) => r.activity), ['Non renseigné']);
});
