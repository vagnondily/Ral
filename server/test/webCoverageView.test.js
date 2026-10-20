const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { coverageStatus, COVERAGE_THRESHOLDS } = require('../src/modules/common/coverageStatus');
const { siteCounts, groupRows, shapeCoverage } = require('../src/modules/dashboards/coverageDefinitions');

// « Couverture & performance du suivi » d'après la maquette de l'utilisateur (retours 40, 66, 67, 85,
// 101) — fonctions pures de l'écran (web/src/lib/coverageView.js) et traductions des pages
// (web/src/pages/dashboard/coverage/*). La couverture vient des mesures communes (retour 110).
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t, ...p) => {
  const file = webFile(...p);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('verdict d\'une activité : couverture et indice lus ensemble (critique < 40 % ou < 50 ; vigilance < 65), « non évalué » sans rien', async (t) => {
  const m = await load(t, 'lib', 'coverageView.js'); if (!m) return;
  assert.deepEqual(m.verdictOf({ coverage: 0.39, index: 90 }), { level: 'critique', basis: 'both' });
  assert.deepEqual(m.verdictOf({ coverage: 0.9, index: 49 }), { level: 'critique', basis: 'both' });
  assert.deepEqual(m.verdictOf({ coverage: 0.64, index: 90 }), { level: 'vigilance', basis: 'both' });
  assert.deepEqual(m.verdictOf({ coverage: 0.9, index: 64.9 }), { level: 'vigilance', basis: 'both' });
  assert.deepEqual(m.verdictOf({ coverage: 0.65, index: 65 }), { level: 'satisfaisant', basis: 'both' });
  assert.deepEqual(m.verdictOf({ coverage: null, index: 70 }), { level: 'satisfaisant', basis: 'index' });
  assert.deepEqual(m.verdictOf({ coverage: 0.2, index: null }), { level: 'critique', basis: 'coverage' });
  assert.deepEqual(m.verdictOf({}), { level: 'na', basis: 'none' });
});

test('couverture d\'une activité et des bureaux : lue dans les mesures communes (même clé que le serveur)', async (t) => {
  const m = await load(t, 'lib', 'coverageView.js'); if (!m) return;
  const mk = (activity, office, f) => ({ activity, office, district: 'A', counts: siteCounts({ active: true, activeRef: true, ...f }) });
  const cov = shapeCoverage(groupRows([
    mk('School meal activities', 'Toliara', { realisedAny: true, realised: true }),
    mk('school  meal activities ', 'Toliara', { realisedAny: true, realisedData: true }),
    mk('Nutrition treatment activities', '', {}),
  ]), { refMonth: '2026-09' });
  const sm = m.activityCoverage(cov, '  School Meal  Activities');
  assert.deepEqual([sm.active, sm.realised, sm.byData, sm.byVisit, sm.rate], [2, 2, 1, 1, 1]);
  assert.equal(m.activityCoverage(cov, 'Nutrition treatment activities').rate, 0);
  assert.equal(m.activityCoverage(cov, 'Inconnue'), null);
  assert.equal(m.activityCoverage(null, 'X'), null);
  assert.deepEqual(m.groupCoverage(cov.overall).active, 3);
  const offices = m.officeCoverageByName(cov);
  assert.deepEqual([...offices.keys()], ['toliara', '—']);
  assert.deepEqual([offices.get('toliara').realised, offices.get('toliara').active], [2, 2]);
  assert.equal(m.coverageKeyOf(' A  b '), 'a b');
});

test('statut d\'un taux de couverture : jumeau exact de common/coverageStatus (≥ 80 / 60 / 30 %), null sans taux', async (t) => {
  const m = await load(t, 'lib', 'coverageView.js'); if (!m) return;
  assert.deepEqual({ ...m.COVERAGE_THRESHOLDS }, { ...COVERAGE_THRESHOLDS });
  for (const r of [0, 0.29, 0.3, 0.59, 0.6, 0.79, 0.8, 1, null]) assert.equal(m.coverageStatusKey(r), coverageStatus(r), String(r));
  assert.equal(m.coverageStatusOf(null), null);
  assert.equal(m.coverageStatusOf(0.85).label, 'Bon');
});

test('signaux de sites, ordre des signaux, onglets, flèche de tendance, dernier mois de données, valeur d\'indicateur', async (t) => {
  const m = await load(t, 'lib', 'coverageView.js'); if (!m) return;
  assert.deepEqual(m.siteSignals({ highUntouched: 2, neverVisited: 5 }).map((s) => [s.kind, s.tone]), [['high_untouched', 'urg'], ['never_visited', 'imp']]);
  assert.deepEqual(m.siteSignals(null), []);
  assert.deepEqual(m.sortSignals([{ kind: 'a', tone: 'sat' }, { kind: 'b', tone: 'urg' }, { kind: 'c', tone: 'imp' }]).map((s) => s.kind), ['b', 'c', 'a']);
  assert.equal(m.isTabActivity({ kind: 'suivie' }), true);
  assert.equal(m.isTabActivity({ kind: 'registre' }), false);
  assert.deepEqual(m.trendArrow({ delta: 2.5 }), { arrow: '↑', tone: 'up', word: 'en hausse', delta: 2.5 });
  assert.equal(m.trendArrow({ delta: -1 }).tone, 'down');
  assert.equal(m.trendArrow(null).delta, null);
  const periods = { months: [{ month: '2026-05', byForm: { f1: 3 } }, { month: '2026-07', byForm: { f2: 1 } }, { month: '2026-11', future: true, byForm: { f1: 9 } }] };
  assert.equal(m.lastDataMonth(periods, ['f1']), '2026-05');
  assert.equal(m.lastDataMonth(periods, ['zz']), null);
  assert.equal(m.indicatorValueText({ value: 72.6, agg: 'percent_yes' }), '73%');
  assert.equal(m.indicatorValueText({ value: 4.2, agg: 'mean' }, (v) => `n${v}`), 'n4.2');
  assert.equal(m.indicatorValueText(null), '—');
  assert.equal(m.pctOfRate(0.123), 12.3);
});

test('tableau de bord d\'après la maquette : chaque phrase affichée a sa traduction anglaise', async (t) => {
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const dir = webFile('pages', 'dashboard', 'coverage');
  const files = [...fs.readdirSync(dir).filter((f) => /\.(jsx|js)$/.test(f)).map((f) => path.join(dir, f)),
    webFile('pages', 'dashboard', 'DashboardCoveragePage.jsx'), webFile('lib', 'coverageView.js')];
  let checked = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [, raw] of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const phrase = raw.replace(/\\'/g, '\'');
      assert.ok(en.default[phrase] !== undefined, `${path.basename(file)} : « ${phrase} » sans traduction anglaise`);
      checked += 1;
    }
  }
  // Libellés tirés de tables (verdicts, pages, publics, décisions) : traduits aussi.
  const m = await load(t, 'lib', 'coverageView.js'); if (!m) return;
  for (const v of Object.values(m.VERDICTS)) for (const k of ['label', 'action', 'text']) assert.ok(en.default[v[k]] !== undefined, v[k]);
  for (const b of m.BAND_RULES) assert.ok(en.default[b.decision] !== undefined, b.decision);
  // Pages et publics (activityMeta.PAGES, lus dans la source : le module importe les icônes).
  const meta = fs.readFileSync(path.join(dir, 'activityMeta.js'), 'utf8');
  const pageTexts = [...meta.matchAll(/\b(?:label|audience): '((?:[^'\\]|\\.)*)'/g)].map((x) => x[1].replace(/\\'/g, '\''));
  assert.ok(pageTexts.length >= 18, `pages et publics : ${pageTexts.length}`);
  for (const p of pageTexts) assert.ok(en.default[p] !== undefined, p);
  assert.ok(checked >= 150, `phrases vérifiées : ${checked}`);
});
