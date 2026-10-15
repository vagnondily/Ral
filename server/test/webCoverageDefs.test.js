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
  assert.equal(m.barPct(null), null);
  assert.equal(m.barPct(1.2), 100);
});

test('« dont … par données reçues · … par visites déclarées », recouvrement dit, rien sans suivi', async (t) => {
  const m = await load(t, 'lib', 'coverageDefs.js'); if (!m) return;
  assert.equal(m.waysText(tr, { covered: 55, byData: 45, byVisit: 11, both: 1 }),
    'dont 45 par données reçues · 11 par visites déclarées (1 par les deux)');
  assert.equal(m.waysText(tr, { covered: 3, byData: 3, byVisit: 0, both: 0 }), 'dont 3 par données reçues · 0 par visites déclarées');
  assert.equal(m.waysText(tr, { covered: 0, byData: 0, byVisit: 0, both: 0 }), '');
  assert.equal(m.waysText(tr, null), '');
});

test('univers énoncé, plan vs réalisé dans la même unité, tableau par activité = tuiles, bureaux à surveiller', async (t) => {
  const m = await load(t, 'lib', 'coverageDefs.js'); if (!m) return;
  const cov = sample();
  assert.deepEqual(m.universeOf(cov), { kind: 'grid', sites: 3, inactive: 0, forbidden: 0, registry: 3 });
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
  }
});

test('mesures de couverture : chaque phrase affichée a sa traduction anglaise', async (t) => {
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const files = [
    ['pages', 'monitoring', 'ProcessDashboardPage.jsx'], ['pages', 'dashboard', 'DashboardCoveragePage.jsx'],
    ['components', 'ActivityCoverageCard.jsx'], ['components', 'CoverageUniverse.jsx'], ['lib', 'coverageDefs.js'],
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
