const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { scoreSite } = require('../src/modules/tpm/rbmScore');

// « Éditer les critères » du RBM (web/src/lib/rbmCriteria.js, module ES pur) : chaque
// raison du panneau « Pourquoi ? » doit pouvoir être corrigée depuis le formulaire, et la
// colonne « Taille » lit la même valeur que le score. Testé ici comme webDashboards.test.js :
// le front n'a pas encore de suite de tests propre.
const webFile = (...p) => path.join(__dirname, '../../web/src', ...p);
const load = async (t, ...p) => {
  const file = webFile(...p);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

// Site où TOUS les critères comptent : la liste complète des raisons possibles.
const EVERY_CRITERION = {
  security: 3, issuesProcess: 1, issuesPartnerReport: 2, issuesCFM: 1, fraud: 1,
  synergies: 1, beneficiaryNumber: 450, newPartner: 1, experiencedPartner: 2,
};

test('« Pourquoi ? » ⇒ « Éditer les critères » : chaque raison se corrige depuis le formulaire', async (t) => {
  const lib = await load(t, 'lib', 'rbmCriteria.js'); if (!lib) return;
  const reasons = scoreSite(EVERY_CRITERION, { targetMonth: '2026-10' }).reasons.map((r) => r.code);
  assert.equal(reasons.length, 9, 'toutes les règles du score ont produit une raison');
  const editable = new Set(lib.RBM_CRITERIA.map((c) => c.key));
  for (const code of reasons) {
    const fields = lib.REASON_FIELDS[code];
    assert.ok(fields && fields.length, `raison « ${code} » sans champ éditable`);
    for (const f of fields) assert.ok(editable.has(f), `raison « ${code} » : champ ${f} absent du formulaire`);
  }
  // Les deux critères qui manquaient au formulaire.
  assert.ok(editable.has('beneficiaryNumber') && editable.has('experiencedPartner'));
  // Expérience du partenaire : 0 / 1 / 2, mêmes libellés que la raison du score.
  const exp = lib.RBM_CRITERIA.find((c) => c.key === 'experiencedPartner');
  assert.deepEqual(exp.options.map(([v]) => v), [0, 1, 2]);
  const r = scoreSite({ experiencedPartner: 1 }, { targetMonth: '2026-10' }).reasons[0];
  assert.equal(exp.options[1][1], r.valueLabel);
});

test('taille (caseload) : la colonne utilise la même entrée que le score (nombre saisi, sinon « > 200 »)', async (t) => {
  const lib = await load(t, 'lib', 'rbmCriteria.js'); if (!lib) return;
  const cases = [
    { beneficiaryNumber: 150, beneficiaryOver200: 1 }, { beneficiaryNumber: 350, beneficiaryOver200: 0 },
    { beneficiaryNumber: 200 }, { beneficiaryNumber: 201 }, { beneficiaryNumber: null, beneficiaryOver200: 1 },
    { beneficiaryNumber: '', beneficiaryOver200: 1 }, { beneficiaryNumber: '0', beneficiaryOver200: 1 }, {},
  ];
  for (const c of cases) {
    assert.equal(lib.caseloadOf(c), scoreSite(c, { targetMonth: '2026-10' }).caseload, JSON.stringify(c));
  }
});

test('formulaire des critères : valeurs initiales et corps du PATCH (nombre vide ⇒ effacé, entier contrôlé)', async (t) => {
  const lib = await load(t, 'lib', 'rbmCriteria.js'); if (!lib) return;
  const form = lib.criteriaForm({ security: 99, fraud: 2, beneficiaryNumber: 320, experiencedPartner: 1, beneficiaryOver200: null });
  assert.equal(form.security, 99);
  assert.equal(form.beneficiaryNumber, '320');
  assert.equal(form.experiencedPartner, 1);
  assert.equal(form.beneficiaryOver200, 0);
  assert.equal(lib.criteriaForm({}).beneficiaryNumber, '', 'non renseigné ⇒ champ vide');

  const { patch } = lib.criteriaPatch({ ...form, beneficiaryNumber: ' 450 ' });
  assert.equal(patch.beneficiaryNumber, 450);
  assert.equal(patch.experiencedPartner, 1);
  assert.equal(patch.security, 99);
  assert.deepEqual(Object.keys(patch).sort(), lib.RBM_CRITERIA.map((c) => c.key).sort());
  assert.equal(lib.criteriaPatch({ ...form, beneficiaryNumber: '' }).patch.beneficiaryNumber, null, 'vide ⇒ null (le choix ≤ 200 / > 200 reprend la main)');
  for (const bad of ['-3', '12.5', 'abc', '10000001']) {
    assert.match(lib.criteriaPatch({ ...form, beneficiaryNumber: bad }).error || '', /Nombre de bénéficiaires/, bad);
  }
});

test('RBM : chaque phrase affichée (pages, formulaire, actions du score) a sa traduction anglaise', async (t) => {
  const en = await load(t, 'locales', 'en.js'); if (!en) return;
  const lib = await load(t, 'lib', 'rbmCriteria.js'); if (!lib) return;
  const EN = en.default;
  const missing = [];
  let checked = 0;
  const need = (phrase, where) => { checked += 1; if (EN[phrase] === undefined) missing.push(`${where} : « ${phrase} »`); };
  for (const f of [['pages', 'monitoring', 'RbmPage.jsx'], ['pages', 'monitoring', 'FieldVisitsPage.jsx'], ['pages', 'monitoring', 'RbmExplain.jsx']]) {
    const src = fs.readFileSync(webFile(...f), 'utf8');
    // tr('…') / tr("…") avec une chaîne littérale (apostrophes échappées comprises).
    for (const [, sq, dq] of src.matchAll(/\btr\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
      need((sq ?? dq).replace(/\\'/g, '\'').replace(/\\"/g, '"'), f.join('/'));
    }
  }
  for (const c of lib.RBM_CRITERIA) {
    need(c.label, c.key);
    if (c.hint) need(c.hint, c.key);
    for (const [, label] of c.options || []) if (!/^[≤>]/.test(label)) need(label, c.key);
  }
  for (const phrase of ['Nombre de bénéficiaires : nombre entier de 0 à 10 000 000 attendu (ou laissez vide).']) need(phrase, 'criteriaPatch');
  const remote = scoreSite({ security: 99, fraud: 1, issuesCFM: 1 }, { targetMonth: '2026-10' });
  for (const a of remote.actions) need(a.label, `action ${a.code}`);
  assert.deepEqual(missing, []);
  assert.ok(checked >= 150, `phrases vérifiées : ${checked}`);
});
