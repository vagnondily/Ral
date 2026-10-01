const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveMmr } = require('../src/modules/tpm/mmrMath');

test('reproduit les formules de la feuille Overarching parameters', () => {
  // Ligne réelle : durée 6, 104 sites, risque 2, faisable 12.
  const m = deriveMmr({ operationDuration: 6, numberOfSites: 104, riskLevel: 2, feasible: 12 });
  assert.equal(m.interval, 3);              // 6 / 2
  assert.equal(m.frequency, 2);             // 6 / 3
  assert.equal(m.targetedPerMonth, 34.67);  // 104 / 3
  assert.equal(m.coverageRatio, 0.35);      // 12 / 34.67
  assert.equal(m.feasibleMeetsTarget, false);
});

test('risque élevé ⇒ intervalle plus court, cible plus grande', () => {
  const low = deriveMmr({ operationDuration: 12, numberOfSites: 60, riskLevel: 1 });
  const high = deriveMmr({ operationDuration: 12, numberOfSites: 60, riskLevel: 3 });
  assert.equal(low.interval, 12);  assert.equal(low.targetedPerMonth, 5);
  assert.equal(high.interval, 4);  assert.equal(high.targetedPerMonth, 15);
  assert.ok(high.targetedPerMonth > low.targetedPerMonth);
});

test('faisable atteint la cible ⇒ couverture suffisante', () => {
  const m = deriveMmr({ operationDuration: 6, numberOfSites: 48, riskLevel: 1, feasible: 10 });
  assert.equal(m.interval, 6);
  assert.equal(m.targetedPerMonth, 8);      // 48 / 6
  assert.equal(m.coverageRatio, 1.25);      // 10 / 8
  assert.equal(m.feasibleMeetsTarget, true);
});

test('valeurs manquantes gérées sans planter', () => {
  const m = deriveMmr({ operationDuration: 0, numberOfSites: 0, riskLevel: 0 });
  assert.equal(m.interval, null);
  assert.equal(m.targetedPerMonth, null);
  assert.equal(m.coverageRatio, null);
  assert.equal(deriveMmr({}).frequency, 0);
});
