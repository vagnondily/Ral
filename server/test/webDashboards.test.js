const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { naReason } = require('../src/modules/monitoring/monitoringMath');

// Règles PURES des tableaux de bord du front (web/src/lib/*.js, modules ES) et
// leurs traductions, testées ici comme webCharts.test.js : le front n'a pas
// encore de suite de tests propre.
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t, ...p) => {
  const file = webFile(...p);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};
const tr = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

test('Centre d\'alertes : jamais « tout au vert » quand une source n\'a pas pu être lue', async (t) => {
  const m = await load(t, 'lib', 'alerts.js'); if (!m) return;
  assert.deepEqual(m.alertsState({ items: [], unavailable: [] }), { status: 'clear', unavailable: [] });
  assert.deepEqual(m.alertsState({ items: [], unavailable: ['terrain'] }), { status: 'partial', unavailable: ['terrain'] });
  assert.deepEqual(m.alertsState({ items: [{ kind: 'x' }], unavailable: ['budget'] }), { status: 'alerts', unavailable: ['budget'] });
  assert.equal(m.alertsState({ items: [{ kind: 'x' }] }).status, 'alerts');
  assert.equal(m.alertsState(null).status, 'clear'); // l'appelant gère « chargement » / « erreur » avant
  assert.equal(m.sourceList(tr, ['budget', 'terrain']), 'Budget, Terrain');
  assert.equal(m.sourceList(tr, ['inconnue']), 'inconnue');
  assert.equal(m.sourceList(tr, undefined), '');
});

test('couverture terrain : « aucun plan » (null) sans visite active, jamais 0 %', async (t) => {
  const m = await load(t, 'lib', 'coverage.js'); if (!m) return;
  // fieldMath renvoie rate = 0 quand rien n'est planifié : ce 0 ne doit jamais s'afficher.
  assert.equal(m.coveragePct({ planifie: 0, realise: 0, annule: 2, active: 0, rate: 0 }), null);
  assert.equal(m.coveragePct({ active: 0, rate: null }), null);
  assert.equal(m.coveragePct(null), null);
  assert.equal(m.coveragePct(undefined), null);
  assert.equal(m.coveragePct({ active: 4, realise: 0, rate: 0 }), 0); // planifié mais rien réalisé : un vrai 0 %
  assert.equal(m.coveragePct({ active: 3, realise: 2, rate: 2 / 3 }), 67);
  assert.equal(m.coveragePct({ active: 4, realise: 1, rate: null }), 25); // taux absent : recalculé
});

test('raisons « Non évalué » : chaque code du serveur a son texte (dont « not_numeric »), traduit en anglais', async (t) => {
  const m = await load(t, 'lib', 'naReasons.js'); if (!m) return;
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const EN = en.default;
  // Codes que monitoringMath.naReason peut renvoyer (lus dans la fonction elle-même : un nouveau code est vu ici).
  const codes = new Set([...naReason.toString().matchAll(/'([a-z]+(?:_[a-z]+)+)'/g)].map((x) => x[1]));
  assert.ok(codes.has('not_numeric') && codes.has('no_target') && codes.has('variable_absent'));
  for (const code of codes) {
    if (code === 'not_scored') continue; // hors indice : compté à part, jamais « Non évalué »
    assert.ok(m.NA_REASONS[code], `raison serveur sans texte à l'écran : ${code}`);
  }
  assert.equal(m.NA_REASONS.not_numeric.label, 'Réponses non numériques : vérifiez la méthode ou la variable');
  assert.equal(m.NA_REASONS.not_numeric.action, 'config');
  for (const [code, r] of Object.entries(m.NA_REASONS)) {
    for (const k of ['label', 'hint', 'actionLabel']) {
      if (r[k]) assert.ok(EN[r[k]], `traduction anglaise manquante (${code}.${k}) : ${r[k]}`);
    }
  }
  // Regroupement du détail d'une fiche : « not_numeric » a sa propre ligne, dans l'ordre fixe.
  const groups = m.groupNaReasons([
    { cls: 'na', reason: 'no_target', label: 'B' },
    { cls: 'na', reason: 'not_numeric', label: 'A', sourceField: 'q1' },
    { cls: 'na', reason: 'not_numeric', label: 'C', scored: false },
    { cls: 'sat', reason: null, label: 'D' },
  ]);
  assert.deepEqual(groups.map((g) => [g.reason, g.indicators.map((i) => i.label)]), [['not_numeric', ['A']], ['no_target', ['B']]]);
  assert.equal(groups[0].showVariable, true);
});

test('tableaux de bord modifiés : chaque phrase affichée a sa traduction anglaise', async (t) => {
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const EN = en.default;
  const files = [
    ['pages', 'dashboard', 'AlertsPage.jsx'], ['components', 'HeaderMenus.jsx'],
    ['pages', 'dashboard', 'ReportingPage.jsx'], ['lib', 'alerts.js'],
  ];
  let checked = 0;
  for (const f of files) {
    const src = fs.readFileSync(webFile(...f), 'utf8');
    // tr('…') avec une chaîne littérale entre apostrophes (\' échappées comprises).
    for (const [, raw] of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const phrase = raw.replace(/\\'/g, '\'');
      assert.ok(EN[phrase] !== undefined, `${f.join('/')} : « ${phrase} » sans traduction anglaise`);
      checked += 1;
    }
  }
  assert.ok(checked >= 40, `phrases vérifiées : ${checked}`);
  for (const label of ['Budget', 'Contrats', 'Rapports', 'Terrain']) assert.ok(EN[label], label);
});
