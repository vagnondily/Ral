/**
 * Planification automatique — garde-fous de fiabilité (revue du 16/10, P1), moteur pur :
 * règle unique « site actif au mois M », intervalle face à toutes les visites, repli RBM
 * idempotent, capacités partant des visites existantes, mois annulés, ligne MMR de durée 0,
 * couverture et raisons, jamais un mois échu — puis un oracle d'invariants (planAutoInvariants)
 * sur des jeux aléatoires à graine fixe, et l'idempotence (un 2ᵉ passage n'ajoute rien).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePlan, anchorsOf, fitCount, firstPlannableMonth, mmrRule, capacityOf } = require('../src/modules/tpm/planAuto');
const { checkInvariants } = require('../src/modules/tpm/planAutoInvariants');
const { isActiveMonth, activeMonthSql } = require('../src/modules/common/siteActivity');

const YEAR = 2026;
const FULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const site = (o) => ({ forbidden: false, parametered: false, required: 0, visits: [], monthStatus: {}, riskLevel: 'moyenne', lastVisitMonth: null, mmrKey: null, activity: 'A', ...o });
const monthsOf = (r, id) => r.assignments.filter((a) => a.siteId === id).map((a) => Number(a.month.slice(5)));
// Applique un plan : ses affectations deviennent des visites prévues (avec date et agent si l'option
// « Écrire les dates et les agents » est simulée).
const applied = (sites, r, withSlots = false) => sites.map((s) => ({ ...s, visits: [...(s.visits || []), ...r.assignments.filter((a) => a.siteId === s.id).map((a) => {
  const slot = withSlots ? r.slots[`${a.siteId}|${a.month}`] : null;
  return { month: Number(a.month.slice(5)), status: 'planifie', ...(slot ? { date: slot.date, agent: `Agent ${slot.agent}` } : {}) };
})] }));

test('règle unique : isActiveMonth et son jumeau SQL', () => {
  assert.equal(isActiveMonth(undefined, false), true);   // pas de grille : tout le registre
  assert.equal(isActiveMonth(false, false), false);
  assert.equal(isActiveMonth(undefined, true), false);   // grille : case vide = inactive
  assert.equal(isActiveMonth(null, true), false);
  assert.equal(isActiveMonth(true, true), true);
  assert.equal(isActiveMonth(false, true), false);
  const sql = activeMonthSql({ site: 't.site_id', year: '$6', month: '$7' });
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM site_month_status gy WHERE gy\.tenant_id = \$1 AND gy\.year = \$6\)/);
  assert.match(sql, /gm\.site_id = t\.site_id\s+AND gm\.year = \$6 AND gm\.month = \$7 AND gm\.active/);
});

test('année avec grille : seuls les « Oui » sont planifiables, une case vide ne l\'est jamais', () => {
  const mmr = { K: { interval: 1, feasible: 100 } };
  const s = site({ id: 'c', parametered: true, mmrKey: 'K', required: 12, monthStatus: { 3: true, 4: false } });
  const r = generatePlan([s], mmr, {}, FULL, YEAR);
  assert.deepEqual(monthsOf(r, 'c'), [3]);
  assert.equal(r.yearHasGrid, true);
  // La grille vient d'un AUTRE site : ce site sans aucun statut n'est actif aucun mois.
  const r2 = generatePlan([site({ id: 'x', parametered: true, mmrKey: 'K', required: 2 }), site({ id: 'y', monthStatus: { 1: true } })], mmr, {}, FULL, YEAR);
  assert.deepEqual(monthsOf(r2, 'x'), []);
  assert.equal(r2.summary.inactive, 1);
  // Valeur explicite du serveur prioritaire sur la déduction (périmètre filtré) :
  const r3 = generatePlan([site({ id: 'x', parametered: true, mmrKey: 'K', required: 2 })], mmr, {}, FULL, YEAR, { yearHasGrid: true });
  assert.deepEqual(monthsOf(r3, 'x'), []);
  // Sans grille : tout est actif.
  const r4 = generatePlan([site({ id: 'x', parametered: true, mmrKey: 'K', required: 2 })], mmr, {}, FULL, YEAR, { yearHasGrid: false });
  assert.equal(monthsOf(r4, 'x').length, 2);
});

test('intervalle face à CHAQUE visite existante, avant et après, et à la dernière visite de l\'exercice précédent', () => {
  const mmr = { K: { interval: 4, feasible: 100 } };
  // Une prévue en juin : les nouvelles visites restent à ≥ 4 mois, des deux côtés.
  const r = generatePlan([site({ id: 'b', parametered: true, mmrKey: 'K', required: 3, visits: [{ month: 6, status: 'planifie' }] })], mmr, {}, FULL, YEAR);
  const ms = monthsOf(r, 'b');
  assert.equal(ms.length, 2);
  for (const m of ms) assert.ok(Math.abs(m - 6) >= 4, `${m} trop proche de juin`);
  // Dernière visite effective en décembre de l'exercice précédent (données comprises) : pas avant avril.
  const r2 = generatePlan([site({ id: 'g', parametered: true, mmrKey: 'K', required: 3, lastVisitMonth: '2025-12' })], mmr, {}, FULL, YEAR);
  assert.deepEqual(monthsOf(r2, 'g'), [4, 8, 12]);
  assert.deepEqual(anchorsOf({ visits: [{ month: 2, status: 'annule' }, { month: 5, status: 'realise' }], lastVisitMonth: '2025-11' }, YEAR),
    [2025 * 12 + 10, 2026 * 12 + 4]);
  assert.equal(fitCount(YEAR, FULL, [], 4), 3);              // 1, 5, 9
  assert.equal(fitCount(YEAR, FULL, [2026 * 12 + 5], 4), 2);  // juin pris : 1/2 et 10
});

test('repli RBM idempotent : un 2ᵉ passage sur la même période n\'ajoute rien', () => {
  const s = [site({ id: 'A', riskLevel: 'faible' }), site({ id: 'B', riskLevel: 'elevee' }), site({ id: 'C', riskLevel: 'moyenne', visits: [{ month: 2, status: 'realise' }] })];
  const r1 = generatePlan(s, {}, {}, FULL, YEAR);
  // Faible (tous les 3 mois) : 4 visites espacées d'au moins 3 mois ; élevé : tous les mois.
  const a = monthsOf(r1, 'A');
  assert.equal(a.length, 4);
  assert.ok(a.every((m, i) => i === 0 || m - a[i - 1] >= 3), `écart respecté : ${a}`);
  assert.equal(monthsOf(r1, 'B').length, 12);
  const r2 = generatePlan(applied(s, r1), {}, {}, FULL, YEAR);
  assert.equal(r2.summary.planned, 0);
  assert.equal(r2.summary.coverageRate, 100);
});

test('capacités : les visites déjà prévues du mois comptent (faisable du MMR, et la répartition)', () => {
  const mmr = { K: { interval: 12, feasible: 5 } };
  const mk = (id, visits) => site({ id, commune: `c${id}`, parametered: true, mmrKey: 'K', required: 1, visits });
  const sites = [];
  for (let i = 0; i < 5; i += 1) sites.push(mk(`old${i}`, [{ month: 11, status: 'planifie' }]));
  for (let i = 0; i < 5; i += 1) sites.push(mk(`new${i}`, []));
  // « Limiter à la capacité déclarée » : novembre déjà plein (5/5) → rien de plus, raison « capacité ».
  const r = generatePlan(sites, mmr, { strategy: 'capacite' }, [11], YEAR);
  assert.equal(r.summary.planned, 0);
  assert.equal(r.summary.uncoveredByReason.capacity, 5);
  assert.equal(r.perMonth[0].existing, 5);
  // « Selon les besoins » : les 5 visites exigées sont placées, le dépassement est SIGNALÉ.
  const b = generatePlan(sites, mmr, {}, [11], YEAR);
  assert.equal(b.summary.planned, 5);
  assert.equal(b.byActivity[0].perMonth[0].total, 10);
  assert.equal(b.byActivity[0].perMonth[0].overCapacity, true);
  // La répartition tient compte des visites existantes : janvier déjà chargé reçoit moins.
  const j = generatePlan([...sites.slice(5), ...[0, 1, 2, 3, 4].map((i) => mk(`jan${i}`, [{ month: 1, status: 'planifie' }]))], mmr, {}, FULL, YEAR);
  assert.equal(j.perMonth[0].count, 0);
});

test('un mois d\'une visite annulée n\'est jamais repris (raison « annulée »)', () => {
  const mmr = { K: { interval: 1, feasible: 100 } };
  const r = generatePlan([site({ id: 'a', parametered: true, mmrKey: 'K', required: 1, cancelledMonths: [5] })], mmr, {}, [5], YEAR);
  assert.equal(r.summary.planned, 0);
  assert.equal(r.uncovered[0].reason, 'cancelled');
  // Une ligne « annule » dans visits compte aussi.
  const r2 = generatePlan([site({ id: 'a', parametered: true, mmrKey: 'K', required: 1, visits: [{ month: 5, status: 'annule' }] })], mmr, {}, [5, 6], YEAR);
  assert.deepEqual(monthsOf(r2, 'a'), [6]);
});

test('ligne MMR de durée 0 : chaque site suit le RBM de SON risque (indépendant de l\'ordre)', () => {
  const mmr = { K0: { interval: 0 } };
  const sites = [
    site({ id: 'h1', commune: 'C', riskLevel: 'faible', parametered: true, mmrKey: 'K0', required: 0 }),
    site({ id: 'h2', commune: 'D', riskLevel: 'elevee', parametered: true, mmrKey: 'K0', required: 0 }),
  ];
  for (const order of [sites, [sites[1], sites[0]]]) {
    const r = generatePlan(order, mmr, {}, FULL, YEAR);
    assert.equal(monthsOf(r, 'h1').length, 4);   // faible : tous les 3 mois
    assert.equal(monthsOf(r, 'h2').length, 12);  // élevé : tous les mois
  }
});

test('couverture : exigence déjà satisfaite = couvert ; chaque site non couvert a sa vraie raison', () => {
  const mmr = { K: { interval: 6, feasible: 100 }, T: { interval: 1, feasible: 1 } };
  const sites = [
    site({ id: 'met', parametered: true, mmrKey: 'K', required: 1, visits: [{ month: 2, status: 'realise' }] }),
    site({ id: 'gap', parametered: true, mmrKey: 'K', required: 2, visits: [{ month: 10, status: 'realise' }] }),
    site({ id: 't1', commune: 'x', parametered: true, mmrKey: 'T', required: 2, riskLevel: 'elevee' }),
    site({ id: 't2', commune: 'y', parametered: true, mmrKey: 'T', required: 1 }),
  ];
  // « Limiter à la capacité déclarée » (capacité T = 1 par mois).
  const r = generatePlan(sites, mmr, { strategy: 'capacite' }, [11, 12], YEAR, { yearHasGrid: false });
  const why = Object.fromEntries(r.uncovered.map((u) => [u.siteId, u.reason]));
  // « met » : exigence remplie (réalisée en février) → couvert sans visite.
  assert.ok(!('met' in why));
  assert.equal(why.gap, 'gap');              // réalisée en octobre, intervalle 6 → rien avant avril
  // Capacité 1/mois : t1 (échéance, d'abord) et t2 ont chacun un mois (1er passage avant une
  // visite répétée) ; la 2ᵉ visite de t1 n'a plus de place — non placée pour capacité, site couvert.
  assert.deepEqual([monthsOf(r, 't1').length, monthsOf(r, 't2').length], [1, 1]);
  assert.equal(r.summary.unplacedByReason.capacity, 1);
  assert.equal(r.summary.unplacedByReason.gap, 1);   // 2 exigées − 1 réalisée
  assert.equal(r.summary.sitesCovered, 3);   // met + t1 + t2
  assert.equal(r.summary.uncoveredByReason.gap, 1);
  // Inactif : actif en novembre seulement, mais novembre est trop proche de juin (intervalle 6) ;
  // décembre conviendrait s'il était actif.
  const off = site({ id: 'off', parametered: true, mmrKey: 'K', required: 2, visits: [{ month: 6, status: 'realise' }], monthStatus: { 11: true } });
  const r2 = generatePlan([off], mmr, {}, [11, 12], YEAR);
  assert.equal(r2.uncovered[0].reason, 'inactive');
  // Inactif TOUS les mois de la période : rien à couvrir, compté à part.
  const r4 = generatePlan([{ ...off, monthStatus: { 1: true } }], mmr, {}, [11, 12], YEAR);
  assert.equal(r4.summary.inactive, 1);
  assert.equal(r4.summary.sitesActivePlannable, 0);
  // Période trop courte : 3 exigées, intervalle 6, période de 2 mois.
  const r3 = generatePlan([site({ id: 'p', parametered: true, mmrKey: 'K', required: 3 })], mmr, {}, [1, 2], YEAR);
  assert.equal(monthsOf(r3, 'p').length, 1);
  assert.equal(r3.summary.unplacedByReason.period, 2);
  assert.equal(r3.summary.sitesCovered, 1);  // visité dans la période
});

test('jamais un mois échu : le plan commence au mois courant et le dit', () => {
  assert.equal(firstPlannableMonth(2026, '2026-10'), 10);
  assert.equal(firstPlannableMonth(2026, '2025-12'), 1);
  assert.equal(firstPlannableMonth(2026, '2027-01'), 13);
  const r = generatePlan([site({ id: 'e', riskLevel: 'elevee' })], {}, {}, FULL, YEAR, { fromMonth: '2026-10' });
  assert.deepEqual(monthsOf(r, 'e'), [10, 11, 12]);
  assert.deepEqual(r.pastMonths, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(r.summary.pastMonths, 9);
  assert.deepEqual(r.perMonth.map((m) => m.month), ['2026-10', '2026-11', '2026-12']);
});

test('hors périmètre : jamais planifié, mais ses visites consomment la capacité', () => {
  const mmr = { K: { interval: 12, feasible: 1 } };
  const r = generatePlan([
    site({ id: 'out', parametered: true, mmrKey: 'K', required: 1, inScope: false, visits: [{ month: 1, status: 'planifie' }] }),
    site({ id: 'in', parametered: true, mmrKey: 'K', required: 1 }),
    site({ id: 'out2', parametered: true, mmrKey: 'K', required: 1, inScope: false }),
  ], mmr, { overflowPct: 0 }, [1, 2], YEAR);
  assert.deepEqual(r.assignments.map((a) => `${a.siteId}:${a.month.slice(5)}`), ['in:02']);
  assert.equal(r.summary.sitesConsidered, 1);
});

test('déterministe : l\'ordre d\'entrée des sites ne change pas le plan', () => {
  const mmr = { K: { interval: 3, feasible: 3 } };
  const sites = Array.from({ length: 12 }, (_, i) => site({ id: `s${String(i).padStart(2, '0')}`, commune: `c${i % 4}`, parametered: true, mmrKey: 'K', required: 2, riskLevel: ['faible', 'moyenne', 'elevee'][i % 3] }));
  const a = generatePlan(sites, mmr, {}, FULL, YEAR);
  const b = generatePlan([...sites].reverse(), mmr, {}, FULL, YEAR);
  assert.deepEqual(a.assignments, b.assignments);
});

test('sous-périodes : 1ᵉʳ semestre puis 2ᵉ semestre (et trimestre par trimestre) ne dépassent jamais l\'exigence', () => {
  // Ligne MMR : durée 6, 2 visites (intervalle 3) ; exercice 2027 planifié en octobre 2026.
  const mmr = { K: { interval: 3, frequency: 2, operationDuration: 6 } };
  const opts = { yearHasGrid: false, fromMonth: '2026-10' };
  let s = [site({ id: 'x', parametered: true, mmrKey: 'K', required: 2 })];
  const r1 = generatePlan(s, mmr, {}, [1, 2, 3, 4, 5, 6], 2027, opts);
  assert.deepEqual(monthsOf(r1, 'x'), [1, 4]);
  s = applied(s, r1);
  const r2 = generatePlan(s, mmr, {}, [7, 8, 9, 10, 11, 12], 2027, opts);
  assert.equal(r2.summary.planned, 0, 'le 2ᵉ semestre ne replanifie pas les visites à venir du 1ᵉʳ');
  assert.equal(r2.summary.sitesCovered, 1);       // rien de dû : couvert
  // Trimestre par trimestre : 2 visites en tout.
  let q = [site({ id: 'q', parametered: true, mmrKey: 'K', required: 2 })];
  let total = 0;
  for (const part of [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]) {
    const r = generatePlan(q, mmr, {}, part, 2027, opts);
    total += r.summary.planned; q = applied(q, r);
  }
  assert.equal(total, 2);
  // Exercice en cours : octobre–décembre puis novembre–décembre le même mois → 2 visites, pas 3.
  const k1 = { K: { interval: 1 } };
  let c = [site({ id: 'c', parametered: true, mmrKey: 'K', required: 2 })];
  const a = generatePlan(c, k1, {}, [10, 11, 12], YEAR, opts); c = applied(c, a);
  const b = generatePlan(c, k1, {}, [11, 12], YEAR, opts);
  assert.equal(a.summary.planned + b.summary.planned, 2);
});

test('exercices voisins : une visite PRÉVUE de l\'exercice voisin ancre l\'intervalle (dans les deux sens)', () => {
  const mmr = { K: { interval: 3 } };
  // Décembre 2025 prévu (mois courant novembre 2025), écart 3 : 2026 commence au plus tôt en mars.
  const dec = site({ id: 'y', parametered: true, mmrKey: 'K', required: 3, outsideVisits: [{ month: '2025-12', status: 'planifie' }] });
  const r = generatePlan([dec], mmr, {}, FULL, YEAR, { yearHasGrid: false, fromMonth: '2025-11' });
  assert.ok(monthsOf(r, 'y')[0] >= 3, `première visite ${monthsOf(r, 'y')[0]} trop proche de décembre 2025`);
  assert.deepEqual(monthsOf(r, 'y'), [3, 6, 9]);
  // Janvier 2027 déjà prévu, repli RBM moyen (écart 2) : la fin de 2026 ne prend pas décembre.
  const jan = site({ id: 'z', riskLevel: 'moyenne', outsideVisits: [{ month: '2027-01', status: 'planifie' }] });
  const r2 = generatePlan([jan], {}, {}, [10, 11, 12], YEAR, { yearHasGrid: false, fromMonth: '2026-10' });
  assert.deepEqual(monthsOf(r2, 'z'), [10]);
  // Une prévue de l'exercice voisin d'un mois ÉCHU, jamais faite, n'ancre rien.
  const missed = site({ id: 'w', parametered: true, mmrKey: 'K', required: 1, outsideVisits: [{ month: '2025-12', status: 'planifie' }] });
  const r3 = generatePlan([missed], mmr, {}, FULL, YEAR, { yearHasGrid: false, fromMonth: '2026-01' });
  assert.deepEqual(monthsOf(r3, 'w'), [1]);
  // Une RÉALISÉE de l'exercice voisin ancre toujours.
  const done = site({ id: 'v', parametered: true, mmrKey: 'K', required: 1, outsideVisits: [{ month: '2025-12', status: 'realise' }] });
  assert.deepEqual(monthsOf(generatePlan([done], mmr, {}, FULL, YEAR, { yearHasGrid: false, fromMonth: '2026-01' }), 'v'), [3]);
});

test('visite prévue d\'un mois échu, jamais faite : à replanifier, jamais un ancrage (rattrapage)', () => {
  // Réalisées janvier et mai, prévue septembre non faite ; octobre 2026, période octobre–décembre.
  const mmr = { K: { interval: 4 } };
  const s = site({ id: 'm', parametered: true, mmrKey: 'K', required: 3, visits: [{ month: 1, status: 'realise' }, { month: 5, status: 'realise' }, { month: 9, status: 'planifie' }] });
  const r = generatePlan([s], mmr, {}, [10, 11, 12], YEAR, { yearHasGrid: false, fromMonth: '2026-10' });
  assert.deepEqual(monthsOf(r, 'm'), [10], 'le rattrapage est placé (5 mois après mai)');
  assert.equal(r.summary.latePlanned, 1);
  assert.deepEqual(r.uncovered, []);
  assert.deepEqual(anchorsOf(s, YEAR, '2026-10'), [2026 * 12, 2026 * 12 + 4]);   // septembre exclu
});

test('repli RBM : un mois annulé reste dû — le site n\'est jamais compté couvert pour rien', () => {
  // Élevé, seul mois possible annulé : non couvert, raison « annulée ».
  const r = generatePlan([site({ id: 'r', riskLevel: 'elevee', cancelledMonths: [11] })], {}, {}, [11], YEAR);
  assert.equal(r.summary.sitesCovered, 0);
  assert.equal(r.summary.coverageRate, 0);
  assert.deepEqual(r.uncovered.map((u) => [u.siteId, u.reason]), [['r', 'cancelled']]);
  // Parmi d'autres mois : les autres sont placés, l'annulé compte « annulée », le site est couvert.
  const r2 = generatePlan([site({ id: 'r', riskLevel: 'elevee', cancelledMonths: [11] })], {}, {}, [10, 11, 12], YEAR);
  assert.deepEqual(monthsOf(r2, 'r'), [10, 12]);
  assert.equal(r2.summary.unplacedByReason.cancelled, 1);
  assert.equal(r2.summary.sitesCovered, 1);
  // Seul mois ACTIF annulé (grille) : non couvert, « annulée » — un mois inactif n'est pas dû.
  const g = site({ id: 'g', riskLevel: 'elevee', cancelledMonths: [11], monthStatus: { 10: false, 11: true, 12: false } });
  const r3 = generatePlan([g], {}, {}, [10, 11, 12], YEAR);
  assert.deepEqual(r3.uncovered.map((u) => u.reason), ['cancelled']);
  assert.equal(r3.summary.unplacedByReason.inactive, 0);
  // Mois inactifs seulement hors de ses mois actifs : rien de dû au-delà, aucune raison inventée.
  const r4 = generatePlan([site({ id: 'h', riskLevel: 'elevee', monthStatus: { 10: true, 11: false, 12: true } })], {}, {}, [10, 11, 12], YEAR);
  assert.deepEqual(monthsOf(r4, 'h'), [10, 12]);
  assert.equal(r4.summary.unplaced, 0);
});

test('raison « capacité » seulement si la capacité a vraiment empêché une visite (contrefactuel)', () => {
  // Faisable 1/mois, intervalle 6, période novembre–décembre : b1 (2 exigées) ne peut de toute façon
  // en placer qu'une en 2 mois — raison « période », jamais « capacité ».
  const mmr = { K: { interval: 6, feasible: 1 } };
  const sites = [site({ id: 'b0', commune: 'x', riskLevel: 'elevee', parametered: true, mmrKey: 'K', required: 1 }),
    site({ id: 'b1', commune: 'y', parametered: true, mmrKey: 'K', required: 2 })];
  const r = generatePlan(sites, mmr, { strategy: 'capacite' }, [11, 12], YEAR, { yearHasGrid: false });
  assert.equal(r.summary.planned, 2);
  assert.deepEqual([r.summary.unplacedByReason.capacity, r.summary.unplacedByReason.period], [0, 1]);
});

test('capacité déclarée : entier inférieur, 0 = aucune capacité, vide = sans limite', () => {
  assert.equal(capacityOf({ feasible: 2.5 }), 2);
  assert.equal(capacityOf({ feasible: 2.9999999999 }), 3);
  assert.equal(capacityOf({ feasible: 0 }), 0);
  assert.equal(capacityOf({ feasible: null }), null);
  assert.equal(capacityOf({}), null);
  const mmr = { K: { interval: 12, feasible: 2.5 } };
  const sites = Array.from({ length: 5 }, (_, i) => site({ id: `s${i}`, commune: `c${i}`, parametered: true, mmrKey: 'K', required: 1 }));
  const r = generatePlan(sites, mmr, { strategy: 'capacite' }, [3], YEAR);
  assert.equal(r.summary.planned, 2);               // 2,5 → 2 par mois, jamais 3
  const zero = generatePlan(sites, { K: { interval: 12, feasible: 0 } }, { strategy: 'capacite' }, [3], YEAR);
  assert.equal(zero.summary.planned, 0);
  assert.equal(zero.summary.uncoveredByReason.capacity, 5);
  // « Selon les besoins » : tout est placé, le dépassement de capacité est signalé.
  const need = generatePlan(sites, { K: { interval: 12, feasible: 0 } }, {}, [3], YEAR);
  assert.equal(need.summary.planned, 5);
  assert.equal(need.byActivity[0].perMonth[0].overCapacity, true);
});

test('écart et exigence cohérents : les visites exigées tiennent dans la durée de l\'opération', () => {
  // MMR : durée 12, 5 visites, intervalle 2,4 → écart 3 ne laisserait que 4 visites ; ramené à 2.
  assert.deepEqual(mmrRule({ interval: 2.4, frequency: 5, operationDuration: 12 }, 5), { required: 5, step: 2 });
  assert.deepEqual(mmrRule({ interval: 4, frequency: 3, operationDuration: 12 }, 3), { required: 3, step: 4 });
  assert.deepEqual(mmrRule({ interval: 4.5, frequency: 2, operationDuration: 9 }, 2), { required: 2, step: 5 }); // 4,5 → 5
  // Capacité déclarée : fréquence ajustée 3,5 → 4 exigées ; intervalle ajusté 3,43 → 4 ramené à 3.
  assert.deepEqual(mmrRule({ interval: 2, adjustedInterval: 3.43, frequency: 6, operationDuration: 12 }, 4, true), { required: 4, step: 3 });
  // Capacité au-delà de la cible : jamais plus de visites que le MMR, jamais sous son écart.
  assert.deepEqual(mmrRule({ interval: 4, adjustedInterval: 2, frequency: 3, operationDuration: 12 }, 6, true), { required: 3, step: 4 });
  const full = generatePlan([site({ id: 'a', parametered: true, mmrKey: 'K', required: 4 })],
    { K: { interval: 2, adjustedInterval: 3.43, frequency: 6, operationDuration: 12, feasible: 100 } }, { strategy: 'capacite' }, FULL, YEAR);
  assert.deepEqual(monthsOf(full, 'a'), [1, 4, 7, 10]);
  assert.deepEqual([full.byActivity[0].stepUsed, full.byActivity[0].requiredUsed], [3, 4]);
  const five = generatePlan([site({ id: 'b', parametered: true, mmrKey: 'K', required: 5 })], { K: { interval: 2.4, frequency: 5, operationDuration: 12 } }, {}, FULL, YEAR);
  assert.equal(monthsOf(five, 'b').length, 5);
  assert.equal(five.summary.unplaced, 0);
});

test('plan maximal : un site différé par sa commune reçoit encore un mois qui a de la place (capacité)', () => {
  // Commune C : « a » (RBM, écart 2, visité en mai) et « b » (MMR, écart 4, 1 visite restante).
  // Juin : seul « b » est possible mais n'est pas le déclencheur de la commune ; juillet et août sont
  // pleins (faisable 1) — sans complément, « b » resterait sans visite alors que juin avait de la place.
  const sites = [
    site({ id: 'a', commune: 'C', lastVisitMonth: '2026-05' }),
    site({ id: 'b', commune: 'C', parametered: true, mmrKey: 'K', required: 2, visits: [{ month: 2, status: 'realise' }] }),
    site({ id: 'x7', commune: 'X', parametered: true, mmrKey: 'K', required: 1, visits: [{ month: 7, status: 'planifie' }] }),
    site({ id: 'x8', commune: 'Y', parametered: true, mmrKey: 'K', required: 1, visits: [{ month: 8, status: 'planifie' }] }),
  ];
  const input = { sites, mmrByKey: { K: { interval: 4, feasible: 1 } }, settings: { strategy: 'capacite' }, months: [6, 7, 8], year: YEAR, opts: { yearHasGrid: false, fromMonth: '2026-06' } };
  const r = generatePlan(input.sites, input.mmrByKey, input.settings, input.months, input.year, input.opts);
  assert.deepEqual(r.assignments.map((x) => `${x.siteId}:${x.month}`), ['b:2026-06', 'a:2026-07']);
  assert.deepEqual(r.uncovered, []);
  assert.deepEqual(checkInvariants(input, r), []);
});

test('déterministe avec des communes mêlant des écarts différents (MMR 2 et 6, RBM 1 et 3)', () => {
  const mmr = { K1: { interval: 2, feasible: 4, visitsPerDay: 2, workingDays: 10 }, K3: { interval: 6, feasible: 2, visitsPerDay: 1 } };
  const kinds = [{ parametered: true, mmrKey: 'K1', required: 4 }, { parametered: true, mmrKey: 'K3', required: 2 },
    { riskLevel: 'elevee' }, { riskLevel: 'faible' }];
  const sites = Array.from({ length: 24 }, (_, i) => site({
    id: `m${String(i).padStart(2, '0')}`, district: `D${i % 2}`, commune: `c${i % 3}`, riskLevel: ['faible', 'moyenne', 'elevee'][i % 3], ...kinds[i % 4],
    urgent: i % 7 === 0, finalScore: i % 5, visits: i % 6 === 0 ? [{ month: 5, status: 'planifie' }] : [],
    lastVisitMonth: i % 4 === 1 ? `${YEAR}-02` : null,
  }));
  for (const strategy of ['besoins', 'capacite']) {
    const settings = { strategy, reinforceUrgent: true };
    const a = generatePlan(sites, mmr, settings, FULL, YEAR, { fromMonth: '2026-03' });
    const b = generatePlan([...sites].reverse(), mmr, settings, FULL, YEAR, { fromMonth: '2026-03' });
    assert.deepEqual(a.assignments, b.assignments, strategy);
    assert.deepEqual(a.slots, b.slots, strategy);
    assert.deepEqual(a.summary, b.summary, strategy);
    assert.deepEqual(a.byActivity, b.byActivity, strategy);
    assert.deepEqual(a.byTpm, b.byTpm, strategy);
    assert.deepEqual(a.uncovered, b.uncovered, strategy);
    assert.deepEqual(checkInvariants({ sites, mmrByKey: mmr, settings, months: FULL, year: YEAR, opts: { fromMonth: '2026-03' } }, a), []);
  }
});

// ---- Oracle d'invariants sur des jeux aléatoires (graine fixe) ----------------------------
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}
function scenario(seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const keys = ['K1', 'K2', 'K3', 'K0'];
  const mmrByKey = {
    K1: { interval: 1 + Math.floor(r() * 6), feasible: r() < 0.5 ? pick([0, 1.5, 2.5, 1 + Math.floor(r() * 8)]) : null, targetedPerMonth: 3,
      operationDuration: pick([null, 12, 6, 10]), frequency: pick([null, 2, 3, 5]),
      visitsPerDay: pick([0.5, 1, 2, 3, null]), workingDays: pick([5, 20, 22, null]), personsToDeploy: pick([1, 3, null]) },
    K2: { interval: 2.4, adjustedInterval: pick([3.43, 4, 1.2]), frequency: 5, operationDuration: 12, feasible: 2 + Math.floor(r() * 5), visitsPerDay: 1.5, workingDays: 26 },
    K3: { interval: 6, feasible: null, targetedPerMonth: null, visitsPerDay: 4 },
    K0: { interval: 0 },
  };
  const grid = r() < 0.4;
  const tpms = ['T1', 'T2', null];
  const sites = Array.from({ length: 10 + Math.floor(r() * 50) }, (_, i) => {
    const parametered = r() < 0.7;
    const mmrKey = parametered ? pick(keys) : null;
    const visits = [];
    for (let m = 1; m <= 12; m += 1) {
      const p = r();
      // Une prévue sur deux est déjà datée et affectée (« Agent N ») : son créneau est réservé.
      if (p < 0.03) visits.push({ month: m, status: 'planifie', date: `${YEAR}-${String(m).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`, agent: `Agent ${1 + Math.floor(r() * 3)}` });
      else if (p < 0.06) visits.push({ month: m, status: 'planifie' });
      else if (p < 0.1) visits.push({ month: m, status: 'realise' });
      else if (p < 0.12) visits.push({ month: m, status: 'annule' });
    }
    const monthStatus = {};
    if (grid) for (let m = 1; m <= 12; m += 1) { const p = r(); if (p < 0.6) monthStatus[m] = true; else if (p < 0.8) monthStatus[m] = false; }
    const tpm = pick(tpms);
    // Exercices voisins : visites prévues / réalisées de fin 2025 et début 2027 (ancrages).
    const outsideVisits = [];
    if (r() < 0.25) {
      for (const mo of ['2025-10', '2025-11', '2025-12', '2027-01', '2027-02']) {
        const p = r();
        if (p < 0.25) outsideVisits.push({ month: mo, status: 'planifie' });
        else if (p < 0.4) outsideVisits.push({ month: mo, status: 'realise' });
      }
    }
    const lastIn = r();
    return {
      id: `s${String(i).padStart(3, '0')}`, name: `Site ${i}`, district: `D${i % 3}`, commune: `C${i % 7}`,
      activity: r() < 0.9 || parametered ? `Act${mmrKey || 'x'}` : null,
      riskLevel: pick(['faible', 'moyenne', 'elevee']), forbidden: r() < 0.05, inScope: r() < 0.9,
      urgent: r() < 0.1, finalScore: Math.floor(r() * 3),
      parametered, mmrKey, required: mmrKey && mmrKey !== 'K0' ? 1 + Math.floor(r() * 4) : 0,
      // Dernière visite effective : exercice précédent OU dans l'exercice.
      lastVisitMonth: lastIn < 0.2 ? `2025-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}`
        : (lastIn < 0.35 ? `${YEAR}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}` : null),
      visits: visits.filter((v) => v.status !== 'annule'), cancelledMonths: visits.filter((v) => v.status === 'annule').map((v) => v.month),
      outsideVisits,
      monthStatus, gpsLat: r() < 0.3 ? -18 - r() : null, gpsLng: r() < 0.3 ? 47 + r() : null,
      // Suivi interne : bureau racine du site (deux bureaux, ou aucun).
      unitOfficeId: pick(['o1', 'o2', null]), unitOfficeName: null,
      tpmSegments: tpm ? [{ from: `${YEAR}-01`, to: `${YEAR}-12`, providerId: tpm, providerName: tpm }] : [],
    };
  });
  const from = 1 + Math.floor(r() * 12);
  const to = from + Math.floor(r() * (13 - from));
  const months = []; for (let m = from; m <= to; m += 1) months.push(m);
  const settings = {
    strategy: r() < 0.6 ? 'besoins' : 'capacite',
    reinforceUrgent: r() < 0.3,
    excludedCommunes: r() < 0.3 ? [{ district: `D${Math.floor(r() * 3)}`, commune: `C${Math.floor(r() * 7)}` }] : [],
    agentsPerVehicle: 1 + Math.floor(r() * 10),
    fieldDaysPerMonth: 1 + Math.floor(r() * 26),
  };
  const fromPick = r();
  const opts = { yearHasGrid: grid,
    fromMonth: fromPick < 0.45 ? `${YEAR}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}` : (fromPick < 0.6 ? pick(['2025-11', '2025-12']) : null) };
  // Jour courant dans le mois courant : le mois en cours ne compte que ses jours restants.
  if (opts.fromMonth && r() < 0.7) opts.today = `${opts.fromMonth}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
  return { sites, mmrByKey, settings, months, year: YEAR, opts };
}

test('oracle : 0 violation d\'invariant sur 300 jeux aléatoires, et un 2ᵉ passage n\'ajoute rien', () => {
  let planned = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const input = scenario(seed);
    const r = generatePlan(input.sites, input.mmrByKey, input.settings, input.months, input.year, input.opts);
    const v = checkInvariants(input, r);
    assert.deepEqual(v, [], `graine ${seed} : ${JSON.stringify(v.slice(0, 3))}`);
    planned += r.summary.planned;
    const again = generatePlan(applied(input.sites, r), input.mmrByKey, input.settings, input.months, input.year, input.opts);
    assert.equal(again.summary.planned, 0, `graine ${seed} : le 2ᵉ passage ajoute ${again.summary.planned} visite(s)`);
  }
  assert.ok(planned > 1000, `jeux assez riches (${planned} visites générées)`);
});

test('« Écrire les dates et les agents » en deux passages (district A, puis B) : aucun agent dans deux communes le même jour', () => {
  // 50 sites du bureau o1, districts A et B (25 communes chacun), 1 visite par jour, janvier 2027.
  const sites = ['A', 'B'].flatMap((d) => Array.from({ length: 25 }, (_, i) => site({
    id: `${d}${String(i).padStart(2, '0')}`, district: d, commune: `${d}-c${i}`, parametered: true, mmrKey: 'K', required: 1, unitOfficeId: 'o1',
  })));
  const mmr = { K: { interval: 12, visitsPerDay: 1, workingDays: 20 } };
  const opts = { yearHasGrid: false, fromMonth: '2026-11', today: '2026-11-15' };
  const scoped = (list, d) => list.map((x) => ({ ...x, inScope: x.district === d }));
  const r1 = generatePlan(scoped(sites, 'A'), mmr, {}, [1], 2027, opts);
  assert.equal(r1.summary.planned, 25);
  const after1 = applied(sites, r1, true);
  const input2 = { sites: scoped(after1, 'B'), mmrByKey: mmr, settings: {}, months: [1], year: 2027, opts };
  const r2 = generatePlan(input2.sites, mmr, {}, [1], 2027, opts);
  assert.equal(r2.summary.planned, 25);
  assert.deepEqual(checkInvariants(input2, r2), []);
  // Tous les créneaux écrits des deux passages : un (agent, date) = une commune.
  const cells = new Map();
  for (const s of applied(after1, r2, true)) {
    for (const x of s.visits) {
      if (!x.agent) continue;
      const k = `${x.agent}|${x.date}`;
      if (!cells.has(k)) cells.set(k, new Set());
      cells.get(k).add(s.commune);
    }
  }
  assert.ok([...cells.values()].every((c) => c.size === 1), 'un agent, un jour, une commune');
  assert.equal(r2.resources.months[0].agentsNeeded, 3);   // 50 journées ÷ 20 jours de terrain
});

test('oracle : passages successifs sur des sous-périodes — 0 violation, jamais au-delà de l\'exigence', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const input = scenario(seed + 5000);
    const parts = [];
    const ms = [...input.months];
    const cut = 1 + (seed % 3);
    const size = Math.max(1, Math.ceil(ms.length / cut));
    for (let i = 0; i < ms.length; i += size) parts.push(ms.slice(i, i + size));
    let sites = input.sites;
    const generated = new Map();
    for (const part of parts) {
      const run = { ...input, sites, months: part };
      const r = generatePlan(sites, input.mmrByKey, input.settings, part, input.year, input.opts);
      assert.deepEqual(checkInvariants(run, r), [], `graine ${seed + 5000}, mois ${part.join(',')}`);
      for (const a of r.assignments) if (a.source !== 'renfort') generated.set(a.siteId, (generated.get(a.siteId) || 0) + 1);
      sites = applied(sites, r);
    }
    const first = firstPlannableMonth(input.year, input.opts.fromMonth);
    for (const s of input.sites) {
      if (!(s.parametered && s.mmrKey && s.required > 0)) continue;
      const existing = (s.visits || []).filter((x) => x.status === 'realise' || (x.status === 'planifie' && x.month >= first)).length;
      assert.ok(existing + (generated.get(s.id) || 0) <= Math.max(s.required, existing), `graine ${seed + 5000} : ${s.id} au-delà de l'exigence`);
    }
  }
});

test('oracle : il détecte une violation fabriquée (intervalle, mois inactif, doublon)', () => {
  const input = { sites: [site({ id: 'a', parametered: true, mmrKey: 'K', required: 3, visits: [{ month: 6, status: 'planifie' }], monthStatus: { 1: true, 5: true, 6: true } })],
    mmrByKey: { K: { interval: 4, feasible: 100 } }, settings: {}, months: FULL, year: YEAR, opts: {} };
  const fake = { assignments: [{ siteId: 'a', month: '2026-05' }, { siteId: 'a', month: '2026-02' }, { siteId: 'a', month: '2026-02' }],
    summary: { planned: 3 }, perMonth: [{ count: 3 }], byActivity: [{ planned: 3 }] };
  const codes = new Set(checkInvariants(input, fake).map((x) => x.code));
  for (const c of ['intervalle', 'inactif', 'doublon', 'sans_creneau']) assert.ok(codes.has(c), `${c} détecté`);
  // Au-delà de l'exigence, renfort injustifié, mois échu, plan non maximal, comptes faux.
  const one = { sites: [site({ id: 'b', parametered: true, mmrKey: 'K', required: 1 })], mmrByKey: { K: { interval: 1 } },
    settings: {}, months: FULL, year: YEAR, opts: { fromMonth: '2026-03' } };
  const slot = (m) => ({ [`b|2026-${m}`]: { agent: 1, date: `2026-${m}-02` } });
  const over = { assignments: [{ siteId: 'b', month: '2026-03' }, { siteId: 'b', month: '2026-05' }, { siteId: 'b', month: '2026-02' }, { siteId: 'b', month: '2026-07', source: 'renfort' }],
    slots: { ...slot('03'), ...slot('05'), ...slot('02'), ...slot('07') }, summary: { planned: 4, sitesActivePlannable: 1, sitesCovered: 1 },
    uncovered: [], perMonth: [{ count: 4 }], byActivity: [{ planned: 4 }], byTpm: [{ planned: 3 }] };
  const c2 = new Set(checkInvariants(one, over).map((x) => x.code));
  for (const c of ['au_dela_exigence', 'renfort', 'mois_echu', 'compte_unite']) assert.ok(c2.has(c), `${c} détecté`);
  const none = { assignments: [], slots: {}, summary: { planned: 0, sitesActivePlannable: 1, sitesCovered: 0 },
    uncovered: [{ siteId: 'b', reason: 'gap' }], perMonth: [], byActivity: [], byTpm: [] };
  const c3 = new Set(checkInvariants(one, none).map((x) => x.code));
  for (const c of ['besoin_non_place', 'non_maximal']) assert.ok(c3.has(c), `${c} détecté`);
});
