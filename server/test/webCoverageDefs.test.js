const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { siteCounts, groupRows, shapeCoverage } = require('../src/modules/dashboards/coverageDefinitions');

// Retour 110 — lecture à l'écran des mesures de couverture (web/src/lib/coverageDefs.js, module ES)
// et câblage des deux pages : la Synthèse et « Couverture & performance » lisent la MÊME réponse
// (GET /api/dashboards/coverage) et énoncent le même univers.
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t, ...p) => {
  const file = webFile(...p);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const tr = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

/** Réponse mise en forme par le serveur pour trois sites (deux activités). */
function sample() {
  const mk = (activity, f) => ({ activity, office: 'Toliara', district: 'A', counts: siteCounts({ active: true, activeRef: true, risk: 'moyenne', ...f }) });
  return shapeCoverage(groupRows([
    mk('School meal activities', { realisedAny: true, realised: true, realisedData: true, plannedDue: true, vPlanned: 2, vPlannedRealised: 1, vPlannedVisit: 1, vPlannedData: 1 }),
    mk('School meal activities', { plannedDue: true, vPlanned: 1, due: true }),
    mk('Nutrition treatment activities', { realisedAny: true, realisedData: true }),
  ]).map((r) => (r.dim === 'overall' ? { ...r, communes: 3, communesData: 2, knownAll: true, knownAny: true } : r)), { refMonth: '2026-09' });
}

test('taux : une décimale sous 10 % (0,48 % → « 0,5 % », jamais « 0 % »), « — » sans dénominateur', async (t) => {
  const m = await load(t, 'lib', 'coverageDefs.js'); if (!m) return;
  assert.equal(m.rateText(16 / 3346, 'fr'), '0,5 %');
  assert.equal(m.rateText(16 / 3346, 'en'), '0.5%');
  assert.equal(m.rateText(0.55, 'fr'), '55\u00a0%');
  assert.equal(m.rateText(0, 'fr'), '0\u00a0%');
  assert.equal(m.rateText(null, 'fr'), '—');
  // Décimales choisies après l'arrondi : 9,96 % → « 10 % », jamais « 10,0 % » ; 9,94 % → « 9,9 % ».
  assert.equal(m.rateText(0.0996, 'fr'), '10\u00a0%');
  assert.equal(m.rateText(0.0994, 'fr'), '9,9\u00a0%');
  assert.equal(m.barPct(null), null);
  assert.equal(m.barPct(1.2), 100);
});

test('Centre d\'alertes : l\'exécution du plan (taux des mesures communes) s\'écrit comme sur les pages', async (t) => {
  const a = await load(t, 'lib', 'alerts.js'); if (!a) return;
  assert.equal(a.formatParam({ rate: 16 / 3346 }), '0,5\u00a0%');
  assert.equal(a.formatParam({ rate: null }), '—');
  assert.deepEqual(a.formatParams({ done: 4, planned: 10, p: { rate: 0.4 } }), { done: 4, planned: 10, p: '40\u00a0%' });
  // Prestataire en retard : même mise en forme (« 0,4 % », jamais « 0 % »).
  assert.equal(a.formatParam({ rate: 1 / 250 }), '0,4\u00a0%');
  // Le lien de l'alerte d'exécution porte la période : la Synthèse s'ouvre sur cette période.
  assert.equal(a.goHash({ module: 'processus', sub: 'synthese', period: { from: '2026-01', to: '2026-06' } }), '#/processus/synthese?from=2026-01&to=2026-06');
  assert.equal(a.goHash({ module: 'processus', sub: 'sites' }), null, 'sans période : navigation ordinaire (goArgs)');
  // Plus de 12 mois : « Couverture & performance », période entière lue par l'écran d'arrivée.
  const long = a.goHash({ module: 'dashboard', sub: 'couverture', period: { from: '2025-01', to: '2026-06' } });
  assert.equal(long, '#/dashboard/couverture?from=2025-01&to=2026-06');
  const per = await load(t, 'lib', 'period.js');
  assert.deepEqual(per.readHashPeriod(long), { from: '2025-01', to: '2026-06' });
  assert.equal(a.goHash({ module: 'processus', sub: 'synthese', period: { from: '2026-13', to: '2026-01' } }), null);
  assert.equal(a.goHash(null), null);
});

test('« dont … par données reçues · … par visites déclarées », recouvrement dit, rien sans suivi', async (t) => {
  const m = await load(t, 'lib', 'coverageDefs.js'); if (!m) return;
  assert.equal(m.waysText(tr, { covered: 55, byData: 45, byVisit: 11, both: 1 }),
    'dont 45 par données reçues · 11 par visites déclarées (1 par les deux)');
  assert.equal(m.waysText(tr, { covered: 3, byData: 3, byVisit: 0, both: 0 }), 'dont 3 par données reçues · 0 par visites déclarées');
  assert.equal(m.waysText(tr, { covered: 0, byData: 0, byVisit: 0, both: 0 }), '');
  assert.equal(m.waysText(tr, null), '');
  // À venir : celles des cases vides de la grille (pas encore renseignées) sont dites.
  assert.equal(m.upcomingText(tr, { upcoming: 2, upcomingUnset: 0 }), '2 à venir');
  assert.equal(m.upcomingText(tr, { upcoming: 1, upcomingUnset: 3 }), '4 à venir, dont 3 sur des mois pas encore renseignés dans la grille');
  assert.equal(m.upcomingText(tr, { upcoming: 0, upcomingUnset: 0 }), '');
  // « Sites à jour » : « n (x %) » sur les deux pages ; « — » sans site actif au mois de référence.
  assert.equal(m.upToDateText({ sites: 75, upToDate: 16, rate: 16 / 75 }, 'fr'), '16 (21\u00a0%)');
  assert.equal(m.upToDateText({ sites: 0, upToDate: 0, rate: null }, 'fr'), '—');
  assert.deepEqual(m.upToDateParts({ sites: 1280, upToDate: 1057, rate: 1057 / 1280 }, 'fr', (n) => n.toLocaleString('fr-FR')),
    { n: '1\u202f057', pct: '83\u00a0%' });
  assert.equal(m.upToDateParts({ sites: 0, upToDate: 0, rate: null }, 'fr'), null);
});

test('univers énoncé, plan vs réalisé dans la même unité, tableau par activité = tuiles, bureaux à surveiller', async (t) => {
  const m = await load(t, 'lib', 'coverageDefs.js'); if (!m) return;
  const cov = sample();
  assert.deepEqual(m.universeOf(cov), { kind: 'grid', sites: 3, inactive: 0, forbidden: 0, registry: 3, outside: 0, cancelled: 0, outsideGrid: 0, outsideForbidden: 0 });
  // Sans grille : un site en zone interdite avec une visite réalisée n'est jamais dit « mois sans Oui ».
  const noGrid = m.universeOf({ universe: { activation: 'none', sites: 4, forbidden: 1 }, overall: { outside: 1, outsideForbidden: 1, outsideGrid: 0, execution: {} } });
  assert.deepEqual([noGrid.kind, noGrid.outsideGrid, noGrid.outsideForbidden], ['none', 0, 1]);
  assert.equal(m.universeOf({ universe: { activation: 'none', sites: 5 } }).kind, 'none');
  assert.equal(m.universeOf(null), null);
  const [v, s, c] = m.planVsRealRows(cov);
  assert.deepEqual([v.id, v.planned, v.done], ['visits', 3, 1]);
  assert.deepEqual([s.id, s.planned, s.done], ['sites', 2, 1]);
  assert.deepEqual([c.id, c.planned, c.done], ['communes', 3, 2], 'communes → communes');
  const { rows, total } = m.activityTableRows(cov);
  for (const k of ['sites', 'planned', 'plannedCovered', 'covered', 'byData', 'byVisit']) {
    assert.equal(rows.reduce((n, r) => n + r[k], 0), total[k], `Σ ${k} = total`);
  }
  assert.equal(total.covered, cov.overall.coverage.covered);
  assert.equal(total.coverage, cov.overall.coverage.rate);
  const watch = m.watchList([
    { key: 'a', execution: { planned: 0, covered: 0, rate: null } },
    { key: 'b', execution: { planned: 10, covered: 9, rate: 0.9 } },
    { key: 'c', execution: { planned: 10, covered: 2, rate: 0.2 } },
    { key: 'd', execution: { planned: 4, covered: 3, rate: 0.75 } },
  ]);
  assert.deepEqual(watch.map((g) => g.key), ['c', 'd'], 'sans plan : jamais listé ; les plus faibles d\'abord');
});

test('les deux pages lisent la même réponse (dashboards/coverage), énoncent l\'univers et partagent le tableau par activité', (t) => {
  const pages = [['pages', 'monitoring', 'ProcessDashboardPage.jsx'], ['pages', 'dashboard', 'DashboardCoveragePage.jsx']];
  if (!fs.existsSync(webFile(...pages[0]))) { t.skip('web/ absent'); return; }
  for (const p of pages) {
    const src = fs.readFileSync(webFile(...p), 'utf8');
    assert.match(src, /api\.dashCoverage\(period\)/, `${p.join('/')} : mesures de couverture`);
    assert.doesNotMatch(src, /api\.fieldSummary\(|api\.rbmCounts\(|fetchMapDistricts\(/, `${p.join('/')} : plus de seconde source de couverture`);
    assert.match(src, /<CoverageUniverse cov=/, `${p.join('/')} : univers énoncé`);
    assert.match(src, /<ActivityCoverageCard cov=/, `${p.join('/')} : tableau par activité partagé`);
    assert.match(src, /rateText\(o\.execution\.rate, lang\)/, `${p.join('/')} : taux écrit par rateText (« 0,5 % », jamais « 0 % » pour 0,48 %)`);
    assert.match(src, /upToDateValue\(o && upToDateParts\(o\.rbm, lang, formatInt\)\)/, `${p.join('/')} : « Sites à jour » écrit « n (x %) »`);
    // Le taux en petit dans la valeur (.biz-kpi-value small) : « 1 057 (82,6 %) » ne déborde jamais de la tuile.
    assert.match(src, /const upToDateValue = \(p\) => \(p \? <span className="kpi-split">\{p\.n\} <small>\(\{p\.pct\}\)<\/small><\/span> : '—'\);/, `${p.join('/')} : taux en <small>`);
    assert.match(src, /règle RBM : visite réalisée, données de la commune ou date du registre/, `${p.join('/')} : règle RBM dite`);
    assert.match(src, /<div className="section-gap">/, `${p.join('/')} : pas de second .page dans main.page`);
  }
});

test('mesures de couverture : chaque phrase affichée a sa traduction anglaise', async (t) => {
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const files = [
    ['pages', 'monitoring', 'ProcessDashboardPage.jsx'], ['pages', 'dashboard', 'DashboardCoveragePage.jsx'],
    ['components', 'ActivityCoverageCard.jsx'], ['components', 'CoverageUniverse.jsx'], ['lib', 'coverageDefs.js'],
    ['pages', 'dashboard', 'ReportingPage.jsx'],
  ];
  let checked = 0;
  for (const f of files) {
    const src = fs.readFileSync(webFile(...f), 'utf8');
    for (const [, raw] of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const phrase = raw.replace(/\\'/g, '\'');
      assert.ok(en.default[phrase] !== undefined, `${f.join('/')} : « ${phrase} » sans traduction anglaise`);
      checked += 1;
    }
  }
  assert.ok(checked >= 60, `phrases vérifiées : ${checked}`);
});

test('« Exécution du plan » = UNE définition : le taux des visites déclarées seules porte un autre nom (FR + EN)', async (t) => {
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const field = fs.readFileSync(webFile('pages', 'monitoring', 'FieldVisitsPage.jsx'), 'utf8');
  const docs = fs.readFileSync(webFile('pages', 'monitoring', 'CalcDocsPage.jsx'), 'utf8');
  const phrases = (src) => [...src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, '\''));
  // Affectation & visites : réalisées ÷ (planifiées + réalisées), visites déclarées seulement.
  const fp = phrases(field);
  assert.ok(!fp.some((p) => /exécution du plan/i.test(p) && !/tableaux de bord/.test(p)), 'Affectation & visites : jamais « Exécution du plan » pour le taux des visites déclarées');
  assert.ok(fp.includes('Exécution des visites (déclarées)'));
  // Comment les calculs sont faits : l'exécution du plan des tableaux de bord compte visite OU données ; l'autre taux est nommé.
  const dp = phrases(docs);
  const exec = dp.find((p) => p.startsWith('Exécution du plan (visites)'));
  assert.match(exec, /visite déclarée OU données reçues/);
  assert.ok(dp.some((p) => p.startsWith('Exécution des visites (déclarées)')));
  assert.match(dp.find((p) => p.startsWith('Couverture (sites)')), /OU données reçues/);
  // Suivi de processus › Couverture : taux des visites déclarées (matrice, MMR) — jamais les noms communs.
  const recap = phrases(fs.readFileSync(webFile('pages', 'monitoring', 'CoverageRecapPage.jsx'), 'utf8'));
  for (const p of recap) {
    assert.ok(!/exécution du plan/i.test(p), `Couverture : « ${p} »`);
    assert.ok(!/Couverture \(sites\)/.test(p), `Couverture : « ${p} »`);
  }
  assert.ok(recap.includes('Exécution des visites (déclarées)'));
  assert.ok(recap.includes('Couverture par visites déclarées'));
  for (const p of [...fp, ...dp, ...recap]) assert.ok(en.default[p] !== undefined, `« ${p} » sans traduction anglaise`);
});

test('Couverture & performance : une carte courte n\'est jamais étirée avec sa ligne au milieu (corps aligné en haut, fondu si la liste défile)', (t) => {
  const file = webFile('styles.css');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const css = fs.readFileSync(file, 'utf8');
  assert.match(css, /\.cd-colstack > \.biz-card > \.card-body \{ align-content: start; \}/);
  // « Sites à jour » : le taux en petit peut passer à la ligne (tuile étroite), jamais déborder.
  assert.match(css, /\.biz-kpi-value \.kpi-split \{ white-space: normal; \}/);
  assert.match(css, /\.cd-colstack\.is-fill > \.biz-card:last-child > \.card-body \{ flex: 1 1 0;[^}]*overflow-y: auto;[^}]*mask-image: linear-gradient/);
});

test('Rapport de synthèse : taux du CSV lus comme des nombres par Excel FR ; registre vide dit comme tel', (t) => {
  const file = webFile('pages', 'dashboard', 'ReportingPage.jsx');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const src = fs.readFileSync(file, 'utf8');
  assert.match(src, /const pctOf = \(rate\) => csvPercent\(rate, 1\);/, 'CSV : « 12,3% », jamais « 12.3% »');
  assert.doesNotMatch(src, /Math\.round\(rate \* 1000\) \/ 10\}%/);
  assert.match(src, /cov\.universe\.registry === 0 \?/, 'registre vide : « Aucun site dans le registre », pas la grille');
  assert.match(src, /tr\('Aucun site dans le registre'\)/);
  const card = fs.readFileSync(webFile('components', 'ActivityCoverageCard.jsx'), 'utf8');
  assert.match(card, /const pctOf = \(rate\) => csvPercent\(rate, 1\);/);
});
