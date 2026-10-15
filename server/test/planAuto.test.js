/**
 * Planification automatique sur une période (retour 82) — moteur pur, MMR + RBM.
 * generatePlan(sites, mmrByKey, settings, months(1..12), year).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePlan, normalizeSettings, cadence } = require('../src/modules/tpm/planAuto');

const H1 = [1, 2, 3, 4, 5, 6];
const YEAR = 2026;
const site = (o) => ({ forbidden: false, parametered: false, required: 0, visits: [], monthStatus: {}, riskLevel: 'moyenne', lastVisitMonth: null, mmrKey: null, ...o });

test('normalizeSettings : défauts et bornes', () => {
  const s = normalizeSettings();
  assert.deepEqual(s.frequency, { elevee: 1, moyenne: 2, faible: 3 });
  assert.equal(s.useMmrCapacity, true);
  assert.equal(s.adjusted, false);
  const c = normalizeSettings({ excludeMonths: ['2026-04', 5], useMmrCapacity: false, adjusted: true });
  assert.deepEqual(c.excludeMonths.sort(), [4, 5]);
  assert.equal(c.useMmrCapacity, false);
  assert.equal(c.adjusted, true);
});

test('cadence : espace les visites de l\'intervalle, borne à maxCount', () => {
  assert.deepEqual(cadence(1, 2, [1, 2, 3, 4, 5, 6], 3), [1, 3, 5]);
  assert.deepEqual(cadence(1, 3, [1, 2, 3, 4, 5, 6], 9), [1, 4]);
  assert.deepEqual(cadence(3, 2, [1, 2, 3, 4, 5, 6], 2), [3, 5]);
  assert.deepEqual(cadence(1, 2, [], 3), []);
});

test('site MMR : exactement les visites exigées, espacées de l\'intervalle (pas tous les mois)', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 2, mmrKey: 'k' })],
    { k: { interval: 3, feasible: 100 } }, {}, H1, YEAR);
  assert.deepEqual(r.assignments.map((x) => x.month), ['2026-01', '2026-04']); // 2 visites, pas 6
  assert.equal(r.summary.mmrDriven, 1);
});

test('intervalle ajusté (CO adjusted) utilisé quand demandé', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 3, mmrKey: 'k' })],
    { k: { interval: 1, adjustedInterval: 3, feasible: 100 } }, { adjusted: true }, H1, YEAR);
  assert.deepEqual(r.assignments.map((x) => x.month), ['2026-01', '2026-04']); // pas 1 (intervalle ajusté 3)
});

test('catch-up : une prévue AVANT la période non réalisée est re-planifiée dans la période', () => {
  // required 2, une visite prévue en février (avant la période avr→juin), non réalisée.
  const r = generatePlan([site({ id: 'a', parametered: true, required: 2, mmrKey: 'k', visits: [{ month: 2, status: 'planifie' }] })],
    { k: { interval: 1, feasible: 100 } }, {}, [4, 5, 6], YEAR);
  assert.equal(r.assignments.length, 2);               // les 2 exigées re-planifiées sur avr→juin
  assert.ok(r.assignments.every((a) => Number(a.month.slice(5)) >= 4));
  assert.equal(r.summary.latePlanned, 1);              // la prévue de février signalée
});

test('prévue DANS la période compte : reste diminué', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 2, mmrKey: 'k', visits: [{ month: 5, status: 'planifie' }] })],
    { k: { interval: 1, feasible: 100 } }, {}, [4, 5, 6], YEAR);
  assert.equal(r.assignments.length, 1);               // 2 exigées − 1 déjà prévue dans la période
});

test('réalisée compte comme faite, départ cadencé après', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 3, mmrKey: 'k', visits: [{ month: 1, status: 'realise' }] })],
    { k: { interval: 2, feasible: 100 } }, {}, H1, YEAR);
  // 1 faite → reste 2 ; départ = 1 + 2 = mois 3 → visites 3 et 5.
  assert.deepEqual(r.assignments.map((x) => x.month), ['2026-03', '2026-05']);
});

test('zone interdite : jamais planifiée', () => {
  const r = generatePlan([site({ id: 'f', forbidden: true, parametered: true, required: 5 })], {}, {}, H1, YEAR);
  assert.equal(r.assignments.length, 0);
  assert.equal(r.summary.forbidden, 1);
});

test('mois exclu / déjà visité / inactif sont sautés', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 3, mmrKey: 'k', visits: [{ month: 2, status: 'realise' }], monthStatus: { 3: false } })],
    { k: { interval: 1, feasible: 100 } }, { excludeMonths: ['2026-05'] }, H1, YEAR);
  const nums = r.assignments.map((x) => Number(x.month.slice(5, 7)));
  assert.ok(!nums.includes(2) && !nums.includes(3) && !nums.includes(5));
});

test('capacité mensuelle MMR (feasible) bornée', () => {
  const sites = [1, 2, 3].map((i) => site({ id: `s${i}`, parametered: true, required: 1, mmrKey: 'k', riskLevel: 'elevee' }));
  const r = generatePlan(sites, { k: { interval: 1, feasible: 1 } }, {}, H1, YEAR);
  const byMonth = {};
  for (const a of r.assignments) byMonth[a.month] = (byMonth[a.month] || 0) + 1;
  assert.ok(Object.values(byMonth).every((n) => n <= 1));
  assert.equal(r.assignments.length, 3);
});

test('capacité globale par mois : surplus glissé', () => {
  const sites = [1, 2, 3].map((i) => site({ id: `s${i}`, parametered: true, required: 1, mmrKey: `k${i}`, riskLevel: 'elevee' }));
  const r = generatePlan(sites, {}, { capacityPerMonth: 1 }, H1, YEAR);
  const byMonth = {};
  for (const a of r.assignments) byMonth[a.month] = (byMonth[a.month] || 0) + 1;
  assert.ok(Object.values(byMonth).every((n) => n <= 1));
});

test('repli RBM pour un site sans paramètre MMR', () => {
  const r = generatePlan([site({ id: 'b', parametered: false, riskLevel: 'faible' })], {}, {}, H1, YEAR);
  assert.equal(r.assignments.length, 2); // faible = tous les 3 mois → 1 et 4
  assert.equal(r.summary.rbmFallback, 1);
});

test('résumé : couverture, mmrDriven, rbmFallback', () => {
  const sites = [
    site({ id: 'a', parametered: true, required: 2, mmrKey: 'k' }),
    site({ id: 'b', parametered: false, riskLevel: 'elevee' }),
    site({ id: 'c', forbidden: true }),
  ];
  const r = generatePlan(sites, { k: { interval: 2, feasible: 100 } }, {}, H1, YEAR);
  assert.equal(r.summary.sitesConsidered, 3);
  assert.equal(r.summary.forbidden, 1);
  assert.equal(r.summary.sitesActivePlannable, 2);
  assert.equal(r.summary.mmrDriven, 1);
  assert.equal(r.summary.rbmFallback, 1);
  assert.equal(r.summary.sitesCovered, 2);
  assert.equal(r.summary.coverageRate, 100);
});

test('perMonth couvre toute la période ; plan vide sans erreur', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 2, mmrKey: 'k' })], { k: { interval: 2, feasible: 9 } }, {}, H1, YEAR);
  assert.deepEqual(r.perMonth.map((m) => m.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.deepEqual(generatePlan([], {}, {}, [], YEAR).assignments, []);
  assert.equal(generatePlan([], {}, {}, H1, YEAR).summary.coverageRate, null);
});
