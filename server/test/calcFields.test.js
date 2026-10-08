const test = require('node:test');
const assert = require('node:assert/strict');
const { evalExpression, validateExpression, applyRecode, computeCalcFields } = require('../src/modules/monitoring/calcFields');

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
  assert.equal(evalExpression('contains(x, "cfm")', { x: 'le CFM est utilisé' }), true);
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
