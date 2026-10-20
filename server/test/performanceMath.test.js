/**
 * Tableau de bord « Couverture & performance du suivi » (maquette de l'utilisateur, retours
 * 40, 66, 67, 85) — mise en forme PURE, sur des faits synthétiques (aucune base) :
 *  - activités tirées de MEMS (fiches + registre), libellé du modèle quand il existe, ordre ;
 *  - visites classées par le score de visite (règle unique), indice = overallIndex, comme un
 *    calcul d'un seul tenant (computeAll) ;
 *  - mur des indicateurs, bureaux, visites urgentes, signaux, tendance et agents ;
 *  - parité avec le concepteur de rapport (mon.visit_classes, mon.agent_quality) : même calcul.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { pageFacts, mergeAll, mergeVisits } = require('../src/modules/monitoring/indicatorTallies');
const { overallIndex, computeAll, visitScore, classify } = require('../src/modules/monitoring/monitoringMath');
const { datasetDef } = require('../src/modules/reports/catalog');
const M = require('../src/modules/dashboards/performanceMath');

const IND = [
  { id: 'i1', code: 'C1', label: 'Cuisine propre', module: 'D1 Cuisine', sourceField: 'cuisine', agg: 'percent_yes', target: null, direction: 'higher_better' },
  { id: 'i2', code: 'C2', label: 'Stock rangé', module: 'D1 Cuisine', sourceField: 'stock', agg: 'percent_yes', target: null, direction: 'higher_better' },
  { id: 'i3', code: 'G1', label: 'Comité actif', module: 'D2 Gouvernance', sourceField: 'comite', agg: 'percent_yes', target: null, direction: 'higher_better' },
  { id: 'i4', code: 'R1', label: 'Fraude observée', module: 'D2 Gouvernance', sourceField: 'fraude', agg: 'percent_yes', target: null, direction: 'lower_better' },
  { id: 'i5', code: 'K1', label: 'Rations servies', module: 'KPI Chiffres', sourceField: 'rations', agg: 'mean', target: null, direction: 'higher_better', scored: false },
  { id: 'i6', code: 'M1', label: 'Affiche visible', module: 'M1 Visibilité', sourceField: 'affiche', agg: 'percent_yes', target: null, direction: 'higher_better', scored: false },
];

/** Faits d'une fiche (forme de indicatorFacts.formFactsTx) depuis des réponses par groupe. */
function form(id, label, activityCategory, groups, inds = IND) {
  const g = new Map(); const counts = new Map(); const vg = new Map();
  for (const [k, x] of Object.entries(groups)) {
    const month = k.includes('|') ? k.split('|')[1] : k;
    const rows = x.rows.map((data, i) => ({ data, meta: { id: `${id}-${k}-${i}`, month, site: `S${i}`, siteId: null, agent: x.agent || 'A', group: k } }));
    const f = pageFacts(inds, rows, [], { visits: true, keep: 50 });
    g.set(k, f.tallies); vg.set(k, f.visits);
    counts.set(k, { g: k, total: rows.length, ...(x.meta || {}) });
  }
  return {
    id, code: id, label, activityCategory,
    facts: { inds, defs: [], overall: mergeAll([...g.values()], inds.length), groups: g, counts, visitGroups: vg, visits: mergeVisits([...vg.values()], 15) },
  };
}
const good = (n) => Array.from({ length: n }, () => ({ cuisine: 'oui', stock: 'oui', comite: 'oui', fraude: 'non', rations: '10', affiche: 'oui' }));
const bad = (n) => Array.from({ length: n }, () => ({ cuisine: 'non', stock: 'non', comite: 'non', fraude: 'oui', rations: '2', affiche: 'non' }));
const mixed = (n) => Array.from({ length: n }, () => ({ cuisine: 'oui', stock: 'non', comite: 'oui', fraude: 'oui', rations: '5', affiche: 'non' }));
const blank = (n) => Array.from({ length: n }, () => ({ rations: '4' })); // aucune réponse notée : visite sans score

const SUD = { officeStatus: 'relie', officeName: 'Antenne Bekily', officeCode: null };
const CODE7 = { officeStatus: 'non_relie', officeName: null, officeCode: '7', officeFormId: 'f-smp' };
const TEMPLATES = [
  { key: 'GD', label: 'GD / PREVMA', mmrCategory: 'Unconditional resource transfers to support access to food' },
  { key: 'SMP', label: 'SMP · Cantines Scolaires', mmrCategory: 'School meal activities' },
];

const SMP = form('f-smp', 'Cantines', 'School meal activities', {
  'id:o1|2026-01': { meta: SUD, rows: [...good(3), ...bad(1)] },
  'id:o1|2026-02': { meta: SUD, rows: [...mixed(2)] },
  'code:f-smp:7|2026-02': { meta: CODE7, rows: [...bad(2), ...blank(1)] },
});
const GD = form('f-gd', 'Distribution', ' unconditional resource transfers to support ACCESS to food ', {
  'id:o1|2026-02': { meta: SUD, rows: [...good(4)] },
});
const LOOSE = form('f-free', 'Fiche libre', null, { 'vide|2026-02': { meta: { officeStatus: 'vide' }, rows: [...mixed(3)] } });
const EMPTY = form('f-none', 'Fiche vide', null, {});
const REGISTRY = [
  { activity: 'School meal activities', sites: 40 },
  { activity: 'school meal activities ', sites: 2 },
  { activity: 'Asset creation', sites: 9 },
  { activity: 'Nutrition', sites: 30 },
];
const rowsOf = (...lists) => lists.flat().map((data) => ({ data }));

test('activités tirées de MEMS : fiches + registre, libellé du modèle, nature, ordre', () => {
  const list = M.buildActivities({ forms: [SMP, GD, LOOSE, EMPTY], registry: REGISTRY, templates: TEMPLATES });
  assert.deepEqual(list.map((a) => [a.label, a.kind, a.sites, a.forms.length]), [
    ['GD / PREVMA', 'suivie', 0, 1], // modèles d'abord, dans l'ordre du catalogue
    ['SMP · Cantines Scolaires', 'suivie', 42, 1], // catégories réunies sans la casse ni les espaces
    ['Nutrition', 'registre', 30, 0], // puis par nombre de sites
    ['Asset creation', 'registre', 9, 0],
    [null, 'sans', 0, 2], // fiches sans activité en dernier (elles ont des données)
  ]);
  assert.equal(list[0].category, 'unconditional resource transfers to support ACCESS to food');
  assert.equal(list[0].templateKey, 'GD');
  // Sans données, les fiches sans activité ne font pas d'onglet.
  const noData = M.buildActivities({ forms: [EMPTY], registry: [], templates: TEMPLATES });
  assert.deepEqual(noData, []);
  // Un modèle sans fiche ni site n'invente pas d'activité ; avec des sites, il nomme la catégorie.
  const tpl = M.buildActivities({ forms: [], registry: [{ activity: 'School meal activities', sites: 3 }], templates: TEMPLATES });
  assert.deepEqual(tpl.map((a) => [a.label, a.kind, a.templateKey]), [['SMP · Cantines Scolaires', 'modele', 'SMP']]);
});

test('visites : score de chaque visite (règle unique), classes et taux = calcul d\'un seul tenant', () => {
  const a = M.shapeActivity(M.buildActivities({ forms: [SMP], templates: TEMPLATES })[0]);
  const all = rowsOf(good(3), bad(1), mixed(2), bad(2), blank(1));
  const scores = all.map((s) => visitScore(IND, s.data));
  const scored = scores.filter((s) => s.score != null);
  assert.equal(a.visits.n, 9);
  assert.equal(a.visits.scored, 8);
  for (const c of M.BANDS) assert.equal(a.visits.classes[c], scores.filter((s) => s.rating === c).length, c);
  assert.equal(a.visits.meanScore, Math.round((scored.reduce((x, s) => x + s.score, 0) / scored.length) * 10) / 10);
  assert.equal(a.visits.urgentPct, Math.round((a.visits.classes.urg / 8) * 1000) / 10);
  assert.equal(a.visits.naPct, Math.round((1 / 9) * 1000) / 10);
  // Indice = indice de conformité des résultats (overallIndex), comme d'un seul tenant.
  assert.equal(a.index, overallIndex(computeAll(IND, all)));
  assert.equal(a.band, classify({ value: a.index, base: 1, agg: 'percent_yes', target: null, direction: 'higher_better' }));
});

test('parité avec le concepteur (mon.visit_classes) : mêmes visites, mêmes taux', () => {
  const a = M.shapeActivity(M.buildActivities({ forms: [SMP], templates: TEMPLATES })[0]);
  const d = datasetDef('mon.visit_classes').shape({ forms: [SMP] }, { period: { from: '2026-01', to: '2026-02' } }, { lang: 'fr', args: {} });
  const row = d.rows[0];
  assert.equal(row.visits, a.visits.n);
  for (const c of M.BANDS) assert.equal(row[c], a.visits.classes[c]);
  assert.equal(row.urgentPct, a.visits.urgentPct);
  assert.equal(row.naPct, a.visits.naPct);
  assert.equal(row.meanScore, a.visits.meanScore);
});

test('modules, points forts / faibles et mur : indice d\'abord, complémentaires à part, classe unique', () => {
  const a = M.shapeActivity(M.buildActivities({ forms: [SMP], templates: TEMPLATES })[0]);
  assert.deepEqual(a.dims.map((d) => d.name).sort(), ['D1 Cuisine', 'D2 Gouvernance']);
  for (let i = 1; i < a.dims.length; i += 1) assert.ok(a.dims[i - 1].score <= a.dims[i].score, 'du plus faible au plus solide');
  assert.ok(a.dims.every((d) => d.band === M.indexBand(d.score)));
  assert.deepEqual(a.complementary.map((d) => d.name), ['M1 Visibilité']);
  // Mur : tous les indicateurs actifs ; modules de l'indice puis complémentaires.
  assert.equal(a.wall.reduce((s, g) => s + g.n, 0), IND.length);
  assert.deepEqual(a.wall.map((g) => [g.name, g.complementary]), [
    ...a.dims.map((d) => [d.name, false]), ['M1 Visibilité', true], ['KPI Chiffres', true],
  ]);
  assert.deepEqual(a.wall.slice(0, 2).map((g) => g.score), a.dims.map((d) => d.score)); // score du module = celui de dimGroups
  const ref = computeAll(IND, rowsOf(good(3), bad(1), mixed(2), bad(2), blank(1)));
  const fraude = a.wall.flatMap((g) => g.indicators).find((i) => i.code === 'R1');
  assert.equal(fraude.band, classify(ref.find((r) => r.code === 'R1')));
  const rations = a.wall.flatMap((g) => g.indicators).find((i) => i.code === 'K1');
  assert.equal(rations.percent, false);
  assert.equal(rations.reason, 'no_target'); // une moyenne sans cible : valeur affichée, aucune bande
  const affiche = a.wall.flatMap((g) => g.indicators).find((i) => i.code === 'M1');
  assert.equal(affiche.reason, 'not_scored'); // classé, mais hors indice (module complémentaire)
  assert.equal(a.indicatorCount, 6);
  assert.equal(a.indicatorClasses.scored + a.indicatorClasses.na, 4); // 4 indicateurs notés
  // Points faibles : les plus bas sur le score orienté (une fraude rare est un bon résultat).
  assert.equal(a.flop[0].band, M.indexBand(a.flop[0].score));
  assert.ok(a.top.length > 0 && a.top[0].score >= a.top[a.top.length - 1].score);
});

test('bureaux : mois réunis, indice et score moyen propres au bureau ; code non relié nommé avec sa fiche', () => {
  const a = M.shapeActivity(M.buildActivities({ forms: [SMP], templates: TEMPLATES })[0]);
  const o1 = a.bureaux.find((b) => b.key === 'id:o1');
  assert.equal(o1.visits, 6);
  assert.equal(o1.officeId, 'o1');
  assert.equal(o1.name, 'Antenne Bekily');
  assert.equal(o1.index, overallIndex(computeAll(IND, rowsOf(good(3), bad(1), mixed(2)))));
  const c7 = a.bureaux.find((b) => b.key === 'code:f-smp:7');
  assert.deepEqual([c7.status, c7.code, c7.formId, c7.formLabel, c7.visits, c7.scored], ['non_relie', '7', 'f-smp', 'Cantines', 3, 2]);
  assert.deepEqual(a.bureaux.map((b) => b.key), ['id:o1', 'code:f-smp:7']); // indice décroissant
});

test('visites urgentes : les plus faibles d\'abord, avec bureau, mois et fiche', () => {
  const a = M.shapeActivity(M.buildActivities({ forms: [SMP], templates: TEMPLATES })[0]);
  assert.ok(a.urgent.length >= 3);
  for (let i = 1; i < a.urgent.length; i += 1) assert.ok(a.urgent[i - 1].score <= a.urgent[i].score);
  const u = a.urgent.find((x) => x.bureau && x.bureau.key === 'code:f-smp:7');
  assert.equal(u.month, '2026-02');
  assert.equal(u.formLabel, 'Cantines');
  assert.equal(u.bureau.code, '7');
});

test('signaux de risque : visites urgentes, non évaluées, module et indicateurs faibles, fiche sans indicateur', () => {
  const a = M.shapeActivity(M.buildActivities({ forms: [SMP], templates: TEMPLATES })[0]);
  const kinds = a.signals.map((s) => s.kind);
  assert.equal(kinds[0], 'urgent_visits');
  assert.ok(kinds.includes('na_visits'));
  const na = a.signals.find((s) => s.kind === 'na_visits');
  assert.equal(na.tone, 'sat'); // 11,1 % < 20 %
  const weak = a.signals.find((s) => s.kind === 'weak_module');
  assert.equal(weak.module, a.dims[0].name);
  // Fiche qui reçoit des données sans aucun indicateur : le dire (la configurer).
  const noInd = form('f-x', 'Sans indicateur', 'School meal activities', { 'id:o1|2026-01': { meta: SUD, rows: [{ q: '1' }] } }, []);
  const b = M.shapeActivity(M.buildActivities({ forms: [noInd], templates: TEMPLATES })[0]);
  assert.deepEqual(b.signals.map((s) => s.kind), ['na_visits', 'no_indicator']);
  assert.equal(b.visits.classes.na, 1);
  assert.equal(b.index, null);
  assert.equal(b.band, 'na');
});

test('vue d\'ensemble : visites réunies, indice pondéré par les visites notées, fiches sans activité', () => {
  const out = M.shapePerformance({ forms: [SMP, GD, LOOSE, EMPTY], registry: REGISTRY, templates: TEMPLATES });
  const byLabel = new Map(out.activities.map((a) => [a.label, a]));
  const smp = byLabel.get('SMP · Cantines Scolaires');
  const gd = byLabel.get('GD / PREVMA');
  const free = out.activities.find((a) => a.kind === 'sans');
  assert.equal(out.overall.visits.n, 9 + 4 + 3);
  const expected = Math.round(((smp.index * smp.visits.scored + gd.index * gd.visits.scored + free.index * free.visits.scored)
    / (smp.visits.scored + gd.visits.scored + free.visits.scored)) * 10) / 10;
  assert.equal(out.overall.weightedIndex, expected);
  assert.equal(out.overall.band, M.indexBand(expected));
  assert.equal(out.overall.activitiesWithData, 3);
  assert.deepEqual(out.overall.unattachedForms.map((f) => [f.label, f.submissions]), [['Fiche libre', 3], ['Fiche vide', 0]]);
  // Une activité sans visite : mur vide (pas de cellules « — »), aucune pondération.
  const reg = byLabel.get('Nutrition');
  assert.deepEqual([reg.visits.n, reg.wall.length, reg.index], [0, 0, null]);
  assert.equal(M.weightedIndex([{ index: 90, visits: { scored: 0 } }, { index: null, visits: { scored: 5 } }]), null);
  assert.equal(M.weightedIndex([{ index: 80, visits: { scored: 1 } }, { index: 50, visits: { scored: 3 } }]), 57.5);
});

test('tendance : un point par mois de la fenêtre (mois vides compris), indice du mois = calcul d\'un seul tenant', () => {
  const byMonth = form('f-m', 'Cantines', 'School meal activities', {
    '2026-01': { rows: [...good(3), ...bad(1)] },
    '2026-03': { rows: [...mixed(2), ...bad(2)] },
  });
  const rows = M.trendRows([byMonth], ['2025-12', '2026-01', '2026-02', '2026-03']);
  assert.deepEqual(rows.map((r) => [r.month, r.visits]), [['2025-12', 0], ['2026-01', 4], ['2026-02', 0], ['2026-03', 4]]);
  assert.equal(rows[1].index, overallIndex(computeAll(IND, rowsOf(good(3), bad(1)))));
  assert.equal(rows[3].index, overallIndex(computeAll(IND, rowsOf(mixed(2), bad(2)))));
  assert.equal(rows[0].index, null);
  const d = M.trendDelta(rows);
  assert.deepEqual([d.month, d.previousMonth], ['2026-03', '2026-01']); // mois noté précédent, pas le mois vide
  assert.equal(d.delta, Math.round((rows[3].index - rows[1].index) * 10) / 10);
  assert.equal(d.direction, d.delta < 0 ? 'down' : 'up');
  assert.deepEqual(M.trendDelta([]), { month: null, value: null, previousMonth: null, previous: null, delta: null, direction: null });
});

test('qualité de saisie par agent : même décompte que le concepteur (mon.agent_quality) + visites sans score', () => {
  const agents = form('f-a', 'Cantines', 'School meal activities', {
    'raw:Rasoa': { rows: [...good(2), ...blank(2)] },
    'raw:rasoa ': { rows: [...bad(1)] }, // même agent, autre graphie
    'id:ag1': { rows: [...mixed(3)] },
    vide: { rows: [...good(1)] },
  });
  const names = new Map([['id:ag1', 'Haja']]);
  const out = M.agentRows([agents], names);
  const ref = datasetDef('mon.agent_quality').shape({ forms: [agents], agentNames: names }, { period: { from: '2026-01', to: '2026-01' } }, { lang: 'fr', args: {} });
  assert.deepEqual(out.agents.map((r) => [r.visits, r.fill, r.blankPct, r.index]), ref.rows.map((r) => [r.submissions, r.fill, r.blankPct, r.index]));
  const rasoa = out.agents.find((r) => r.key === 'raw:rasoa');
  assert.deepEqual([rasoa.status, rasoa.name, rasoa.visits, rasoa.naPct], ['saisi', 'Rasoa', 5, 40]);
  assert.equal(out.agents.find((r) => r.key === 'id:ag1').name, 'Haja');
  assert.equal(out.agents.find((r) => r.key === 'vide').name, null);
  assert.equal(out.totals.agents, 2); // « non renseigné » n'est pas un agent
  assert.equal(out.totals.visits, 9);
  const fills = out.agents.filter((r) => r.status !== 'vide').map((r) => r.fill);
  assert.equal(out.totals.avgFill, Math.round((fills.reduce((x, y) => x + y, 0) / fills.length) * 10) / 10);
  assert.equal(out.totals.lowFill, fills.filter((f) => f < M.LOW_FILL).length);
  assert.equal(out.totals.completeness, Math.round((7 / 9) * 1000) / 10); // 2 visites sans réponse notée
});

test('agents : un code saisi prend le libellé de la liste de SA fiche ; sans libellé, il reste propre à la fiche', () => {
  const f1 = form('f-1', 'Fiche 1', 'School meal activities', { 'raw:76': { rows: [...good(2)] }, 'raw:77': { rows: [...bad(1)] } });
  const f2 = form('f-2', 'Fiche 2', 'School meal activities', { 'raw:76': { rows: [...mixed(1)] }, 'raw: Haja Danielson': { rows: [...good(1)] } });
  const labels = new Map([['f-1', new Map([['76', 'Haja Danielson']])]]);
  const out = M.agentRows([f1, f2], new Map(), labels);
  const byKey = new Map(out.agents.map((r) => [r.key, r]));
  // « 76 » de la fiche 1 = Haja Danielson (liste de la fiche) : réuni avec le même nom libellé ailleurs ? non —
  // un libellé (lib:) et un nom saisi (raw:) restent deux lignes, mais le code de la fiche 2 n'est jamais mêlé.
  assert.deepEqual([byKey.get('lib:haja danielson').status, byKey.get('lib:haja danielson').name, byKey.get('lib:haja danielson').visits], ['libelle', 'Haja Danielson', 2]);
  assert.deepEqual([byKey.get('code:f-1:77').status, byKey.get('code:f-1:77').code, byKey.get('code:f-1:77').formId], ['non_relie', '77', 'f-1']);
  assert.deepEqual([byKey.get('code:f-2:76').status, byKey.get('code:f-2:76').visits], ['non_relie', 1]); // le 76 de la fiche 2 n'est pas celui de la fiche 1
  assert.deepEqual([byKey.get('raw:haja danielson').status, byKey.get('raw:haja danielson').name], ['saisi', 'Haja Danielson']);
  assert.equal(out.totals.agents, 4);
});
