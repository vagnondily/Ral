/**
 * Générateur de plan réaliste (lot 5, § 7) — module pur. Chaque scénario vérifie aussi les
 * invariants (planInvariants, recalcul indépendant) : ≤ 1 visite par site × mois, jamais sur
 * un garde-fou, capacité de visites et de jours-personne, journée ≤ 100 %, intervalle de
 * revisite. Puis jeux synthétiques à graine fixe : invariants, déterminisme et indépendance
 * de l'ordre d'entrée, sous plusieurs réglages.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePlan, costUnits, mainReason, U } = require('../src/modules/tpm/planGenerator');
const { effectiveInterval, fromRow, withOverrides } = require('../src/modules/tpm/planSettings');
const { checkInvariants } = require('../src/modules/tpm/planInvariants');
const { fingerprintResult } = require('../src/modules/tpm/planFingerprint');
const { assemble } = require('../src/modules/tpm/planInputs');
const { synthRaw, mulberry32 } = require('../scripts/perf/planSynth');

const months = (over = {}) => Array.from({ length: 12 }, (_, i) => ({ active: true, forbidden: false, st: null, ...(over[i + 1] || {}) }));
function site(id, o = {}) {
  const { monthsOver, commune = 'c1', district = 'd1', place, ...rest } = o;
  return {
    id, code: id, inScope: true, poolKey: 'P', districtKey: district, communeKey: `${district}|${commune}`,
    placeKey: `${district}|${commune}|${place || id}`, risk: 'elevee', urgent: false, urgentSignals: [], finalScore: 0, lastReal: null,
    months: months(monthsOver), ...rest,
  };
}
function pool(o = {}) {
  const vpd = o.vpd ?? 3; const cap = o.cap ?? 10;
  const interval = o.interval || effectiveInterval({ operationDuration: o.duration ?? 12, riskLevel: o.risk ?? 2, numberOfSites: 10, feasible: cap }, o.objective || 'mmr_complet');
  return {
    key: o.key || 'P', interval, runningMonths: o.runningMonths || null, visitsCap: cap, yearCap: o.yearCap ?? null,
    costUnits: costUnits(vpd), dayCapUnits: o.dayCap === undefined ? Math.ceil((cap * costUnits(vpd)) / U) * U : o.dayCap,
    frequency: 2, workingDays: o.workingDays ?? null, vpd,
  };
}
function run(sites, pools, params = {}, { from = 1, to = 12 } = {}) {
  const input = { year: 2027, fromMonth: from, toMonth: to, sites, pools: Object.fromEntries([].concat(pools).map((p) => [p.key, p])), params: { ...fromRow(null), ...params } };
  const r = generatePlan(input);
  assert.deepEqual(checkInvariants(input, r), [], 'invariants');
  return { input, r, at: (id, m) => r.proposals.find((p) => p.siteId === id && (m == null || p.month === m)), code: (id, m) => r.sites.find((s) => s.siteId === id).codes[m] };
}

test('unités entières : 1 journée = 252 000, coût exact pour 0,5 / 1,5 / 2,5 / 3 / 7 suivis par jour', () => {
  assert.equal(U, 252000);
  assert.equal(costUnits(0.5), 2 * U);
  assert.equal(costUnits(1.5) * 1.5, U);
  assert.equal(costUnits(2.5) * 2.5, U);
  assert.equal(costUnits(3) * 3, U);
  assert.equal(costUnits(7) * 7, U);
  assert.throws(() => costUnits(0));
});

test('regroupement : 3 sites de la même commune à 3/j → 1 journée ; le 4ᵉ ouvre la 2ᵉ', () => {
  const { r, at } = run(['a', 'b', 'c', 'd'].map((id) => site(id)), pool({ cap: 10 }), {}, { from: 1, to: 1 });
  assert.equal(r.proposals.length, 4);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => at(id).day), [1, 1, 1, 2]);
  assert.equal(at('a').why, 'du');
  assert.equal(at('b').why, 'meme_commune');
  assert.equal(at('b').anchor, 'a');
  assert.equal(r.pools.P.generatedDays, 2);
});

test('journées multi-activités : 1/3 + 1/2 tiennent dans une journée, 1/3 de plus ouvre une autre journée', () => {
  const sites = [site('a1', { poolKey: 'A', place: 'L' }), site('b1', { poolKey: 'B', place: 'L' }), site('c1', { poolKey: 'C', place: 'L' })];
  const pools = [pool({ key: 'A', vpd: 3, cap: 5 }), pool({ key: 'B', vpd: 2, cap: 5 }), pool({ key: 'C', vpd: 3, cap: 5 })];
  const { at, r } = run(sites, pools, {}, { from: 1, to: 1 });
  assert.equal(at('a1').day, 1);
  assert.equal(at('b1').day, 1);
  assert.equal(at('b1').why, 'meme_lieu');
  assert.equal(at('c1').day, 2);
  const day1 = r.months[0].tours[0].stops[0].days[0];
  assert.equal(day1.used, costUnits(3) + costUnits(2)); // 5/6 de journée
  // Désactivées : chaque activité ouvre sa propre journée.
  const sep = run(sites, pools, { multiActivityDays: false }, { from: 1, to: 1 });
  assert.deepEqual(['a1', 'b1', 'c1'].map((id) => sep.at(id).day), [1, 2, 3]);
});

test('tournée : après l\'ancre, la commune la plus fournie du district d\'abord', () => {
  const sites = [site('a0', { commune: 'c1' }), site('b1', { commune: 'c2' }),
    site('c1x', { commune: 'c3' }), site('c2x', { commune: 'c3' }), site('c3x', { commune: 'c3' })];
  const { at, code } = run(sites, pool({ cap: 4, dayCap: 10 * U }), {}, { from: 1, to: 1 });
  assert.ok(at('a0'));
  for (const id of ['c1x', 'c2x', 'c3x']) { assert.equal(at(id).why, 'meme_district'); assert.equal(at(id).anchor, 'a0'); }
  assert.equal(at('b1'), undefined, 'la commune la moins fournie attend');
  assert.equal(code('b1', 1), 'capacite_visites');
  // Sans « compléter la tournée », le district n'est pas balayé : la commune suivante dans l'ordre passe.
  const noFill = run(sites, pool({ cap: 4, dayCap: 10 * U }), { fillDistrict: false }, { from: 1, to: 1 });
  assert.equal(noFill.at('b1').why, 'du');
});

test('paliers : une Basse voisine ne passe jamais avant une Moyenne ailleurs', () => {
  const levelOf = (s) => (s.id.startsWith('b') ? 'basse' : 'moyenne');
  const sites = [site('m1', { commune: 'c1' }), site('b1', { commune: 'c1' }), site('m2', { district: 'd2', commune: 'c9' })];
  const { at, code } = run(sites, pool({ cap: 2, dayCap: 10 * U }), { levelOf }, { from: 1, to: 1 });
  assert.ok(at('m1'));
  assert.ok(at('m2'));
  assert.equal(at('b1'), undefined);
  assert.equal(code('b1', 1), 'capacite_visites');
});

test('urgent d\'abord, avec l\'écart minimal urgent, UNE fois sur l\'horizon', () => {
  const sites = [site('n1'), site('u1', { urgent: true, urgentSignals: [{ code: 'fraud', value: 1 }], lastReal: '2026-12', commune: 'c2' })];
  const { at, r } = run(sites, pool({ cap: 1, dayCap: 10 * U }), {}, { from: 1, to: 6 });
  assert.equal(at('u1', 1).why, 'urgent');
  assert.deepEqual(at('u1', 1).detail.signals, [{ code: 'fraud', value: 1 }]);
  assert.equal(r.proposals.filter((p) => p.siteId === 'u1').length, 1, 'pas de revisite urgente chaque mois');
  assert.equal(at('n1', 2).why, 'du');
});

test('intervalle de revisite en arrière ET en avant (une visite déjà prévue plus tard compte)', () => {
  const sites = [site('a', { lastReal: '2026-12' }), site('b', { monthsOver: { 11: { st: 'planifie' } } })];
  const { at, code, r } = run(sites, pool({ cap: 5 }), {}, { from: 1, to: 12 });
  assert.equal(code('a', 1), 'intervalle'); // dernière visite il y a 1 mois, intervalle 6
  assert.deepEqual(r.sites.find((s) => s.siteId === 'a').codes[1], 'intervalle');
  assert.ok(at('a', 6), 'dû au 6ᵉ mois');
  assert.equal(at('b', 6), undefined, '11 − 6 < 6 : trop près de la visite prévue');
  assert.ok(at('b', 1), 'b en janvier : 10 mois avant la visite prévue');
  assert.equal(code('b', 6), 'intervalle');
});

test('couverture : objectif sur l\'exercice — un site réalisé en mars n\'est pas un candidat « couverture » en octobre', () => {
  const sites = [site('mars', { monthsOver: { 3: { st: 'realise' } } }), site('jamais', { commune: 'c2' })];
  const { at, code, r } = run(sites, pool({ cap: 5 }), { levels: ['haute'] }, { from: 10, to: 12 });
  assert.equal(at('mars'), undefined);
  assert.equal(code('mars', 10), 'non_du');
  assert.equal(at('jamais').why, 'couverture');
  assert.equal(r.pools.P.coveredBefore, 1);
  assert.equal(r.pools.P.covered, 2);
});

test('quota de couverture lissé sur les mois restants (80 % de 10 sites sur 4 mois → 2 par mois)', () => {
  const sites = Array.from({ length: 10 }, (_, i) => site(`s${i}`, { commune: `c${i}` }));
  const { r, code } = run(sites, pool({ cap: 10, dayCap: 20 * U }), { levels: ['haute'] }, { from: 1, to: 4 });
  const perMonth = [1, 2, 3, 4].map((m) => r.proposals.filter((p) => p.month === m).length);
  assert.deepEqual(perMonth, [2, 2, 2, 2]);
  assert.equal(r.pools.P.covered, 8);
  assert.equal(r.pools.P.target, 8);
  assert.ok(r.pools.P.meetsTarget);
  const left = r.sites.filter((s) => !s.generated.length);
  assert.equal(left.length, 2);
  assert.equal(code(left[0].siteId, 4), 'quota_couverture');
});

test('projection : manque, journées-personne et ≈ personnes calculés sur les visites par journée obtenues', () => {
  const sites = Array.from({ length: 10 }, (_, i) => site(`s${i}`, { commune: `c${i}` }));
  const { r } = run(sites, pool({ cap: 1, workingDays: 20 }), {}, { from: 10, to: 12 });
  const p = r.pools.P;
  assert.equal(p.generatedVisits, 3);
  assert.equal(p.generatedDays, 3); // sites isolés : une journée chacun
  assert.equal(p.visitsPerDay, 1);
  assert.equal(p.target, 8);
  assert.equal(p.missing, 5);
  assert.equal(p.personDays, 5);
  assert.equal(p.extraPersons, 1); // ⌈5 ÷ (20 jours × 3 mois)⌉
  assert.equal(p.meetsTarget, false);
});

test('capacité « faisable » seule : des sites isolés coûtent une journée chacun, regrouper en place davantage', () => {
  const isolated = Array.from({ length: 6 }, (_, i) => site(`i${i}`, { commune: `c${i}`, district: `d${i}` }));
  const grouped = Array.from({ length: 6 }, (_, i) => site(`g${i}`));
  const a = run(isolated, pool({ cap: 6, vpd: 3 }), {}, { from: 1, to: 1 }); // 2 journées-personne
  const b = run(grouped, pool({ cap: 6, vpd: 3 }), {}, { from: 1, to: 1 });
  assert.equal(a.r.proposals.length, 2);
  assert.equal(b.r.proposals.length, 6);
  assert.equal(a.code('i5', 1), 'capacite_jours');
});

test('chaque code de report', () => {
  const sites = [
    site('nomm', { poolKey: null, commune: 'z1' }),
    site('forb', { monthsOver: { 1: { forbidden: true, active: false } }, commune: 'z2' }),
    site('inact', { monthsOver: { 1: { active: false } }, commune: 'z3' }),
    site('annul', { monthsOver: { 1: { st: 'annule' } }, commune: 'z4' }),
    site('inter', { lastReal: '2026-11', commune: 'z5' }),
    site('stop', { poolKey: 'Z', commune: 'z6' }),
  ];
  const { code } = run(sites, [pool({ cap: 5 }), pool({ key: 'Z', duration: 0 })], {}, { from: 1, to: 1 });
  assert.equal(code('nomm', 1), 'sans_mmr');
  assert.equal(code('forb', 1), 'zone_interdite');
  assert.equal(code('inact', 1), 'inactif');
  assert.equal(code('annul', 1), 'annulee');
  assert.equal(code('inter', 1), 'intervalle');
  assert.equal(code('stop', 1), 'hors_calendrier');
  // Mois d'activité connus (calendrier, § 3) : hors de ces mois, rien.
  const cal = run([site('x')], pool({ runningMonths: new Set([3, 4]) }), {}, { from: 1, to: 4 });
  assert.equal(cal.code('x', 1), 'hors_calendrier');
  assert.ok(cal.at('x', 3));
  // Non dû (niveau non retenu, sans rattrapage), déjà couvert (objectif couverture).
  const nd = run([site('m')], pool(), { levels: ['haute'], coverageCatchUp: false }, { from: 1, to: 1 });
  assert.equal(nd.code('m', 1), 'non_du');
  const cov = run([site('k', { monthsOver: { 1: { st: 'realise' } } })], pool({ objective: 'couverture' }), {}, { from: 8, to: 8 });
  assert.equal(cov.code('k', 8), 'deja_couvert');
  // Capacités : visites, jours-personne, exercice.
  const cv = run([site('v1'), site('v2', { commune: 'c2' })], pool({ cap: 1, dayCap: 5 * U }), {}, { from: 1, to: 1 });
  assert.equal(cv.code('v2', 1), 'capacite_visites');
  const cj = run([site('j1'), site('j2', { commune: 'c2' })], pool({ cap: 5, dayCap: U }), {}, { from: 1, to: 1 });
  assert.equal(cj.code('j2', 1), 'capacite_jours');
  const ce = run([site('e1'), site('e2', { commune: 'c2' })], pool({ cap: 5, dayCap: 5 * U, yearCap: 1 }), {}, { from: 1, to: 1 });
  assert.equal(ce.code('e2', 1), 'capacite_exercice');
});

test('raison principale : le code le plus actionnable de l\'horizon', () => {
  assert.deepEqual(mainReason({ 1: 'inactif', 2: 'capacite_visites', 3: 'intervalle' }, { 2: { tier: 1 } }), { code: 'capacite_visites', month: 2, detail: { tier: 1 } });
  assert.equal(mainReason({ 5: 'zone_interdite', 6: 'intervalle' }, {}).code, 'intervalle');
  assert.equal(mainReason({}, {}), null);
});

test('anticipation : seulement dans la place restante d\'une journée déjà ouverte', () => {
  const sites = [site('x'), site('y', { lastReal: '2027-01' }), site('z', { lastReal: '2027-01', commune: 'c2' })];
  const { at, code } = run(sites, pool({ cap: 5, dayCap: 5 * U }), { anticipationMonths: 1 }, { from: 6, to: 6 });
  assert.ok(at('x', 6));
  assert.equal(at('y', 6).why, 'anticipee'); // dû en juillet, place libre dans la journée de x
  assert.equal(at('y', 6).day, at('x', 6).day);
  assert.equal(at('z', 6), undefined);
  assert.equal(code('z', 6), 'intervalle');
  const off = run(sites, pool({ cap: 5, dayCap: 5 * U }), {}, { from: 6, to: 6 });
  assert.equal(off.at('y', 6), undefined);
});

test('engagements existants au-delà de la capacité : signalés, jamais retirés, rien de généré en plus', () => {
  const sites = [site('p1', { monthsOver: { 1: { st: 'planifie' } } }), site('p2', { monthsOver: { 1: { st: 'realise' } }, commune: 'c2' }), site('n', { commune: 'c3' })];
  const { r, code } = run(sites, pool({ cap: 1 }), {}, { from: 1, to: 1 });
  const c = r.months[0].capacity.P;
  assert.equal(c.existing, 2);
  assert.equal(c.generated, 0);
  assert.equal(c.over, true);
  assert.ok(r.warnings.some((w) => w.code === 'engagements_depassent' && w.pool === 'P'));
  assert.equal(code('n', 1), 'capacite_visites');
});

test('suivis par jour < 1 : une visite coûte ⌈coût ÷ journée⌉ jours-personne, jamais au-delà de la capacité', () => {
  const sites = [site('h1'), site('h2')];
  const { r, code } = run(sites, pool({ cap: 5, vpd: 0.5, dayCap: 3 * U }), {}, { from: 1, to: 1 });
  assert.equal(r.proposals.length, 1);
  assert.equal(r.months[0].capacity.P.dayUsedUnits, 2 * U);
  assert.equal(code('h2', 1), 'capacite_jours');
});

test('jours de déplacement : comptés une fois par tournée (district × mois) et par activité', () => {
  const sites = [site('a', { commune: 'c1' }), site('b', { commune: 'c2' }), site('c', { district: 'd2', commune: 'c3' })];
  const { r, code } = run(sites, pool({ cap: 5, vpd: 3, dayCap: 3 * U }), { travelDaysPerTour: 1 }, { from: 1, to: 1 });
  assert.equal(r.proposals.length, 2);
  assert.equal(r.months[0].capacity.P.dayUsedUnits, 3 * U); // 1 + 1 déplacement, puis 1
  assert.equal(code('c', 1), 'capacite_jours');
});

test('hors périmètre : jamais proposé, mais ses visites existantes consomment la capacité commune', () => {
  const sites = [site('out', { inScope: false, monthsOver: { 1: { st: 'planifie' } } }), site('in', { commune: 'c2' }), site('in2', { commune: 'c3' })];
  const { r } = run(sites, pool({ cap: 2, dayCap: 5 * U }), {}, { from: 1, to: 1 });
  assert.equal(r.proposals.length, 1);
  assert.ok(!r.sites.some((s) => s.siteId === 'out'));
});

test('entrée vide, horizon passé, sites sans pool : aucune erreur', () => {
  const empty = generatePlan({ year: 2027, fromMonth: 1, toMonth: 12, sites: [], pools: {}, params: {} });
  assert.equal(empty.proposals.length, 0);
  const past = generatePlan({ year: 2025, fromMonth: 13, toMonth: 12, sites: [site('x')], pools: {}, params: {} });
  assert.ok(past.warnings.some((w) => w.code === 'horizon_passe'));
  const nopool = run([site('x', { poolKey: 'absent' })], [], {}, { from: 1, to: 2 });
  assert.equal(nopool.code('x', 1), 'sans_mmr');
});

// ---- Jeux synthétiques à graine fixe ---------------------------------------------------
function shuffle(arr, seed) {
  const rnd = mulberry32(seed); const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const VARIANTS = [
  {},
  { objective: 'mmr_complet' },
  { objective: 'couverture', coverageTargetPct: 95 },
  { dayGrouping: 'lieu', multiActivityDays: false },
  { dayGrouping: 'district', fillDistrict: false },
  { anticipationMonths: 2, travelDaysPerTour: 1, capacityMarginPct: 150 },
  { levels: ['haute'], defaultVisitsPerDay: 2.5, generalRowMode: 'commune' },
];

test('jeux synthétiques : 0 violation d\'invariant, déterministe, indépendant de l\'ordre d\'entrée', () => {
  let total = 0;
  VARIANTS.forEach((v, i) => {
    const raw = synthRaw({ n: 400 + i * 50, seed: 7 + i, year: 2027, gridShare: i % 2, persons: i % 3 === 0 });
    const settings = withOverrides(fromRow(null), v);
    const a = assemble(raw, { year: 2027, todayMonth: '2026-10', from: 1, to: 12, settings, scope: i === 4 ? { district: 'District 3' } : {} });
    const r1 = generatePlan(a.input);
    assert.deepEqual(checkInvariants(a.input, r1), [], `invariants, variante ${i}`);
    const r2 = generatePlan(a.input);
    assert.equal(fingerprintResult(r2), fingerprintResult(r1), `déterminisme, variante ${i}`);
    const r3 = generatePlan({ ...a.input, sites: shuffle(a.input.sites, 99 + i) });
    assert.equal(fingerprintResult(r3), fingerprintResult(r1), `ordre d'entrée, variante ${i}`);
    total += r1.proposals.length;
    assert.ok(r1.proposals.length > 0, `variante ${i} : des visites proposées`);
  });
  assert.ok(total > 1000);
});

test('jeu synthétique : mois courant au milieu de l\'exercice — rien avant, engagements existants respectés', () => {
  const raw = synthRaw({ n: 600, seed: 3, year: 2026, gridShare: 1 });
  const a = assemble(raw, { year: 2026, todayMonth: '2026-10', from: 1, to: 12, settings: fromRow(null) });
  assert.equal(a.input.fromMonth, 10);
  const r = generatePlan(a.input);
  assert.deepEqual(checkInvariants(a.input, r), []);
  assert.ok(r.proposals.every((p) => p.month >= 10));
});
