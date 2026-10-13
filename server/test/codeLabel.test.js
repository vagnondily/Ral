const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCodeLabel, codeLabelText, mergeByKey } = require('../src/modules/common/codeLabel');

test('bureau rattaché à MEMS : son nom l\'emporte sur le libellé de la fiche', () => {
  const v = resolveCodeLabel({ raw: '6', linkedId: 'o1', linkedName: 'Antenne Ambovombe', choiceLabel: 'Ambovombe', formId: 'f1' });
  assert.deepEqual(v, { key: 'id:o1', name: 'Antenne Ambovombe', status: 'relie', code: '6', formId: null });
  assert.equal(codeLabelText(v), 'Antenne Ambovombe');
});

test('non rattaché mais libellé dans la fiche (liste sav: ou XLSForm) : le libellé', () => {
  const v = resolveCodeLabel({ raw: '7', choiceLabel: 'Tsihombe', formId: 'f1' });
  assert.equal(v.status, 'libelle');
  assert.equal(v.key, 'lib:tsihombe');
  assert.equal(codeLabelText(v), 'Tsihombe');
});

test('un « libellé » identique au code reste un code non relié', () => {
  const v = resolveCodeLabel({ raw: '6', choiceLabel: '6', formId: 'f1' });
  assert.equal(v.status, 'non_relie');
  assert.equal(codeLabelText(v), 'Code 6 (non relié)');
});

test('code seul : « Code N (non relié) » gardé PAR FICHE — le 6 de GD n\'est pas le 6 de Résilience', () => {
  const gd = resolveCodeLabel({ raw: ' 6 ', formId: 'gd' });
  const res = resolveCodeLabel({ raw: '6', formId: 'res' });
  assert.deepEqual(gd, { key: 'code:gd:6', name: null, status: 'non_relie', code: '6', formId: 'gd' });
  assert.notEqual(gd.key, res.key);
  assert.equal(codeLabelText(res, { formLabel: 'Résilience' }), 'Code 6 (non relié) · Résilience');
  assert.equal(codeLabelText(res), 'Code 6 (non relié)');
});

test('libellés identiques à la casse et aux espaces près : même bureau, même d\'une fiche à l\'autre', () => {
  const a = resolveCodeLabel({ raw: '6', choiceLabel: 'AMBOVOMBE', formId: 'f1' });
  const b = resolveCodeLabel({ raw: '1', choiceLabel: ' Ambovombe ', formId: 'f2' });
  assert.equal(a.key, b.key);
});

test('valeur saisie en texte (pas un code numérique) : lue telle quelle, toujours marquée non reliée', () => {
  const v = resolveCodeLabel({ raw: 'Bureau terrain Sud', formId: 'f9' });
  assert.equal(v.status, 'non_relie');
  assert.equal(v.key, 'code:f9:Bureau terrain Sud');
  assert.equal(codeLabelText(v), 'Bureau terrain Sud (non relié)');
});

test('valeur vide : non renseigné', () => {
  for (const raw of ['', '   ', null, undefined]) {
    const v = resolveCodeLabel({ raw, formId: 'f1' });
    assert.equal(v.status, 'vide');
    assert.equal(v.key, 'vide');
    assert.equal(codeLabelText(v), '(non renseigné)');
  }
});

test('mergeByKey additionne les lignes d\'une même clé, sans jamais fusionner deux codes de fiches différentes', () => {
  const rows = [
    { key: 'id:o1', name: 'Antenne Ambovombe', submissions: 3, sites: 2 },
    { key: 'code:gd:6', code: '6', submissions: 5, sites: 1 },
    { key: 'id:o1', name: 'Antenne Ambovombe', submissions: 4, sites: 1 },
    { key: 'code:res:6', code: '6', submissions: 7, sites: 0 },
  ];
  const out = mergeByKey(rows, ['submissions', 'sites']);
  assert.deepEqual(out.map((r) => [r.key, r.submissions, r.sites]), [['id:o1', 7, 3], ['code:gd:6', 5, 1], ['code:res:6', 7, 0]]);
});

test('texte lisible dans la langue du rapport : « Code 7 (not linked) » en anglais, français par défaut', () => {
  const { unattachedText } = require('../src/modules/common/codeLabel');
  const code = resolveCodeLabel({ raw: '7', formId: 'f1' });
  assert.equal(codeLabelText(code, { lang: 'en' }), 'Code 7 (not linked)');
  assert.equal(codeLabelText(code, { lang: 'en', formLabel: 'GD' }), 'Code 7 (not linked) · GD');
  assert.equal(codeLabelText(code, { lang: 'fr' }), 'Code 7 (non relié)');
  assert.equal(codeLabelText(code, { lang: 'xx' }), 'Code 7 (non relié)'); // langue inconnue : français
  assert.equal(codeLabelText(resolveCodeLabel({ raw: 'Bureau Sud', formId: 'f1' }), { lang: 'en' }), 'Bureau Sud (not linked)');
  assert.equal(codeLabelText(resolveCodeLabel({ raw: '', formId: 'f1' }), { lang: 'en' }), '(not set)');
  // Un nom (bureau MEMS ou libellé de la fiche) n'est jamais traduit.
  assert.equal(codeLabelText(resolveCodeLabel({ raw: '7', choiceLabel: 'Tsihombe', formId: 'f1' }), { lang: 'en' }), 'Tsihombe');
  assert.equal(unattachedText('en'), '(not attached)');
  assert.equal(unattachedText(), '(non rattaché)');
  assert.equal(unattachedText('xx'), '(non rattaché)');
});

test('requête SQL du bureau (officeLabelSql) : même règle, paramètres poussés dans l\'ordre, code gardé par fiche', () => {
  const { officeLabelSql } = require('../src/modules/monitoring/monitoring.repository');
  const params = ['t1', 'f1'];
  const o = officeLabelSql({ forms: ['f1'], values: ['6'], names: ['Ambovombe'] }, 's', params);
  assert.deepEqual(params, ['t1', 'f1', ['f1'], ['6'], ['Ambovombe']]);
  assert.match(o.join, /unnest\(\$3::uuid\[\], \$4::text\[\], \$5::text\[\]\)/);
  assert.match(o.join, /fo\.tenant_id = s\.tenant_id/); // jamais le bureau d'un autre compte
  // Ordre des cas = resolveCodeLabel : relié, libellé, code non relié (par fiche), vide.
  assert.match(o.status, /WHEN fo\.id IS NOT NULL THEN 'relie' WHEN .* THEN 'libelle' WHEN .* THEN 'non_relie' ELSE 'vide'/);
  assert.match(o.key, /'code:' \|\| s\.form_id::text \|\| ':'/);
  assert.match(o.key, /'lib:' \|\| lower\(regexp_replace\(/);
});
