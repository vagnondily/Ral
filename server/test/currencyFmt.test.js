const { test } = require('node:test');
const assert = require('node:assert/strict');
const { currencySuffix, moneyNumFmt } = require('../src/modules/common/currencyFmt');
const { buildTemplateWorkbook } = require('../src/modules/tpm/postesXlsx');

test('currencySuffix : symbole local connu, sinon le code, vide si non renseignée', () => {
  assert.equal(currencySuffix('MGA'), 'Ar');
  assert.equal(currencySuffix('usd'), '$');
  assert.equal(currencySuffix('EUR'), '€');
  assert.equal(currencySuffix('KES'), 'KSh');
  assert.equal(currencySuffix('ZZZ'), 'ZZZ'); // inconnue → le code
  assert.equal(currencySuffix(''), '');
  assert.equal(currencySuffix(null), '');
});

test('moneyNumFmt : format Excel avec le suffixe, ou sans si non renseignée', () => {
  assert.equal(moneyNumFmt('MGA'), '#,##0 "Ar"');
  assert.equal(moneyNumFmt('USD'), '#,##0 "$"');
  assert.equal(moneyNumFmt(null), '#,##0');
});

test('le modèle de postes applique la devise reçue (format des montants)', async () => {
  const usd = buildTemplateWorkbook({ currency: 'USD' });
  const ar = buildTemplateWorkbook({ currency: 'MGA' });
  const plain = buildTemplateWorkbook(); // sans devise → défaut « Ar »
  // Les cellules de montant (colonne E) du modèle sont formatées même vides : on lit directement.
  const moneyFmts = (wb) => {
    const ws = wb.getWorksheet('Postes') || wb.worksheets[wb.worksheets.length - 1];
    const out = [];
    for (let r = 1; r <= 40; r += 1) { const f = ws.getCell(`E${r}`).numFmt; if (f && /#,##0/.test(f)) out.push(f); }
    return out;
  };
  assert.ok(moneyFmts(usd).some((f) => f.includes('$')), 'USD → $ dans le format des montants');
  assert.ok(moneyFmts(ar).some((f) => f.includes('Ar')), 'MGA → Ar');
  assert.ok(moneyFmts(plain).some((f) => f.includes('Ar')), 'défaut → Ar (comportement actuel)');
});
