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

test('capacité calculée = personnes × suivis/jour × jours ouvrés (prime sur saisie)', () => {
  const m = deriveMmr({ operationDuration: 6, numberOfSites: 104, riskLevel: 2, feasible: 5,
    personsToDeploy: 3, visitsPerDay: 2, workingDays: 20 });
  assert.equal(m.computedCapacity, 120);     // 3 × 2 × 20
  assert.equal(m.feasible, 120);             // la calculée prime sur 5
  assert.equal(m.feasibleSource, 'calculée');
  assert.equal(m.targetedPerMonth, 34.67);
  assert.equal(m.feasibleMeetsTarget, true); // 120 ≥ 34,67
});

test('sans ressources, on retombe sur la capacité saisie', () => {
  const m = deriveMmr({ operationDuration: 6, numberOfSites: 48, riskLevel: 1, feasible: 10 });
  assert.equal(m.computedCapacity, null);
  assert.equal(m.feasible, 10);
  assert.equal(m.feasibleSource, 'saisie');
});

test('valeurs manquantes gérées sans planter', () => {
  const m = deriveMmr({ operationDuration: 0, numberOfSites: 0, riskLevel: 0 });
  assert.equal(m.interval, null);
  assert.equal(m.targetedPerMonth, null);
  assert.equal(m.coverageRatio, null);
  assert.equal(deriveMmr({}).frequency, 0);
});

const { resolvePlan, summarizePlan, registryCounts } = require('../src/modules/tpm/mmrMath');
const OFF = 'b1';
const ROWS = [
  { id: 'g1', fieldOfficeId: null, activityCategory: 'School meal activities', operationDuration: 10, numberOfSites: 700, riskLevel: 2, feasible: 50 },
  { id: 'g2', fieldOfficeId: null, activityCategory: 'Nutrition treatment activities', operationDuration: 12, numberOfSites: 300, riskLevel: 3 },
  { id: 'o1', fieldOfficeId: OFF, activityCategory: 'School meal activities', operationDuration: 9, numberOfSites: 200, riskLevel: 2, feasible: 30 },
  { id: 'o2', fieldOfficeId: OFF, activityCategory: 'Asset creation', operationDuration: 3, numberOfSites: 6, riskLevel: 1, feasible: 1 },
  { id: 'x1', fieldOfficeId: 'autre', activityCategory: 'School meal activities', operationDuration: 1, numberOfSites: 1, riskLevel: 1 },
];

test('plan général : seules les lignes sans bureau, aucune n\'est héritée', () => {
  const p = resolvePlan(ROWS, null);
  assert.deepEqual(p.map((x) => x.activityCategory), ['Nutrition treatment activities', 'School meal activities']);
  assert.ok(p.every((x) => !x.inherited && !x.override));
  assert.equal(p[1].effective.targetedPerMonth, 140); // 700 / (10/2)
});

test('bureau : dérogation prioritaire, sinon héritage du plan général, dérogations seules incluses', () => {
  const p = resolvePlan(ROWS, OFF);
  const by = Object.fromEntries(p.map((x) => [x.activityCategory, x]));
  assert.equal(p.length, 3);
  assert.equal(by['School meal activities'].inherited, false);
  assert.equal(by['School meal activities'].effective.numberOfSites, 200);
  assert.equal(by['Nutrition treatment activities'].inherited, true);
  assert.equal(by['Nutrition treatment activities'].effective.numberOfSites, 300);
  assert.equal(by['Asset creation'].general, null);
  // La dérogation d'un AUTRE bureau n'est jamais prise.
  assert.ok(p.every((x) => x.effective.numberOfSites !== 1));
});

test('totaux : couverture calculée sur les seules lignes ayant une capacité', () => {
  const s = summarizePlan(resolvePlan(ROWS, null));
  assert.equal(s.categories, 2);
  assert.equal(s.sites, 1000);
  assert.equal(s.targetedPerMonth, 215);   // 140 + 300/(12/3)=75
  assert.equal(s.feasible, 50);
  assert.equal(s.coverageRatio, 0.36);     // 50 / 140 (Nutrition sans capacité exclue)
  assert.equal(summarizePlan(resolvePlan(ROWS, OFF)).overrides, 2);
});

test('registre : un site d\'antenne compte pour son bureau parent ; null = tout', () => {
  const reg = [
    { activity: 'SMP', officeId: OFF, parentId: null, n: 5 },
    { activity: 'SMP', officeId: 'ant', parentId: OFF, n: 3 },
    { activity: 'SMP', officeId: 'autre', parentId: null, n: 7 },
    { activity: null, officeId: OFF, parentId: null, n: 2 },
  ];
  assert.equal(registryCounts(reg, OFF).get('SMP'), 8);
  assert.equal(registryCounts(reg, null).get('SMP'), 15);
  assert.equal(registryCounts(reg, 'ant').get('SMP'), 3);
});

test('CO adjusted : fréquence et intervalle ajustés à la capacité (classeur RBM)', () => {
  // Ampanihy · Unconditional resource transfers : durée 6, 104 sites, risque 2, faisable 12.
  const m = deriveMmr({ operationDuration: 6, numberOfSites: 104, riskLevel: 2, feasible: 12 });
  assert.equal(m.adjustedFrequency, 0.69);   // 2 × 12/34.67
  assert.equal(m.adjustedInterval, 8.67);    // 6 / 0.69…
  // Capacité supérieure à la cible : l'intervalle ajusté ne descend pas sous 1 mois.
  const over = deriveMmr({ operationDuration: 6, numberOfSites: 6, riskLevel: 3, feasible: 50 });
  assert.equal(over.adjustedInterval, 1);
  assert.equal(deriveMmr({ operationDuration: 6, numberOfSites: 6, riskLevel: 3 }).adjustedFrequency, null);
});
