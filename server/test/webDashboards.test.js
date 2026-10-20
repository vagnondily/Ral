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

test('Centre d\'alertes sur téléphone (320–390 px) : la catégorie passe à la ligne, jamais tronquée en « C… »', (t) => {
  const file = webFile('styles.css');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const css = fs.readFileSync(file, 'utf8');
  // Bloc « téléphone » du tableau des alertes (cartes empilées).
  const start = css.indexOf('@media (max-width: 640px) {\n  .alerts-table thead');
  assert.ok(start >= 0, 'bloc téléphone du Centre d\'alertes');
  const block = css.slice(start, css.indexOf('\n}', start));
  const rule = (sel) => {
    const m = block.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : '';
  };
  // Ligne flexible : la catégorie suit le niveau quand elle tient, sinon elle passe sur sa propre ligne.
  assert.match(rule('.alerts-table tbody tr'), /flex-wrap:\s*wrap/);
  const cat = rule('.alerts-table td.al-cat');
  assert.match(cat, /min-width:\s*min-content/);
  assert.match(cat, /white-space:\s*normal/);
  assert.doesNotMatch(cat, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(cat, /overflow:\s*hidden/);
  // Titre et détail prennent toute la ligne ; « Ouvrir » reste à droite (place réservée).
  assert.match(rule('.alerts-table td.al-title'), /flex:\s*1 1 100%/);
  assert.match(rule('.alerts-table td.al-go'), /position:\s*absolute/);
  assert.match(rule('.alerts-table tbody tr'), /padding:\s*12px 52px 12px 14px/);
});

test('Couverture & performance (retours 85, 101) : période et bureau séparés, activité sans indicateur expliquée, cartes d\'une rangée à la même hauteur', async (t) => {
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const dir = webFile('pages', 'dashboard', 'coverage');
  const tpl = fs.readFileSync(path.join(dir, 'CoverageTemplate.jsx'), 'utf8');
  // La mention de session est sous la ligne de période ; le bureau à part.
  assert.match(tpl, /<div className="cd-headbar-period">\s*<PeriodBanner[^>]*\/>\s*<SessionPeriodNote/);
  // Activité sans indicateur : une explication et la marche à suivre (configuration ou modèle d'activité, par fiche).
  const act = fs.readFileSync(path.join(dir, 'ActivityView.jsx'), 'utf8');
  assert.match(act, /if \(!a\.indicatorCount\) \{/);
  assert.match(act, /Aucun indicateur n\\'est encore configuré pour cette activité/);
  assert.match(act, /go\(f\.id, 'config'\)/);
  assert.match(act, /go\(f\.id, 'modele'\)/);
  for (const src of [tpl, act]) {
    for (const [, raw] of src.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const phrase = raw.replace(/\\'/g, '\'');
      assert.ok(en.default[phrase] !== undefined, `« ${phrase} » sans traduction anglaise`);
    }
  }
  // Rangées : cartes à la même hauteur, la carte secondaire défile (jamais une carte étirée à vide seule).
  const css = fs.readFileSync(path.join(dir, 'coverage.css'), 'utf8');
  assert.match(css, /\.cvt-row \{ display: grid; gap: 16px; align-items: stretch; \}/);
  assert.match(css, /\.cvt-row > \.cvt-card\.is-fill > \.cvt-card-b \{ flex: 1 1 0; min-height: 0; overflow-y: auto; \}/);
  const styles = fs.readFileSync(webFile('styles.css'), 'utf8');
  assert.match(styles, /\.period-session-note \{ display: flex;/);
  // La page n'ajoute pas un second .page dans main.page (audit du 16/10).
  assert.match(fs.readFileSync(webFile('pages', 'dashboard', 'DashboardCoveragePage.jsx'), 'utf8'), /<div className="section-gap">/);
  // Fiche ouverte sur son modèle d'activité (« Appliquer le modèle d'activité »).
  const pm = fs.readFileSync(webFile('pages', 'monitoring', 'ProcessMonitoringPage.jsx'), 'utf8');
  assert.match(pm, /initialTab === 'modele' \? 'config'/);
});

test('commentaires du front : chaque test cité existe (server/test/…)', (t) => {
  const dir = webFile('lib');
  if (!fs.existsSync(dir)) { t.skip('web/ absent'); return; }
  let cited = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const [, name] of src.matchAll(/server\/test\/([\w.-]+\.test\.js)/g)) {
      assert.ok(fs.existsSync(path.join(__dirname, name)), `web/src/lib/${f} cite server/test/${name}, introuvable`);
      cited += 1;
    }
  }
  assert.ok(cited >= 2, `tests cités : ${cited}`);
});
