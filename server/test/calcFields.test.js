const test = require('node:test');
const assert = require('node:assert/strict');
const { evalExpression, validateExpression, checkExpression, applyRecode, computeCalcFields, previewCalc, functionCatalog } = require('../src/modules/monitoring/calcFields');

test('evalExpression: arithmétique, champs, précédence, parenthèses', () => {
  assert.equal(evalExpression('2 + 3 * 4'), 14);
  assert.equal(evalExpression('(2 + 3) * 4'), 20);
  assert.equal(evalExpression('a + b', { a: 2, b: '3' }), 5);        // coercition numérique
  assert.equal(evalExpression('[poids total] / 2', { 'poids total': 10 }), 5);
  assert.equal(evalExpression('a / b', { a: 1, b: 0 }), null);        // division par zéro → null
  assert.equal(evalExpression('a + b', { a: 1 }), null);              // champ manquant → null
});

test('evalExpression: comparaisons, logique, if', () => {
  assert.equal(evalExpression('age >= 18', { age: 20 }), 1);
  assert.equal(evalExpression('age >= 18', { age: 5 }), 0);
  assert.equal(evalExpression('if(age >= 18, 1, 0)', { age: 20 }), 1);
  assert.equal(evalExpression('if(statut == "oui", 100, 0)', { statut: 'oui' }), 100);
  assert.equal(evalExpression('a > 0 && b > 0', { a: 1, b: 2 }), 1);
  assert.equal(evalExpression('a > 0 || b > 0', { a: 0, b: 0 }), 0);
});

test('evalExpression: fonctions texte & numériques', () => {
  assert.equal(evalExpression('round(10 / 3, 2)'), 3.33);
  assert.equal(evalExpression('lower(x)', { x: 'OUI' }), 'oui');
  assert.equal(evalExpression('contains(x, "cfm")', { x: 'le CFM est utilisé' }), 1);
  assert.equal(evalExpression('concat(a, "-", b)', { a: 'MG', b: '51' }), 'MG-51');
  assert.equal(evalExpression('coalesce(a, b, 0)', { a: null, b: '' }), 0);
});

test('evalExpression: sûr — pas d\'exécution de code, erreurs → null', () => {
  assert.equal(evalExpression('process.exit(1)'), null);   // identifiants = champs, pas d'accès globaux
  assert.equal(evalExpression('a +', { a: 1 }), null);     // syntaxe invalide → null
  assert.equal(evalExpression('"x" ++ "y"'), null);
});

test('validateExpression signale les erreurs de syntaxe', () => {
  assert.equal(validateExpression('a + b'), null);
  assert.equal(validateExpression(''), 'Formule vide.');
  assert.ok(validateExpression('a + ')); // message non nul
  assert.ok(validateExpression('(a + b'));
});

test('applyRecode mappe les valeurs + défaut', () => {
  const def = { sourceField: 'reponse', mapping: { oui: 1, non: 0 }, defaultValue: '' };
  assert.equal(applyRecode(def, { reponse: 'oui' }), 1);
  assert.equal(applyRecode(def, { reponse: 'non' }), 0);
  assert.equal(applyRecode({ ...def, defaultValue: 9 }, { reponse: 'nsp' }), 9); // hors mapping → défaut
});

test('computeCalcFields applique dans l\'ordre et permet la référence à un champ précédent', () => {
  const defs = [
    { name: 'cfm_bin', kind: 'recode', sourceField: 'cfm', mapping: { oui: 1, non: 0 }, defaultValue: 0 },
    { name: 'score', kind: 'expression', expression: 'cfm_bin * 100' },
  ];
  const out = computeCalcFields(defs, { cfm: 'oui' });
  assert.deepEqual(out, { cfm_bin: 1, score: 100 });
  assert.deepEqual(computeCalcFields(defs, { cfm: 'non' }), { cfm_bin: 0, score: 0 });
});

test('syntaxe à la Tableau : =, <>, AND, OR, NOT, null (insensibles à la casse)', () => {
  assert.equal(evalExpression('statut = "oui"', { statut: 'oui' }), 1);
  assert.equal(evalExpression('statut <> "oui"', { statut: 'oui' }), 0);
  assert.equal(evalExpression('age >= 6 AND age <= 59', { age: 24 }), 1);
  assert.equal(evalExpression('a and (b or c)', { a: 1, b: 0, c: 1 }), 1);
  assert.equal(evalExpression('NOT (x = 1)', { x: 1 }), 0);
  assert.equal(evalExpression('if(isnull(x), null, x)', { x: '' }), null);
  assert.equal(evalExpression('if(cfm, 1, 0)', { cfm: '0' }), 0); // « 0 » venu des données = faux
});

test('fonctions du suivi : choix multiples, in, between, sum, avg, left, min/max vides', () => {
  assert.equal(evalExpression('selected(pm, "3")', { pm: '1 3 7' }), 1);
  assert.equal(evalExpression('selected(pm, 2)', { pm: '1 3 7' }), 0);
  assert.equal(evalExpression('selected(pm, "3")', { pm: '' }), null);
  assert.equal(evalExpression('count_selected(pm)', { pm: '1 3 7' }), 3);
  assert.equal(evalExpression('in(Field_office, 6, 7, 9)', { Field_office: '7' }), 1);
  assert.equal(evalExpression('in(r, "Oui", "yes")', { r: 'OUI' }), 1);
  assert.equal(evalExpression('between(age, 6, 59)', { age: '60' }), 0);
  assert.equal(evalExpression('between(age, 6, 59)', {}), null);
  assert.equal(evalExpression('sum(h, f)', { h: 3, f: '' }), 3);     // a + b serait vide
  assert.equal(evalExpression('h + f', { h: 3, f: '' }), null);
  assert.equal(evalExpression('avg(a, b, c)', { a: 2, b: 4 }), 3);
  assert.equal(evalExpression('left(code, 4)', { code: 'MG51507' }), 'MG51');
  assert.equal(evalExpression('right(code, 3)', { code: 'MG51507' }), '507');
  assert.equal(evalExpression('max(a, b)', {}), null);                // plus d'Infinity
});

test('vérification : position de l\'erreur, fonction inconnue avec suggestion, nombre d\'arguments, variable inconnue', () => {
  const syntax = checkExpression('if(a > 1, 2');
  assert.match(syntax.error.message, /attendu/);
  assert.equal(syntax.error.at, 11);
  const unknownFn = checkExpression('iff(a, 1, 0)');
  assert.match(unknownFn.error.message, /Fonction inconnue « iff » — vouliez-vous dire « if »/);
  assert.equal(unknownFn.error.at, 0);
  const arity = checkExpression('x + round()');
  assert.match(arity.error.message, /round\( \) attend 1 à 2 argument/);
  assert.equal(arity.error.at, 4);
  const ok = checkExpression('if(Field_ofice = 7, 1, 0) + [process_monitoring/3]', { fields: ['Field_office', 'process_monitoring/3'] });
  assert.equal(ok.error, null);
  assert.deepEqual(ok.references, ['Field_ofice', 'process_monitoring/3']);
  assert.equal(ok.warnings.length, 1);
  assert.match(ok.warnings[0].message, /« Field_ofice » inconnue.*« Field_office »/);
  assert.match(validateExpression('a +'), /\(caractère \d+\)/);
});

test('aperçu sur données réelles : lignes renseignées d\'abord, répartition, vides, champs calculés précédents', () => {
  const rows = [{ pm: '' }, { pm: '1 3' }, { pm: '3' }, { pm: '2' }, {}];
  const prior = [{ name: 'pm3', kind: 'expression', expression: 'selected(pm, "3")' }];
  const out = previewCalc({ kind: 'expression', expression: 'if(pm3 = 1, "cité", "non cité")' }, rows, prior, { samples: 3 });
  assert.equal(out.n, 5);
  // Question sans réponse : ni « cité » ni « non cité », mais vide (hors base).
  assert.deepEqual(out.distribution, [{ value: 'cité', n: 2 }, { value: 'non cité', n: 1 }]);
  assert.equal(out.empty, 2);
  assert.deepEqual(out.references, ['pm3']);
  assert.deepEqual(out.samples.map((x) => x.value), ['cité', 'cité', 'non cité']);
  const rec = previewCalc({ kind: 'recode', sourceField: 'r', mapping: { oui: 1 }, defaultValue: '' }, [{ r: 'oui' }, { r: 'non' }, {}]);
  assert.deepEqual(rec.distribution, [{ value: '1', n: 1 }, { value: 'non', n: 1 }]);
  assert.equal(rec.empty, 1);
});

test('catalogue publié : chaque fonction documentée (catégorie, syntaxe, description, exemple valide), sans code', () => {
  const { functions, operators } = functionCatalog();
  assert.ok(functions.length >= 20 && operators.length >= 4);
  for (const f of functions) {
    assert.ok(f.category && f.syntax && f.description && f.example, f.name);
    assert.equal(f.fn, undefined);
    assert.equal(checkExpression(f.example).error, null, `${f.name} : ${f.example}`);
  }
});

test('formules et recodage : variable trouvée sans tenir compte de la casse, nom exact prioritaire, pas d\'avertissement pour la casse seule', () => {
  assert.equal(evalExpression('in(field_office, 6, 7)', { Field_office: '7' }), 1);
  assert.equal(evalExpression('field_office', { field_office: 1, Field_office: 2 }), 1);
  assert.equal(applyRecode({ sourceField: 'field_office', mapping: { 6: 'Ambovombe' } }, { Field_office: '6' }), 'Ambovombe');
  assert.deepEqual(computeCalcFields([{ name: 'a', kind: 'expression', expression: 'X + 1' }, { name: 'b', kind: 'expression', expression: 'A * 2' }], { x: 1 }), { a: 2, b: 4 });
  assert.equal(checkExpression('field_office = 6', { fields: ['Field_office'] }).warnings.length, 0);
  const prev = previewCalc({ kind: 'expression', expression: 'field_office' }, [{ Field_office: '6' }]);
  assert.deepEqual(prev.samples[0].inputs, { field_office: '6' });
});

test('réponse manquante : comparaison et condition vides (jamais « oui » ni « non »), sauf test explicite', () => {
  assert.equal(evalExpression('perte < 1', { perte: '' }), null);
  assert.equal(evalExpression('perte + 0 < 1', { perte: ' ' }), null);
  assert.equal(evalExpression('if(age >= 5, "5 ans et plus", "moins de 5 ans")', {}), null);
  assert.equal(evalExpression('x = null', { x: ' ' }), 1);
  assert.equal(evalExpression('x <> null', { x: 'a' }), 1);
  assert.equal(evalExpression('isnull(x)', { x: ' ' }), 1);
  assert.equal(evalExpression('NOT x', {}), null);
  assert.equal(evalExpression('a AND b', { a: 0 }), 0);   // faux ET inconnu = faux
  assert.equal(evalExpression('a OR b', { a: 'oui' }), 1); // vrai OU inconnu = vrai
  assert.equal(evalExpression('a AND b', { a: 1 }), null);
  assert.equal(evalExpression('coalesce(x, 0) < 1', {}), 1);
});

test('faux = 0, « non », « Non », « NON », « No », « False », « faux », « n » ; tout le reste renseigné est vrai', () => {
  for (const v of ['0', 'non', 'Non', 'NON', 'No', 'False', 'faux', 'n', ' non ', '0.0', 0]) assert.equal(evalExpression('if(r, 1, 0)', { r: v }), 0, String(v));
  for (const v of ['oui', 'Oui', 'yes', '1', 'x', 2]) assert.equal(evalExpression('if(r, 1, 0)', { r: v }), 1, String(v));
  assert.equal(evalExpression('num(x)', { x: '  ' }), 0);
  assert.equal(evalExpression('x + 1', { x: '  ' }), null);
});
