/**
 * Planification automatique sur une période (retour 82) — moteur pur, MMR + RBM.
 * generatePlan(sites, mmrByKey, settings, months(1..12), year).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePlan, normalizeSettings, siteRemaining } = require('../src/modules/tpm/planAuto');

const H1 = [1, 2, 3, 4, 5, 6];
const YEAR = 2026;
const site = (o) => ({ forbidden: false, parametered: false, required: 0, visits: [], monthStatus: {}, riskLevel: 'moyenne', lastVisitMonth: null, mmrKey: null, ...o });

test('normalizeSettings : défauts et bornes', () => {
  const s = normalizeSettings();
  assert.deepEqual(s.frequency, { elevee: 2, moyenne: 3, faible: 4 }); // repli RBM adouci (retour 82)
  assert.equal(s.useMmrCapacity, true);
  assert.equal(s.adjusted, false);
  assert.equal(s.useGps, true);
  assert.equal(s.gpsGridDeg, 0.1);
  assert.equal(s.balanceByTpm, true);
  assert.equal(s.tpmCapacityPerMonth, null);
  const c = normalizeSettings({ excludeMonths: ['2026-04', 5], useMmrCapacity: false, adjusted: true, useGps: false, balanceByTpm: false, tpmCapacityPerMonth: 5 });
  assert.deepEqual(c.excludeMonths.sort(), [4, 5]);
  assert.equal(c.useMmrCapacity, false);
  assert.equal(c.adjusted, true);
  assert.equal(c.useGps, false);
  assert.equal(c.balanceByTpm, false);
  assert.equal(c.tpmCapacityPerMonth, 5);
});

test('siteRemaining : exigées − réalisées − prévues dans la période', () => {
  const r = siteRemaining({ required: 2, visits: [{ month: 2, status: 'planifie' }, { month: 5, status: 'realise' }] }, 4);
  assert.equal(r.remaining, 1);     // 2 − 1 réalisée − 0 prévue dans la période (mois 2 < 4)
  assert.equal(r.latePlanned, 1);   // la prévue de février
});

test('intervalle minimal respecté même sous capacité (jamais 2 visites adjacentes — cas A.BEDARO)', () => {
  const FULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const sites = Array.from({ length: 4 }, (_, i) => site({ id: `s${i}`, parametered: true, required: 2, mmrKey: 'k', commune: `C${i}` }));
  // intervalle 5, capacité serrée (1/mois) → glissements, MAIS jamais sous l'intervalle.
  const r = generatePlan(sites, { k: { interval: 5, feasible: 1 } }, {}, FULL, YEAR);
  const bySite = {};
  for (const a of r.assignments) (bySite[a.siteId] = bySite[a.siteId] || []).push(Number(a.month.slice(5, 7)));
  for (const k of Object.keys(bySite)) {
    const ms = bySite[k].sort((a, b) => a - b);
    for (let i = 1; i < ms.length; i += 1) assert.ok(ms[i] - ms[i - 1] >= 5, `${k}: ${ms} — écart < intervalle`);
  }
});

test('regroupement par commune + étalement par phase (pas de pic)', () => {
  // 2 communes, intervalle 2 → phases 0 et 1 → une commune démarre jan, l'autre fév.
  const sites = [
    { id: 'a1', parametered: true, required: 1, mmrKey: 'k', commune: 'Alpha' },
    { id: 'b1', parametered: true, required: 1, mmrKey: 'k', commune: 'Beta' },
  ];
  const r = generatePlan(sites, { k: { interval: 2, feasible: 100 } }, {}, H1, YEAR);
  const m = Object.fromEntries(r.assignments.map((x) => [x.siteId, x.month]));
  assert.notEqual(m.a1, m.b1); // communes étalées sur des mois différents
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

test('byActivity : paramètres de base du MMR + résultat par activité', () => {
  const sites = [
    site({ id: 'a1', parametered: true, required: 2, mmrKey: 'k', activity: 'School meal activities', commune: 'Alpha' }),
    site({ id: 'a2', parametered: true, required: 2, mmrKey: 'k', activity: 'School meal activities', commune: 'Beta' }),
    site({ id: 'b1', parametered: false, riskLevel: 'faible', activity: 'Nutrition' }),
  ];
  const mmr = { k: { activity: 'School meal activities', riskLevel: 2, operationDuration: 12, numberOfSites: 50, frequency: 2, interval: 6, adjustedInterval: 6, targetedPerMonth: 8.3, feasible: 10 } };
  const r = generatePlan(sites, mmr, {}, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], YEAR);
  assert.ok(Array.isArray(r.byActivity));
  const mmrLine = r.byActivity.find((x) => x.parametered);
  assert.equal(mmrLine.activity, 'School meal activities');
  assert.equal(mmrLine.mmr.interval, 6);
  assert.equal(mmrLine.mmr.frequency, 2);
  assert.equal(mmrLine.mmr.targetedPerMonth, 8.3);
  assert.equal(mmrLine.mmr.feasible, 10);
  assert.equal(mmrLine.stepUsed, 6);          // intervalle arrondi au supérieur
  assert.equal(mmrLine.sites, 2);
  assert.equal(mmrLine.planned, 4);           // 2 sites × 2 visites
  const rbmLine = r.byActivity.find((x) => !x.parametered);
  assert.equal(rbmLine.mmr, null);            // pas de MMR → paramètres nuls
  assert.equal(rbmLine.activity, 'Nutrition');
});

test('regroupement GPS : deux sites proches = même tournée (même mois)', () => {
  // Deux sites de communes différentes mais GPS quasi identiques → même cellule → même tournée.
  const sites = [
    site({ id: 'g1', parametered: true, required: 1, mmrKey: 'k', commune: 'C1', gpsLat: -18.90, gpsLng: 47.52 }),
    site({ id: 'g2', parametered: true, required: 1, mmrKey: 'k', commune: 'C2', gpsLat: -18.91, gpsLng: 47.53 }),
    site({ id: 'far', parametered: true, required: 1, mmrKey: 'k', commune: 'C3', gpsLat: -22.00, gpsLng: 43.00 }),
  ];
  const r = generatePlan(sites, { k: { interval: 2, feasible: 100 } }, {}, H1, YEAR);
  const m = Object.fromEntries(r.assignments.map((x) => [x.siteId, x.month]));
  assert.equal(m.g1, m.g2);        // proches → même mois (même cellule GPS)
  assert.notEqual(m.g1, m.far);    // loin → autre mois
});

test('GPS ignoré si useGps=false → regroupement par commune', () => {
  const sites = [
    site({ id: 'g1', parametered: true, required: 1, mmrKey: 'k', commune: 'C1', gpsLat: -18.90, gpsLng: 47.52 }),
    site({ id: 'g2', parametered: true, required: 1, mmrKey: 'k', commune: 'C2', gpsLat: -18.91, gpsLng: 47.53 }),
  ];
  const r = generatePlan(sites, { k: { interval: 2, feasible: 100 } }, { useGps: false }, H1, YEAR);
  const m = Object.fromEntries(r.assignments.map((x) => [x.siteId, x.month]));
  assert.notEqual(m.g1, m.g2);     // communes différentes → mois différents
});

test('TPM : charge équilibrée entre les TPM + byTpm', () => {
  // 2 TPM, 2 sites chacun, intervalle 1 (toutes les visites possibles). Chaque TPM doit
  // voir ses visites réparties, pas toutes le même mois.
  const seg = (name) => [{ from: `${YEAR}-01`, to: `${YEAR}-12`, providerId: name, providerName: name }];
  const sites = [
    site({ id: 'a1', parametered: true, required: 2, mmrKey: 'k', commune: 'A', tpmSegments: seg('TPM-1') }),
    site({ id: 'a2', parametered: true, required: 2, mmrKey: 'k', commune: 'B', tpmSegments: seg('TPM-1') }),
    site({ id: 'b1', parametered: true, required: 2, mmrKey: 'k', commune: 'C', tpmSegments: seg('TPM-2') }),
  ];
  const r = generatePlan(sites, { k: { interval: 2, feasible: 100 } }, {}, H1, YEAR);
  assert.ok(Array.isArray(r.byTpm));
  const t1 = r.byTpm.find((t) => t.tpm === 'TPM-1');
  const t2 = r.byTpm.find((t) => t.tpm === 'TPM-2');
  assert.ok(t1 && t2);
  assert.equal(t1.sites, 2);
  assert.equal(t1.planned, 4);       // 2 sites × 2 visites
  assert.equal(t2.planned, 2);
  // Les assignments portent le TPM.
  assert.ok(r.assignments.every((x) => x.tpm === 'TPM-1' || x.tpm === 'TPM-2'));
});

test('TPM : plafond mensuel par TPM respecté (glissement)', () => {
  const seg = [{ from: `${YEAR}-01`, to: `${YEAR}-12`, providerId: 'T', providerName: 'T' }];
  const sites = [1, 2, 3].map((i) => site({ id: `s${i}`, parametered: true, required: 1, mmrKey: `k${i}`, commune: `C${i}`, tpmSegments: seg }));
  const r = generatePlan(sites, {}, { tpmCapacityPerMonth: 1 }, H1, YEAR);
  const t = r.byTpm.find((x) => x.tpm === 'T');
  assert.ok(t.perMonth.every((m) => m.count <= 1));   // jamais 2 visites du même TPM le même mois
  assert.equal(t.planned, 3);
});

test('repli RBM adouci : site élevé sans MMR pas tous les mois', () => {
  const r = generatePlan([site({ id: 'e', parametered: false, riskLevel: 'elevee' })], {}, {}, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], YEAR);
  const months = r.assignments.map((x) => Number(x.month.slice(5, 7))).sort((a, b) => a - b);
  // Repli élevé adouci = tous les 2 mois (défaut), donc PAS 12 visites.
  assert.ok(r.assignments.length < 12);
  for (let i = 1; i < months.length; i += 1) assert.ok(months[i] - months[i - 1] >= 2);
});

test('perMonth couvre toute la période ; plan vide sans erreur', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 2, mmrKey: 'k' })], { k: { interval: 2, feasible: 9 } }, {}, H1, YEAR);
  assert.deepEqual(r.perMonth.map((m) => m.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.deepEqual(generatePlan([], {}, {}, [], YEAR).assignments, []);
  assert.equal(generatePlan([], {}, {}, H1, YEAR).summary.coverageRate, null);
});
