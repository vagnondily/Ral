/**
 * Miroirs web des règles du plan (modules ES purs de web/src/lib, testés ici : le front n'a pas
 * de suite propre) :
 *  - activation.isActiveMonth = siteActivity.isActiveMonth (UNE règle « actif au mois M ») ;
 *  - MMR « Compléter depuis le référentiel » / « Ajouter » : jamais une durée 12 ni un risque 2
 *    inventés — la ligne est « à vérifier » et l'enregistrement exige les deux valeurs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { isActiveMonth } = require('../src/modules/common/siteActivity');

const load = async (t, name) => {
  const file = path.join(__dirname, '../../web/src/lib', name);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('web activation.isActiveMonth = serveur siteActivity.isActiveMonth', async (t) => {
  const web = await load(t, 'activation.js'); if (!web) return;
  for (const grid of [true, false]) for (const v of [true, false, null, undefined]) {
    assert.equal(web.isActiveMonth(v, grid), isActiveMonth(v, grid), `case ${v} · grille ${grid}`);
  }
});

test('MMR : une ligne ajoutée depuis le référentiel est « à vérifier », sans durée ni risque inventés', async (t) => {
  const m = await load(t, 'mmr.js'); if (!m) return;
  const registry = [{ activity: 'Cantines scolaires', n: 12 }, { activity: 'Nutrition', n: 4 }, { activity: 'Vide', n: 0 }];
  const missing = m.missingRegistryCategories(registry, [m.normCat('Nutrition')]);
  assert.deepEqual(missing.map(([, label, n]) => [label, n]), [['Cantines scolaires', 12]]);
  const row = m.newMmrRow('new-1', 'Cantines scolaires', 12);
  assert.equal(row.operationDuration, '');
  assert.equal(row.riskLevel, '');
  assert.equal(row.numberOfSites, 12);
  assert.equal(row.toVerify, true);
  const errs = m.rowErrors(row);
  assert.ok(errs.operationDuration && errs.riskLevel, 'durée et risque exigés avant l\'enregistrement');
  assert.deepEqual(m.rowErrors({ ...row, operationDuration: 10, riskLevel: 3 }), {});
});
