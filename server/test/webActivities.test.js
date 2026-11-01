/**
 * Écran — activités de programme (migration 105) : la clé du navigateur (web/src/lib/activityKey.js)
 * est la jumelle exacte de celle du serveur et de PostgreSQL (mêmes tables d'accents, même résultat
 * sur des graphies variées) ; chaque phrase des nouveaux écrans a sa traduction anglaise.
 * Testé ici comme webDashboards.test.js : le front n'a pas de suite de tests propre.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const server = require('../src/modules/programmes/activityKey');

const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t, ...p) => {
  const file = webFile(...p);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

const LABELS = [
  'School meal activities', 'SCHOOL-MEAL activities', 'Distribution générale', 'Création d’actifs (FFA)',
  'Prévention MAM', 'ÎLES & CÔTES', 'été', 'İstanbul', 'Ÿ ŒUVRE', '', null, undefined, '  GD  ', 'PREV-MA', 42,
];

test('clé du navigateur = clé du serveur (tables d\'accents et résultats)', async (t) => {
  const web = await load(t, 'lib', 'activityKey.js'); if (!web) return;
  assert.equal(web.ACCENTS_FROM, server.ACCENTS_FROM);
  assert.equal(web.ACCENTS_TO, server.ACCENTS_TO);
  for (const l of LABELS) assert.equal(web.activityKey(l), server.activityKey(l), JSON.stringify(l));
});

test('Paramétrage › Activités et listes de saisie : chaque phrase a sa traduction anglaise', (t) => {
  const files = [webFile('pages', 'settings', 'ActivitiesSection.jsx'), webFile('components', 'ActivitySelect.jsx'), webFile('lib', 'programmeActivities.js')];
  if (!files.every((f) => fs.existsSync(f))) { t.skip('web/ absent'); return; }
  const dict = new Set();
  for (const f of fs.readdirSync(webFile('locales', 'en'))) {
    const txt = fs.readFileSync(webFile('locales', 'en', f), 'utf8');
    for (const m of txt.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) dict.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  const phrases = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\btr\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) phrases.add(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  // Libellés de tables passés à tr() par variable (titres « Utilisé par », sources d'alias, comptes).
  for (const k of ['Sites', 'Exigences MMR', 'Fiches de suivi', 'Visites de terrain', 'Lignes du PDD', 'ancien libellé', 'code', 'graphie reliée',
    '{n} site', '{n} sites', '{n} exigence MMR', '{n} exigences MMR', '{n} fiche de suivi', '{n} fiches de suivi',
    '{n} visite de terrain', '{n} visites de terrain', '{n} ligne du PDD', '{n} lignes du PDD']) phrases.add(k);
  const missing = [...phrases].filter((p) => !dict.has(p));
  assert.deepEqual(missing, []);
});
