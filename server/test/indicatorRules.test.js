const test = require('node:test');
const assert = require('node:assert/strict');
const { presentKeys, effectiveDefinition, normalizeNaValues, definitionError } = require('../src/modules/monitoring/indicatorRules');

test('modification partielle : seules les clés présentes comptent (null = effacer, absent = inchangé)', () => {
  assert.deepEqual(presentKeys({ active: false }), ['active']);
  assert.deepEqual(presentKeys({ module: null, target: null, label: undefined }), ['module', 'target']);
  assert.deepEqual(presentKeys({ code: 'X', templateCode: 'T', id: 'i' }), ['code']); // clés non modifiables ignorées
  const cur = { agg: 'percent_yes', positiveValue: '1', naValues: ['9999'], target: '80.0000', module: 'M1' };
  const eff = effectiveDefinition(cur, { active: false });
  assert.equal(eff.positiveValue, '1');
  assert.equal(eff.module, 'M1');
  assert.equal(effectiveDefinition(cur, { target: null }).target, null);
});

test('codes hors base : sans espaces, sans doublon (casse ignorée), 20 au plus', () => {
  assert.deepEqual(normalizeNaValues([' 9999', '888', '9999', '', null, 'NA', 'na']), ['9999', '888', 'NA']);
  assert.equal(normalizeNaValues(Array.from({ length: 30 }, (_, i) => String(i))).length, 20);
  assert.deepEqual(normalizeNaValues(undefined), []);
});

test('définition : « % = valeur » exige la valeur comptée ; cible numérique ; valeur comptée ≠ hors base', () => {
  assert.match(definitionError({ agg: 'percent_value', positiveValue: '' }), /précisez la valeur comptée/);
  assert.match(definitionError({ agg: 'percent_value', positiveValue: null }), /précisez/);
  assert.equal(definitionError({ agg: 'percent_value', positiveValue: '4' }), null);
  assert.equal(definitionError({ agg: 'percent_yes' }), null); // oui / 1 par défaut
  assert.equal(definitionError({ agg: 'mean', positiveValue: '' }), null);
  assert.match(definitionError({ agg: 'mean', target: 'abc' }), /Cible invalide/);
  assert.equal(definitionError({ agg: 'mean', target: '12.5' }), null);
  assert.match(definitionError({ agg: 'percent_yes', positiveValue: '1|9999', naValues: ['9999'] }), /à la fois comptée et hors base/);
  assert.equal(definitionError({ agg: 'mean', positiveValue: '9999', naValues: ['9999'] }), null); // ignorée par une moyenne
  // Modification : la définition EFFECTIVE est contrôlée (passer en « % = valeur » sans valeur enregistrée).
  assert.match(definitionError(effectiveDefinition({ agg: 'percent_yes', positiveValue: null }, { agg: 'percent_value' })), /précisez/);
  assert.equal(definitionError(effectiveDefinition({ agg: 'percent_yes', positiveValue: '2' }, { agg: 'percent_value' })), null);
});
