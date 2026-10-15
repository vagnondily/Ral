const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Écrans du suivi de processus (front) : règles pures de web/src/lib et garde-fous de
// mise en page lus dans les sources — le front n'a pas encore de suite de tests propre.
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const present = (t, ...p) => {
  if (fs.existsSync(webFile(...p))) return true;
  t.skip('web/ absent');
  return false;
};

/** Déclarations d'une règle CSS (dernière occurrence du sélecteur exact dans `css`). */
function ruleOf(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))];
  return all.length ? all[all.length - 1][1] : null;
}

test('assistant d\'import : taille du fichier dans la langue de l\'interface (« 1,1 Mo » / « 1.1 MB »)', async (t) => {
  if (!present(t, 'lib', 'format.js')) return;
  const f = await import(pathToFileURL(webFile('lib', 'format.js')).href);
  const nb = (s) => s.replace(/ /g, ' ');
  const mb = 1024 * 1024;
  try {
    f.setFormatLocale('fr');
    assert.equal(nb(f.formatFileSize(1.1 * mb)), '1,1 Mo');
    assert.equal(nb(f.formatFileSize(0.05 * mb)), '0,1 Mo');
    assert.equal(nb(f.formatFileSize(20.4 * mb)), '20 Mo'); // entier au-delà de 10
    f.setFormatLocale('en');
    assert.equal(nb(f.formatFileSize(1.1 * mb)), '1.1 MB');
    assert.equal(nb(f.formatFileSize(20.4 * mb)), '20 MB');
    assert.equal(nb(f.formatFileSize(0)), '0.0 MB');
  } finally {
    f.setFormatLocale('fr');
  }
  // L'assistant n'écrit plus « Mo » ni une virgule en dur.
  const src = fs.readFileSync(webFile('pages', 'monitoring', 'ImportWizard.jsx'), 'utf8');
  assert.match(src, /formatFileSize\(file\?\.size/);
  assert.doesNotMatch(src, /\.replace\('\.', ','\)/);
});

test('logique de saut longue : lisible en entier (retour à la ligne + infobulle), jamais coupée par « … »', (t) => {
  if (!present(t, 'pages', 'monitoring', 'VariablePicker.jsx')) return;
  const src = fs.readFileSync(webFile('pages', 'monitoring', 'VariablePicker.jsx'), 'utf8');
  assert.match(src, /<code className="skip-expr" title=\{selected\.relevant\}>\{selected\.relevant\}<\/code>/);
  const rule = ruleOf(fs.readFileSync(webFile('styles.css'), 'utf8'), '.vp-relevant .skip-expr');
  assert.ok(rule, 'règle .vp-relevant .skip-expr');
  assert.match(rule, /white-space:\s*pre-wrap/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
  assert.match(rule, /text-overflow:\s*clip/);
  assert.doesNotMatch(rule, /text-overflow:\s*ellipsis/);
});

test('données d\'une fiche (retour 80) : date sans heure affichée seule, le jour écrit, quel que soit le fuseau', async (t) => {
  if (!present(t, 'lib', 'format.js')) return;
  const f = await import(pathToFileURL(webFile('lib', 'format.js')).href);
  try {
    f.setFormatLocale('fr');
    // Date d'enquête rangée à minuit UTC : jamais « à 03:00 » (Madagascar) ni la veille.
    assert.equal(f.formatCollectDate('2026-06-29T00:00:00.000Z'), '29/06/2026');
    assert.equal(f.formatCollectDate('2026-06-29'), '29/06/2026');
    assert.equal(f.formatCollectDate(new Date(Date.UTC(2026, 0, 1))), '01/01/2026');
    assert.equal(f.isDateOnly('2026-06-29T00:00:00+00:00'), true);
    // Une vraie heure reste affichée (date et heure locales).
    assert.equal(f.isDateOnly('2026-06-29T08:15:00.000Z'), false);
    assert.match(f.formatCollectDate('2026-06-29T08:15:00.000Z'), / à \d{2}:\d{2}$/);
    assert.equal(f.formatCollectDate(null), '—');
    f.setFormatLocale('en');
    assert.equal(f.formatCollectDate('2026-06-29T00:00:00.000Z'), '29/06/2026');
  } finally {
    f.setFormatLocale('fr');
  }
});

test('données d\'une fiche (retour 80) : libellés des zones codées, pages chargées à la demande, jamais de limite silencieuse', (t) => {
  if (!present(t, 'pages', 'monitoring', 'ProcessMonitoringPage.jsx')) return;
  const src = fs.readFileSync(webFile('pages', 'monitoring', 'ProcessMonitoringPage.jsx'), 'utf8');
  // Commune : nom du découpage, sinon libellé de la liste de la fiche, sinon la valeur brute ; « Codes » = brut.
  assert.match(src, /key: 'communeName', alt: \['communeLabel', 'admin3'\], code: 'admin3'/);
  assert.match(src, /key: 'districtName', alt: \['districtLabel', 'admin2'\], code: 'admin2'/);
  assert.match(src, /fmt: \(v\) => formatCollectDate\(v\)/);
  // Pages : offset envoyé, reste dit, suite chargeable ; l'export « tout » charge d'abord le reste.
  assert.match(src, /api\.monFormSubmissions\(form\.id, \{ limit: DV_PAGE, offset: res\.rows\.length \}\)/);
  assert.match(src, /Charger les \{m\} suivantes/);
  assert.match(src, /chargée\(s\) sur \{total\}/);
  assert.match(src, /const all = await fetchRest\(\)/);
  const css = fs.readFileSync(webFile('styles.css'), 'utf8');
  // En-têtes sur deux lignes au plus (plus de bande vide), colonnes de texte bornées.
  assert.ok(ruleOf(css, '.data-grid .dv-th-label').includes('-webkit-line-clamp: 2'));
  assert.match(ruleOf(css, '.data-grid td.dv-meta'), /max-width: 220px/);
});
