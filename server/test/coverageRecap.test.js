const test = require('node:test');
const assert = require('node:assert/strict');
const { requiredVisits, coverageRecap } = require('../src/modules/tpm/coverageRecap');

test('requiredVisits = durée / intervalle (plancher)', () => {
  assert.equal(requiredVisits('elevee', 12), 12); // interval 1 mois
  assert.equal(requiredVisits('moyenne', 12), 6); // interval 2 mois
  assert.equal(requiredVisits('faible', 12), 4);  // interval 3 mois
  assert.equal(requiredVisits('moyenne', 9), 4);  // floor(9/2)
});

test('requiredVisits dégénéré → 0', () => {
  assert.equal(requiredVisits('moyenne', 0), 0);
  assert.equal(requiredVisits('moyenne', -5), 0);
  assert.equal(requiredVisits('inconnu', 12), 4); // tombe sur faible
});

test('buckets de visites par risque', () => {
  const rows = [
    { riskLevel: 'faible', visitCount: 0 },
    { riskLevel: 'faible', visitCount: 1 },
    { riskLevel: 'faible', visitCount: 4 },
    { riskLevel: 'moyenne', visitCount: 2 },
    { riskLevel: 'moyenne', visitCount: 3 },
  ];
  const { groups, total } = coverageRecap(rows, 12);
  const faible = groups.find((g) => g.riskLevel === 'faible');
  assert.equal(faible.active, 3);
  assert.equal(faible.notVisited, 1);
  assert.equal(faible.once, 1);
  assert.equal(faible.fourPlus, 1);
  assert.equal(faible.visitedToDate, 2);
  assert.equal(total.active, 5);
  assert.equal(total.visitedToDate, 4);
});

test('conformité MMR = sites ayant atteint le nombre de visites requis', () => {
  // faible : required = 4 sur 12 mois
  const rows = [
    { riskLevel: 'faible', visitCount: 4 }, // conforme
    { riskLevel: 'faible', visitCount: 3 }, // non conforme
    { riskLevel: 'faible', visitCount: 5 }, // conforme
  ];
  const { groups } = coverageRecap(rows, 12);
  const faible = groups.find((g) => g.riskLevel === 'faible');
  assert.equal(faible.required, 4);
  assert.equal(faible.compliant, 2);
  assert.ok(Math.abs(faible.compliance - 2 / 3) < 1e-9);
});

test('ratio de couverture = sites visités au moins une fois / actifs', () => {
  const rows = [
    { riskLevel: 'elevee', visitCount: 0 },
    { riskLevel: 'elevee', visitCount: 1 },
    { riskLevel: 'elevee', visitCount: 2 },
    { riskLevel: 'elevee', visitCount: 0 },
  ];
  const { groups } = coverageRecap(rows, 12);
  const elevee = groups.find((g) => g.riskLevel === 'elevee');
  assert.equal(elevee.visitedToDate, 2);
  assert.equal(elevee.coverageRate, 0.5);
});

test('liste vide → tout à zéro, pas de division par zéro', () => {
  const { groups, total } = coverageRecap([], 12);
  assert.equal(total.active, 0);
  assert.equal(total.coverageRate, 0);
  assert.equal(total.compliance, 0);
  groups.forEach((g) => assert.equal(g.active, 0));
});
