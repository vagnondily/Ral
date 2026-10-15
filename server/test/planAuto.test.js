/**
 * Planification automatique sur une période (retour 82) — moteur pur.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePlan, normalizeSettings, cadenceMonths } = require('../src/modules/tpm/planAuto');

const H1 = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

test('normalizeSettings : défauts RBM et bornes', () => {
  const s = normalizeSettings();
  assert.deepEqual(s.frequency, { elevee: 1, moyenne: 2, faible: 3 });
  assert.equal(s.capacityPerMonth, null);
  assert.equal(s.targetCoverage, 0.8);
  const c = normalizeSettings({ frequency: { elevee: 2 }, capacityPerMonth: '5', excludeMonths: ['2026-13', '2026-04'], targetCoverage: 2 });
  assert.equal(c.frequency.elevee, 2);
  assert.equal(c.frequency.faible, 3);        // non fourni → défaut
  assert.equal(c.capacityPerMonth, 5);
  assert.deepEqual(c.excludeMonths, ['2026-04']); // '2026-13' rejeté
  assert.equal(c.targetCoverage, 1);          // borné à 1
});

test('site élevé jamais visité : une visite par mois sur toute la période', () => {
  const r = generatePlan([{ id: 's1', riskLevel: 'elevee', lastVisitMonth: null }], {}, H1);
  const months = r.assignments.filter((a) => a.siteId === 's1').map((a) => a.month);
  assert.deepEqual(months, H1); // fréquence 1 → chaque mois
});

test('site faible : tous les 3 mois', () => {
  const r = generatePlan([{ id: 's1', riskLevel: 'faible', lastVisitMonth: null }], {}, H1);
  const months = r.assignments.map((a) => a.month);
  assert.deepEqual(months, ['2026-01', '2026-04']);
});

test('dernière visite récente : première visite = lastVisit + fréquence', () => {
  // moyenne = tous les 2 mois ; dernière visite déc. 2025 → janv ? déc+2 = fév.
  const r = generatePlan([{ id: 's1', riskLevel: 'moyenne', lastVisitMonth: '2025-12' }], {}, H1);
  assert.deepEqual(r.assignments.map((a) => a.month), ['2026-02', '2026-04', '2026-06']);
});

test('zone interdite : jamais planifiée, comptée à part', () => {
  const r = generatePlan([{ id: 's1', riskLevel: 'elevee', forbidden: true, lastVisitMonth: null }], {}, H1);
  assert.equal(r.assignments.length, 0);
  assert.equal(r.summary.forbidden, 1);
  assert.equal(r.summary.sitesActivePlannable, 0);
});

test('mois exclus et mois déjà occupé sont sautés (reportés)', () => {
  const r = generatePlan(
    [{ id: 's1', riskLevel: 'elevee', lastVisitMonth: null, busyMonths: ['2026-02'], inactiveMonths: ['2026-03'] }],
    { excludeMonths: ['2026-05'] }, H1,
  );
  const months = r.assignments.map((a) => a.month);
  // 02 occupé, 03 inactif, 05 exclu → restent 01, 04, 06
  assert.deepEqual(months, ['2026-01', '2026-04', '2026-06']);
});

test('capacité par mois : le surplus glisse au mois suivant, par priorité', () => {
  const sites = [
    { id: 'hi', riskLevel: 'moyenne', lastVisitMonth: null }, // freq 2 → veut 01,03,05
    { id: 'lo', riskLevel: 'faible', lastVisitMonth: null },  // freq 3 → veut 01,04
  ];
  // capacité 1/mois. En janvier les deux veulent une visite : le site moyen
  // (prioritaire) prend janvier, le faible glisse à février.
  const r = generatePlan(sites, { capacityPerMonth: 1 }, H1);
  assert.ok(r.perMonth.every((m) => m.count <= 1), 'jamais plus que la capacité');
  const lo = r.assignments.filter((a) => a.siteId === 'lo').map((a) => a.month);
  assert.equal(lo[0], '2026-02'); // glissé depuis janvier (pris par le site moyen)
  const janv = r.assignments.filter((a) => a.month === '2026-01');
  assert.deepEqual(janv.map((a) => a.siteId), ['hi']);
});

test('résumé : couverture = sites couverts / sites plannables', () => {
  const sites = [
    { id: 'a', riskLevel: 'elevee', lastVisitMonth: null },
    { id: 'b', riskLevel: 'faible', lastVisitMonth: null, forbidden: true },
    { id: 'c', riskLevel: 'moyenne', lastVisitMonth: null },
  ];
  const r = generatePlan(sites, {}, H1);
  assert.equal(r.summary.sitesConsidered, 3);
  assert.equal(r.summary.forbidden, 1);
  assert.equal(r.summary.sitesActivePlannable, 2);
  assert.equal(r.summary.sitesCovered, 2);
  assert.equal(r.summary.coverageRate, 100);
});

test('cadenceMonths : pas de doublon, borné à la période', () => {
  const site = { id: 's', riskLevel: 'faible', lastVisitMonth: null };
  const c = cadenceMonths(site, H1, 3, new Set());
  assert.deepEqual(c, ['2026-01', '2026-04']);
  assert.equal(new Set(c).size, c.length);
});

test('aucun mois / aucune entrée : plan vide, pas d\'erreur', () => {
  assert.deepEqual(generatePlan([], {}, []).assignments, []);
  assert.deepEqual(generatePlan([{ id: 's', riskLevel: 'elevee' }], {}, []).assignments, []);
  const r = generatePlan([], {}, H1);
  assert.equal(r.summary.coverageRate, null);
});
