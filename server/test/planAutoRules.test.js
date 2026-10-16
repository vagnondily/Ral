/**
 * Planification automatique — garde-fous de fiabilité (revue du 16/10, P1), moteur pur :
 * règle unique « site actif au mois M », intervalle face à toutes les visites, repli RBM
 * idempotent, capacités partant des visites existantes, mois annulés, ligne MMR de durée 0,
 * couverture et raisons, jamais un mois échu — puis un oracle d'invariants (planAutoInvariants)
 * sur des jeux aléatoires à graine fixe, et l'idempotence (un 2ᵉ passage n'ajoute rien).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePlan, anchorsOf, fitCount, firstPlannableMonth } = require('../src/modules/tpm/planAuto');
const { checkInvariants } = require('../src/modules/tpm/planAutoInvariants');
const { isActiveMonth, activeMonthSql } = require('../src/modules/common/siteActivity');

const YEAR = 2026;
const FULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const site = (o) => ({ forbidden: false, parametered: false, required: 0, visits: [], monthStatus: {}, riskLevel: 'moyenne', lastVisitMonth: null, mmrKey: null, activity: 'A', ...o });
const monthsOf = (r, id) => r.assignments.filter((a) => a.siteId === id).map((a) => Number(a.month.slice(5)));
// Applique un plan : ses affectations deviennent des visites prévues.
const applied = (sites, r) => sites.map((s) => ({ ...s, visits: [...(s.visits || []), ...monthsOf(r, s.id).map((m) => ({ month: m, status: 'planifie' }))] }));

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
  assert.deepEqual(anchorsOf({ visits: [{ month: 2, status: 'annule' }, { month: 5, status: 'realise' }], lastVisitMonth: '2025-11' }, YEAR).sort(),
    [2025 * 12 + 10, 2026 * 12 + 4].sort());
  assert.equal(fitCount(YEAR, FULL, [], 4), 3);              // 1, 5, 9
  assert.equal(fitCount(YEAR, FULL, [2026 * 12 + 5], 4), 2);  // juin pris : 1/2 et 10
});

test('repli RBM idempotent : un 2ᵉ passage sur la même période n\'ajoute rien', () => {
  const s = [site({ id: 'A', riskLevel: 'faible' }), site({ id: 'B', riskLevel: 'elevee' }), site({ id: 'C', riskLevel: 'moyenne', visits: [{ month: 2, status: 'realise' }] })];
  const r1 = generatePlan(s, {}, {}, FULL, YEAR);
  assert.deepEqual(monthsOf(r1, 'A'), [1, 4, 7, 10]);
  assert.equal(monthsOf(r1, 'B').length, 12);
  const r2 = generatePlan(applied(s, r1), {}, {}, FULL, YEAR);
  assert.equal(r2.summary.planned, 0);
  assert.equal(r2.summary.coverageRate, 100);
});

test('capacités : les visites déjà prévues du mois comptent (MMR, globale, TPM)', () => {
  const mmr = { K: { interval: 12, feasible: 5 } };
  const mk = (id, visits) => site({ id, commune: `c${id}`, parametered: true, mmrKey: 'K', required: 1, visits });
  const sites = [];
  for (let i = 0; i < 5; i += 1) sites.push(mk(`old${i}`, [{ month: 11, status: 'planifie' }]));
  for (let i = 0; i < 5; i += 1) sites.push(mk(`new${i}`, []));
  const r = generatePlan(sites, mmr, { overflowPct: 0 }, [11], YEAR);
  assert.equal(r.summary.planned, 0);                  // novembre déjà plein (5/5)
  assert.equal(r.summary.uncoveredByReason.capacity, 5);
  assert.equal(r.perMonth[0].existing, 5);
  // Plafond global : 2 réalisées en janvier, plafond 2 → rien de plus en janvier.
  const g = generatePlan([site({ id: 'r1', visits: [{ month: 1, status: 'realise' }], riskLevel: 'faible' }), site({ id: 'r2', visits: [{ month: 1, status: 'realise' }], riskLevel: 'faible' }), site({ id: 'n', riskLevel: 'elevee' })],
    {}, { capacityPerMonth: 2 }, [1, 2], YEAR);
  assert.deepEqual(monthsOf(g, 'n'), [2]);
  // Plafond par TPM : une visite existante du TPM T en mars, plafond 1 → le nouveau site va ailleurs.
  const seg = [{ from: `${YEAR}-01`, to: `${YEAR}-12`, providerId: 'T', providerName: 'T' }];
  const t = generatePlan([site({ id: 'o', tpmSegments: seg, riskLevel: 'faible', visits: [{ month: 3, status: 'planifie' }] }), site({ id: 'p', tpmSegments: seg, riskLevel: 'elevee' })],
    {}, { tpmCapacityPerMonth: 1 }, [3, 4], YEAR);
  assert.deepEqual(monthsOf(t, 'p'), [4]);
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
  const r = generatePlan(sites, mmr, {}, [11, 12], YEAR, { yearHasGrid: false });
  const why = Object.fromEntries(r.uncovered.map((u) => [u.siteId, u.reason]));
  // « met » : exigence remplie (réalisée en février) → couvert sans visite.
  assert.ok(!('met' in why));
  assert.equal(why.gap, 'gap');              // réalisée en octobre, intervalle 6 → rien avant avril
  // Capacité 1/mois : t1 (risque élevé, d'abord) et t2 ont chacun un mois ; la 2ᵉ visite de t1
  // n'a plus de place — visite non placée pour cause de capacité, site couvert.
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
    K1: { interval: 1 + Math.floor(r() * 6), feasible: r() < 0.5 ? 1 + Math.floor(r() * 8) : null, targetedPerMonth: 3 },
    K2: { interval: 2.5, adjustedInterval: 4, feasible: 2 + Math.floor(r() * 5) },
    K3: { interval: 6, feasible: null, targetedPerMonth: null },
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
      if (p < 0.06) visits.push({ month: m, status: 'planifie' });
      else if (p < 0.1) visits.push({ month: m, status: 'realise' });
      else if (p < 0.12) visits.push({ month: m, status: 'annule' });
    }
    const monthStatus = {};
    if (grid) for (let m = 1; m <= 12; m += 1) { const p = r(); if (p < 0.6) monthStatus[m] = true; else if (p < 0.8) monthStatus[m] = false; }
    const tpm = pick(tpms);
    return {
      id: `s${String(i).padStart(3, '0')}`, name: `Site ${i}`, district: `D${i % 3}`, commune: `C${i % 7}`,
      activity: r() < 0.9 || parametered ? `Act${mmrKey || 'x'}` : null,
      riskLevel: pick(['faible', 'moyenne', 'elevee']), forbidden: r() < 0.05, inScope: r() < 0.9,
      parametered, mmrKey, required: mmrKey && mmrKey !== 'K0' ? 1 + Math.floor(r() * 4) : 0,
      lastVisitMonth: r() < 0.3 ? `2025-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}` : null,
      visits: visits.filter((v) => v.status !== 'annule'), cancelledMonths: visits.filter((v) => v.status === 'annule').map((v) => v.month),
      monthStatus, gpsLat: r() < 0.3 ? -18 - r() : null, gpsLng: r() < 0.3 ? 47 + r() : null,
      tpmSegments: tpm ? [{ from: `${YEAR}-01`, to: `${YEAR}-12`, providerId: tpm, providerName: tpm }] : [],
    };
  });
  const from = 1 + Math.floor(r() * 12);
  const to = from + Math.floor(r() * (13 - from));
  const months = []; for (let m = from; m <= to; m += 1) months.push(m);
  const settings = {
    overflowPct: pick([0, 10, 50]),
    capacityPerMonth: r() < 0.3 ? 5 + Math.floor(r() * 20) : null,
    tpmCapacityPerMonth: r() < 0.3 ? 3 + Math.floor(r() * 10) : null,
    excludeMonths: r() < 0.3 ? [`${YEAR}-${String(pick(months)).padStart(2, '0')}`] : [],
    coverAllOnce: r() < 0.15,
    adjusted: r() < 0.3,
    groupByCommune: r() < 0.8,
    useMmrCapacity: r() < 0.85,
  };
  const opts = { yearHasGrid: grid, fromMonth: r() < 0.5 ? `${YEAR}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}` : null };
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

test('oracle : il détecte une violation fabriquée (intervalle, mois inactif, doublon)', () => {
  const input = { sites: [site({ id: 'a', parametered: true, mmrKey: 'K', required: 3, visits: [{ month: 6, status: 'planifie' }], monthStatus: { 1: true, 5: true, 6: true } })],
    mmrByKey: { K: { interval: 4, feasible: 100 } }, settings: {}, months: FULL, year: YEAR, opts: {} };
  const fake = { assignments: [{ siteId: 'a', month: '2026-05' }, { siteId: 'a', month: '2026-02' }, { siteId: 'a', month: '2026-02' }],
    summary: { planned: 3 }, perMonth: [{ count: 3 }], byActivity: [{ planned: 3 }] };
  const codes = new Set(checkInvariants(input, fake).map((x) => x.code));
  for (const c of ['intervalle', 'inactif', 'doublon']) assert.ok(codes.has(c), `${c} détecté`);
});
