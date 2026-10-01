const test = require('node:test');
const assert = require('node:assert/strict');
const { isDue, frequencyFor, monthsBetween } = require('../src/modules/tpm/rbmMath');

test('frequency follows risk (élevée mensuelle, faible trimestrielle)', () => {
  assert.equal(frequencyFor('elevee'), 1);
  assert.equal(frequencyFor('moyenne'), 2);
  assert.equal(frequencyFor('faible'), 3);
  assert.equal(frequencyFor('inconnu'), 3); // défaut
});

test('monthsBetween counts calendar months', () => {
  assert.equal(monthsBetween('2026-01', '2026-04'), 3);
  assert.equal(monthsBetween('2025-11', '2026-02'), 3);
  assert.equal(monthsBetween('2026-05', '2026-05'), 0);
});

test('isDue: never visited is always due; otherwise by risk frequency', () => {
  assert.equal(isDue('faible', null, '2026-05'), true);        // jamais visité
  // élevée (mensuelle) : due dès le mois suivant
  assert.equal(isDue('elevee', '2026-04', '2026-05'), true);
  assert.equal(isDue('elevee', '2026-05', '2026-05'), false);  // déjà visité ce mois
  // faible (trimestrielle) : pas due avant 3 mois
  assert.equal(isDue('faible', '2026-03', '2026-05'), false);  // 2 mois < 3
  assert.equal(isDue('faible', '2026-02', '2026-05'), true);   // 3 mois ≥ 3
  // moyenne (bimestrielle)
  assert.equal(isDue('moyenne', '2026-04', '2026-05'), false); // 1 < 2
  assert.equal(isDue('moyenne', '2026-03', '2026-05'), true);  // 2 ≥ 2
  // dernière visite dans le futur → non due
  assert.equal(isDue('elevee', '2026-06', '2026-05'), false);
});
