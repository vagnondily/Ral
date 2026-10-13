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
