/**
 * Registre du concepteur de rapport (lot 7a) : clés uniques, sources existantes, vues /
 * filtres / mode de période déclarés, jeux indisponibles avec leur raison, et chaque mise
 * en forme supporte une source VIDE (aucune donnée) sans erreur, en français et en anglais.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DATASETS, KPIS, GROUPS, checkRegistry, validateBlockParams, catalogForClient } = require('../src/modules/reports/catalog');
const { SOURCES } = require('../src/modules/reports/sources');
const { shapeCoverageFacts, buildCoverageMatrix } = require('../src/modules/tpm/fieldMath');
const { coverageRecap } = require('../src/modules/tpm/coverageRecap');
const { shapeCoverage } = require('../src/modules/dashboards/coverageDefinitions');

const EMPTY = {
  monForms: { forms: [] },
  monData: { totals: {}, byBureau: [], trend: [], regions: [] },
  monAgents: { forms: [], agentNames: new Map() },
  monSubmissions: [],
  covFacts: { ...shapeCoverageFacts([]), byProvider: [] },
  covDash: shapeCoverage([], { refMonth: '2026-03' }),
  covMatrix: { byActivity: buildCoverageMatrix([], ['2026-01']), byProvider: buildCoverageMatrix([], ['2026-01']) },
  covRecap: coverageRecap([]),
  collectionDays: [],
  monthsOverview: { year: 2026, months: [] },
  planBoard: { year: 2026, sites: [] },
  rbmSites: [],
  mmr: [],
  consolidation: { rows: [], totals: {}, months: [], monthlyTotals: [], today: '2026-03' },
  contracts: [],
  contractDetail: null,
  contractForecast: null,
  amendments: [],
  tpmReports: [],
  tpmPlans: [],
  tpmProviders: [],
  tpmEvaluations: [],
  formations: [],
  partnerSheet: null,
  partnerTimeline: null,
  invoice: null,
  pddTotals: { distributions: 0, beneficiaries: 0, households: 0, cash: 0, food: 0 },
  pddByMonth: [],
  pddSummary: { total: { lines: 0, byCommodity: {} }, byHazard: {}, byMonth: {}, byZone: [] },
  pddPipeline: [],
  alerts: { today: '2026-03-31', counts: { critical: 0, warning: 0, info: 0, total: 0 }, items: [], unavailable: [] },
  health: { rules: [], summary: {} },
  linking: {},
};

test('registre : clés uniques et bien formées, groupes connus, aucune erreur de déclaration', () => {
  assert.deepEqual(checkRegistry(Object.values(DATASETS), Object.values(KPIS)), []);
  const groups = new Set(GROUPS.map((g) => g.key));
  for (const d of Object.values(DATASETS)) assert.ok(groups.has(d.group), d.key);
  // Suivi, couverture et RBM (C4) : 42 jeux ; budget, contrats, TPM, PDD, alertes, carte et qualité (C5).
  const keys = Object.keys(DATASETS);
  assert.ok(keys.filter((k) => /^(mon|cov|plan|rbm|sites)\./.test(k)).length >= 42, `${keys.length} jeux`);
  assert.ok(keys.filter((k) => /^(bud|ctr|tpm|pdd|alerts|map|quality)\./.test(k)).length >= 29, `${keys.length} jeux`);
  assert.ok(Object.keys(KPIS).length >= 38);
});

test('chaque jeu et chaque chiffre clé cite une source existante qui déclare ses domaines et ses paramètres', () => {
  for (const d of [...Object.values(DATASETS), ...Object.values(KPIS)]) {
    if (d.available === false) { assert.ok(d.reason, `${d.key} : raison`); continue; }
    const s = SOURCES[d.source];
    assert.ok(s, `${d.key} : source ${d.source}`);
    assert.ok(Array.isArray(s.domains) && s.domains.length, `${d.source} : domaines`);
    assert.equal(typeof s.params, 'function'); assert.equal(typeof s.load, 'function');
    assert.ok(['range', 'asOf', 'year', 'now'].includes(d.periodMode), `${d.key} : mode de période`);
  }
});

test('alertes : la source déclare au moins les domaines de la couverture qu\'elle lit (grille, données, bureaux)', () => {
  for (const d of SOURCES.covDash.domains) assert.ok(SOURCES.alerts.domains.includes(d), `alerts : domaine ${d}`);
  assert.ok(SOURCES.alerts.domains.includes('budget'));
});

test('mises en forme : une source vide ne casse aucun jeu (fr et en), colonnes et n présents', () => {
  for (const d of Object.values(DATASETS)) {
    if (d.available === false) continue;
    assert.ok(Object.prototype.hasOwnProperty.call(EMPTY, d.source), `source vide manquante : ${d.source}`);
    for (const lang of ['fr', 'en']) {
      const out = d.shape(EMPTY[d.source], { period: { from: '2026-01', to: '2026-03' } }, { lang, args: {}, officeParents: new Map() });
      assert.ok(Array.isArray(out.columns) && out.columns.length, `${d.key} : colonnes`);
      assert.ok(Array.isArray(out.rows), `${d.key} : lignes`);
    }
  }
});

test('chiffres clés : une source vide donne null ou 0, jamais une erreur', () => {
  for (const k of Object.values(KPIS)) {
    if (k.available === false) continue;
    const r = k.pick(EMPTY[k.source], { period: { from: '2026-01', to: '2026-03' } }, { lang: 'fr', officeParents: new Map() });
    assert.ok(r && (r.value == null || Number.isFinite(r.value)), k.key);
  }
});

test('paramètres d\'un bloc : vue permise, argument requis, choix d\'énumération', () => {
  const card = DATASETS['mon.indicator_card'];
  assert.deepEqual(validateBlockParams(card, { dataset: card.key, view: 'card', args: {} }).map((i) => i.path.join('.')), ['args.indicatorId']);
  assert.equal(validateBlockParams(card, { dataset: card.key, view: 'heat', args: { indicatorId: '11111111-1111-1111-1111-111111111111' } })[0].path[0], 'view');
  const reg = DATASETS['sites.registry'];
  assert.equal(validateBlockParams(reg, { dataset: reg.key, args: { by: 'district' } }).length, 0);
  assert.equal(validateBlockParams(reg, { dataset: reg.key, args: { by: 'planète' } })[0].path.join('.'), 'args.by');
});

test('catalogue publié : jeux indisponibles marqués avec leur raison ; origine et bureaux filtrables', () => {
  const c = catalogForClient();
  assert.equal(c.kpis.visits_unplanned.available, false);
  assert.equal(c.kpis.visits_unplanned.reason, 'Disponible avec le lot 4');
  assert.deepEqual(c.datasets['cov.by_office'].officeKinds, ['id', 'unlinked']);
  assert.ok(c.datasets['mon.bureau_compare'].officeKinds.includes('code'));
  assert.ok(c.datasets['cov.by_activity'].origin.page);
  assert.deepEqual(c.datasets['cov.by_activity'].annotate, { label: 'Constat' });
});
