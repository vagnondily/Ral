const test = require('node:test');
const assert = require('node:assert/strict');
const { mmrLookup, requiredVisits, siteCounters, rankSites, boardKpis, normalizeChanges, mmrCapacity, mmrKeyOf, autoPlanMonths } = require('../src/modules/tpm/planBoard');

const MMR = [
  { fieldOfficeId: null, activityCategory: 'School meal activities', operationDuration: 10, numberOfSites: 700, riskLevel: 2, feasible: 52 },
  { fieldOfficeId: 'amb', activityCategory: 'School meal activities ', operationDuration: 9, numberOfSites: 213, riskLevel: 3, feasible: 30 },
  { fieldOfficeId: null, activityCategory: 'Nutrition treatment activities', operationDuration: 12, numberOfSites: 300, riskLevel: 1 },
];

test('MMR du site : dérogation du bureau, sinon du bureau parent, sinon plan général (espaces ignorés)', () => {
  const look = mmrLookup(MMR);
  assert.equal(look('amb', null, 'School meal activities').riskLevel, 3);
  assert.equal(look('bekily', 'amb', ' school  meal activities').riskLevel, 3); // antenne → parent
  assert.equal(look('tul', null, 'School meal activities').riskLevel, 2);      // plan général
  assert.equal(look('tul', null, 'Activité inconnue'), null);
  assert.equal(look('tul', null, ''), null);
});

test('visites exigées = fréquence MMR (niveau de risque) ; option CO adjusted arrondie au-dessus', () => {
  assert.equal(requiredVisits(MMR[0]), 2);
  assert.equal(requiredVisits(MMR[1]), 3);
  // CO adjusted : fréquence 2 × (52 / 140) = 0,74 → 1
  assert.equal(requiredVisits(MMR[0], { adjusted: true }), 1);
  assert.equal(requiredVisits(null), null);
});

test('compteurs d\'un site : faites, prévues, reste, à planifier ; non paramétré', () => {
  const c = siteCounters({ months: [{ month: 2, status: 'realise' }, { month: 6, status: 'planifie' }] }, MMR[1]);
  assert.deepEqual(c, { required: 3, done: 1, planned: 1, remaining: 2, toPlan: 1, parametered: true });
  const over = siteCounters({ months: [1, 2, 3, 4].map((m) => ({ month: m, status: 'realise' })) }, MMR[1]);
  assert.equal(over.remaining, 0);
  assert.deepEqual(siteCounters({ months: [] }, null), { required: null, done: 0, planned: 0, remaining: 0, toPlan: 0, parametered: false });
});

test('classement : reste ↓, priorité ↓, jamais visité puis visite la plus ancienne', () => {
  const r = rankSites([
    { name: 'A', remaining: 1, priority: 'Haute', lastVisitMonth: '2026-01' },
    { name: 'B', remaining: 3, priority: 'Basse', lastVisitMonth: '2026-05' },
    { name: 'C', remaining: 1, priority: 'Haute', lastVisitMonth: null },
    { name: 'D', remaining: 1, priority: 'Moyenne', lastVisitMonth: null },
  ]);
  assert.deepEqual(r.map((s) => s.name), ['B', 'C', 'A', 'D']);
});

test('KPI des deux bandeaux ; zone interdite exclue des sites à visiter et « sans plan »', () => {
  const sites = [
    { required: 2, done: 1, planned: 1, remaining: 1, toPlan: 0, parametered: true, lastVisitMonth: '2026-02', dataCount: 3 },
    { required: 2, done: 0, planned: 0, remaining: 2, toPlan: 2, parametered: true, lastVisitMonth: null, dataCount: 0 },
    { required: 3, done: 0, planned: 0, remaining: 3, toPlan: 3, parametered: true, lastVisitMonth: null, dataCount: 0, forbidden: true },
    { required: null, done: 0, planned: 0, remaining: 0, toPlan: 0, parametered: false, lastVisitMonth: null, dataCount: 1 },
  ];
  const k = boardKpis(sites);
  assert.equal(k.total, 4); assert.equal(k.active, 3); assert.equal(k.planned, 1); assert.equal(k.toVisit, 2);
  // « Sites suivis » = suivi effectif (visite réalisée OU données reçues) : site 1 (visite) + site 4 (données).
  assert.equal(k.followed, 2); assert.equal(k.fed, 2); assert.equal(k.remainingVisits, 6); assert.equal(k.notYetPlanned, 5);
  assert.equal(k.withoutPlan, 2); assert.equal(k.neverVisited, 2); assert.equal(k.unparametered, 1);
  assert.equal(k.mmrRate, 14.3); // 1 faite / 7 exigées
});

test('lot de planification : dernier changement gagne, mois invalides ignorés', () => {
  const { add, remove } = normalizeChanges([
    { siteId: 's1', month: 3, planned: true }, { siteId: 's1', month: 3, planned: false },
    { siteId: 's2', month: 13, planned: true }, { siteId: 's2', month: 4, planned: true }, { month: 5, planned: true },
  ]);
  assert.deepEqual(add, [['s2', 4]]); assert.deepEqual(remove, [['s1', 3]]);
});

test('statut courant = dernier mois renseigné ; un site inactif n\'est ni actif ni « à visiter »', () => {
  const { currentStatus } = require('../src/modules/tpm/planBoard');
  assert.equal(currentStatus({ 1: true, 2: true, 7: false }), 'Inactive');
  assert.equal(currentStatus({ 3: false, 11: true }), 'Active');
  assert.equal(currentStatus({}), null); assert.equal(currentStatus(null), null);
  const k = boardKpis([{ required: 2, done: 0, planned: 0, remaining: 2, toPlan: 2, parametered: true, inactive: true }]);
  assert.equal(k.active, 0); assert.equal(k.toVisit, 0); assert.equal(k.withoutPlan, 0);
});

test('planifier selon le MMR : mois répartis, mois occupés et inactifs évités', () => {
  assert.deepEqual(autoPlanMonths({ toPlan: 1 }), [7]);
  assert.deepEqual(autoPlanMonths({ toPlan: 2 }), [4, 10]);
  assert.deepEqual(autoPlanMonths({ toPlan: 4 }), [2, 5, 8, 11]);
  // À partir de septembre, avec octobre déjà prévu : 2 visites sur sept., nov., déc.
  assert.deepEqual(autoPlanMonths({ toPlan: 2, fromMonth: 9, busy: [10] }), [9, 12]);
  // Mois inactifs exclus ; plus de visites que de mois libres → tous les mois libres.
  assert.deepEqual(autoPlanMonths({ toPlan: 5, fromMonth: 10, inactive: [11] }), [10, 12]);
  assert.deepEqual(autoPlanMonths({ toPlan: 0 }), []);
});

test('capacité mensuelle MMR : ciblé (J) et faisable (K) par bureau × activité', () => {
  const cap = mmrCapacity(MMR);
  const amb = cap[mmrKeyOf(MMR[1])];
  // (9 mois, 213 sites, risque 3) → intervalle 3 → 71 sites ciblés / mois ; faisable 30.
  assert.equal(amb.targeted, 71); assert.equal(amb.feasible, 30); assert.equal(amb.fieldOfficeId, 'amb');
  assert.equal(cap[mmrKeyOf(MMR[2])].feasible, null);
  assert.equal(mmrKeyOf(MMR[1]), 'amb|school meal activities');
  assert.equal(mmrKeyOf(null), null);
});
