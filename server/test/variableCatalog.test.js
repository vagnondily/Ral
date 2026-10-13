const test = require('node:test');
const assert = require('node:assert/strict');
const { describeVariables, resolveVariable, optionParentName } = require('../src/modules/monitoring/variableCatalog');

// Extrait du XLSForm GD réel : une question à choix multiples, une question oui/non, une liste longue.
const catalog = [
  { name: 'MODistPtsDign', label: 'Éléments mis en place pour une distribution digne ?', type: 'select_multiple DistPtElementsDignity', group: 'Technique › Conditions', listName: 'DistPtElementsDignity' },
  { name: 'MOInfoSession', label: 'Séances d\'information', type: 'select_one', group: 'Technique › Qualité', listName: 'Yesnona' },
  { name: 'Commune', label: 'Commune', type: 'select_one', listName: 'communes' },
  { name: 'HHSize', label: 'Taille du ménage', type: 'integer' },
];
const choicesByList = new Map([
  ['DistPtElementsDignity', [{ value: '1', label: 'Contrôle des foules' }, { value: '2', label: 'Places assises' }, { value: '3', label: 'Ombre' }]],
  ['Yesnona', [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }, { value: '9999', label: 'Sans objet' }]],
  ['communes', Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: `Commune ${i}` }))],
]);

test('colonnes éclatées des choix multiples (« X.1 » SPSS, « X/2 » Excel) libellées « question — choix »', () => {
  const vars = describeVariables({
    catalog, choicesByList,
    dataKeys: ['MODistPtsDign', 'MODistPtsDign.1', 'MODistPtsDign/2', 'MODistPtsDign.10', 'mohinfosession', '_uuid', 'SvyDate'],
  });
  const o1 = vars.find((v) => v.name === 'MODistPtsDign.1');
  assert.equal(o1.kind, 'option');
  assert.equal(o1.label, 'Éléments mis en place pour une distribution digne ? — Contrôle des foules');
  assert.equal(o1.parent, 'MODistPtsDign');
  assert.equal(o1.choice, '1');
  assert.equal(o1.group, 'Technique › Conditions');
  assert.deepEqual(o1.choices.map((c) => c.value), ['1', '0']); // 1 = coché, 0 = non coché
  assert.equal(vars.find((v) => v.name === 'MODistPtsDign/2').label, 'Éléments mis en place pour une distribution digne ? — Places assises');
  // Choix absent de la liste (ex. 10 ajouté après coup) : libellé de la question + code.
  assert.equal(vars.find((v) => v.name === 'MODistPtsDign.10').label, 'Éléments mis en place pour une distribution digne ? — 10');
  // Colonnes des seules données : « data », sans libellé ; la question parente n'est pas dupliquée.
  assert.equal(vars.find((v) => v.name === '_uuid').kind, 'data');
  assert.equal(vars.filter((v) => v.name.toLowerCase() === 'modistptsdign').length, 1);
});

test('questions : libellé, type, groupe ; listes de choix longues non jointes', () => {
  const vars = describeVariables({ catalog, choicesByList });
  const info = vars.find((v) => v.name === 'MOInfoSession');
  assert.equal(info.kind, 'question');
  assert.deepEqual(info.choices, [{ value: '0', label: 'Non' }, { value: '1', label: 'Oui' }, { value: '9999', label: 'Sans objet' }]);
  assert.deepEqual(vars.find((v) => v.name === 'Commune').choices, []); // 60 choix > 40
  assert.equal(describeVariables({ catalog, choicesByList, maxChoices: 100 }).find((v) => v.name === 'Commune').choices.length, 60);
  assert.equal(vars.find((v) => v.name === 'HHSize').type, 'integer');
});

test('« X.k » sans parent à choix multiples : colonne de données ordinaire (pas une option)', () => {
  const vars = describeVariables({ catalog, choicesByList, dataKeys: ['HHSize.1', 'Inconnu.2'] });
  assert.equal(vars.find((v) => v.name === 'HHSize.1').kind, 'data');
  assert.equal(vars.find((v) => v.name === 'Inconnu.2').kind, 'data');
});

test('champs calculés listés à part ; remplissage repris de l\'échantillon', () => {
  const vars = describeVariables({
    catalog, choicesByList, dataKeys: ['MODistPtsDign.1'],
    calcFields: [{ name: 'score_dign', label: 'Score dignité', filled: 12 }],
    fill: new Map([['MOInfoSession', 315], ['MODistPtsDign.1', 300]]),
  });
  const calc = vars.find((v) => v.name === 'score_dign');
  assert.equal(calc.kind, 'calc');
  assert.equal(calc.filled, 12);
  assert.equal(vars.find((v) => v.name === 'MOInfoSession').filled, 315);
  assert.equal(vars.find((v) => v.name === 'MODistPtsDign.1').filled, 300);
  assert.equal(vars.find((v) => v.name === 'HHSize').filled, 0); // jamais renseignée dans l'échantillon
  assert.equal(describeVariables({ catalog }).find((v) => v.name === 'HHSize').filled, null); // pas d'échantillon
});

test('resolveVariable : nom exact, puis variante de casse, sinon erreur avec la variable la plus proche', () => {
  const known = ['MOInfoSession', 'MODistPtsDign.1', 'Field_office'];
  assert.deepEqual(resolveVariable('MOInfoSession', known), { name: 'MOInfoSession' });
  assert.deepEqual(resolveVariable(' field_office ', known), { name: 'Field_office' });
  const typo = resolveVariable('MOInfoSesion', known);
  assert.equal(typo.suggestion, 'MOInfoSession');
  assert.match(typo.error, /introuvable.*vouliez-vous dire « MOInfoSession »/);
  const none = resolveVariable('totalement_autre', known);
  assert.equal(none.suggestion, null);
  assert.match(none.error, /introuvable/);
  assert.match(resolveVariable('', known).error, /Choisissez la variable/);
});

test('logique de saut (relevant) : jointe à la question et à ses options éclatées, absente ailleurs', () => {
  const withSkip = [
    { ...catalog[0], relevant: " ${MOInfoSession} = '1' " },
    { ...catalog[1], relevant: '' },
    ...catalog.slice(2),
  ];
  const vars = describeVariables({
    catalog: withSkip, choicesByList, dataKeys: ['MODistPtsDign.1', '_uuid'],
    calcFields: [{ name: 'score_dign', label: 'Score dignité' }],
  });
  assert.equal(vars.find((v) => v.name === 'MODistPtsDign').relevant, "${MOInfoSession} = '1'");
  // Une option n'est renseignée que si sa question est posée : même condition.
  assert.equal(vars.find((v) => v.name === 'MODistPtsDign.1').relevant, "${MOInfoSession} = '1'");
  assert.equal(vars.find((v) => v.name === 'MOInfoSession').relevant, null); // vide = toujours posée
  assert.equal(vars.find((v) => v.name === 'HHSize').relevant, null);
  assert.equal(vars.find((v) => v.name === '_uuid').relevant, null);
  assert.equal(vars.find((v) => v.name === 'score_dign').relevant, null);
});

test('resolveVariable : erreur structurée (code, nom demandé, suggestion) pour refaire la phrase dans la langue de l\'interface', () => {
  const known = ['MOInfoSession', 'Field_office'];
  assert.deepEqual(resolveVariable(' MOInfoSesion ', known), {
    error: 'Variable « MOInfoSesion » introuvable dans cette fiche — vouliez-vous dire « MOInfoSession » ?',
    code: 'unknown_variable', requested: 'MOInfoSesion', suggestion: 'MOInfoSession',
  });
  const none = resolveVariable('totalement_autre', known);
  assert.equal(none.code, 'unknown_variable');
  assert.equal(none.requested, 'totalement_autre');
  assert.equal(none.suggestion, null);
  assert.equal(resolveVariable('  ', known).code, 'variable_required');
});

test('optionParentName', () => {
  assert.equal(optionParentName('MODistPtsDign.3'), 'MODistPtsDign');
  assert.equal(optionParentName('group/q/2'), 'group/q');
  assert.equal(optionParentName('simple'), null);
});
