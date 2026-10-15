/**
 * Plan selon les BESOINS du MMR (lot 5, § 6.4 — retours 107 et 108) : module pur. Chaque
 * scénario vérifie aussi les invariants (planInvariants, recalcul indépendant) : ≤ 1 visite par
 * site × mois, jamais sur un garde-fou ni dans une commune exclue, écart minimal du MMR en
 * arrière et en avant, au plus les visites restantes exigées. Puis les ressources nécessaires
 * (agents, véhicules, jours de terrain, dates) et des jeux synthétiques à graine fixe
 * (invariants, déterminisme, indépendance de l'ordre d'entrée).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleNeeds, resourceNeeds, fieldDays, fieldDate } = require('../src/modules/tpm/planNeeds');
const { costUnits, U } = require('../src/modules/tpm/planGenerator');
const { effectiveInterval, fromRow, generatorParams } = require('../src/modules/tpm/planSettings');
const { checkInvariants } = require('../src/modules/tpm/planInvariants');
const { fingerprintResult } = require('../src/modules/tpm/planFingerprint');
const { assemble } = require('../src/modules/tpm/planInputs');
const { synthRaw, mulberry32 } = require('../scripts/perf/planSynth');

const PARAMS = generatorParams(fromRow(null)); // stratégie « besoins », réglages fixés
const months = (over = {}) => Array.from({ length: 12 }, (_, i) => ({ active: true, forbidden: false, st: null, ...(over[i + 1] || {}) }));
function site(id, o = {}) {
  const { monthsOver, commune = 'c1', district = 'd1', place, pool: pk = 'P', ...rest } = o;
  return {
    id, code: id, inScope: true, poolKey: pk, districtKey: district, communeKey: `${district}|${commune}`,
    placeKey: `${district}|${commune}|${place || id}`, risk: 'moyenne', urgent: false, urgentSignals: [], finalScore: 0, lastReal: null,
    months: months(monthsOver), ...rest,
  };
}
/** Pool MMR : durée 12, risque 2 → 2 visites par site, écart minimal 6 mois. */
function pool(o = {}) {
  const duration = o.duration ?? 12; const risk = o.risk ?? 2; const vpd = o.vpd ?? 3;
  const interval = effectiveInterval({ operationDuration: duration, riskLevel: risk, numberOfSites: o.sites ?? 10, feasible: 10 }, 'mmr_complet');
  return {
    key: o.key || 'P', interval, runningMonths: null, visitsCap: 10, yearCap: null, costUnits: costUnits(vpd), dayCapUnits: null,
    frequency: risk, targetedPerMonth: (o.sites ?? 10) / (duration / risk), workingDays: o.workingDays ?? null, vpd,
  };
}
function run(sites, pools, { from = 1, to = 12, year = 2027 } = {}) {
  const input = { year, fromMonth: from, toMonth: to, sites, pools: Object.fromEntries([].concat(pools).map((p) => [p.key, p])), params: PARAMS };
  const r = scheduleNeeds(input);
  assert.deepEqual(checkInvariants(input, r), [], 'invariants');
  return {
    input, r,
    visits: (id) => r.proposals.filter((p) => p.siteId === id).map((p) => p.month).sort((a, b) => a - b),
    code: (id, m) => r.sites.find((s) => s.siteId === id).codes[m],
  };
}

test('exigence : chaque site reçoit ses visites dues (= risque), à l\'écart minimal (durée ÷ risque), sur toute l\'année', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const { r, visits } = run(ids.map((id, i) => site(id, { commune: `c${i % 3}` })), pool({ sites: 6 }));
  for (const id of ids) {
    const v = visits(id);
    assert.equal(v.length, 2, `2 visites pour ${id}`);
    assert.ok(v[1] - v[0] >= 6, `écart ≥ 6 mois pour ${id} : ${v}`);
  }
  assert.equal(r.pools.P.requiredYear, 12);
  assert.equal(r.pools.P.unmet, 0);
});

test('équilibre : la charge mensuelle suit visites restantes ÷ mois restants (pas tout au premier mois)', () => {
  const ids = Array.from({ length: 24 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  // 24 sites, communes distinctes (aucune journée partagée) : 48 visites sur 12 mois → 4 par mois.
  const { r } = run(ids.map((id) => site(id, { commune: id })), pool({ sites: 24 }));
  const per = Array.from({ length: 12 }, (_, i) => r.proposals.filter((p) => p.month === i + 1).length);
  assert.equal(per.reduce((a, b) => a + b, 0), 48);
  assert.ok(Math.max(...per) <= 6 && Math.min(...per) >= 2, `charge équilibrée : ${per}`);
});

test('mois actifs : un site inactif au premier semestre n\'est visité qu\'ensuite ; ce qui ne tient plus est compté', () => {
  const off = Object.fromEntries([1, 2, 3, 4, 5, 6].map((m) => [m, { active: false }]));
  const { r, visits, code } = run([site('a', { monthsOver: off })], pool({ sites: 1 }));
  assert.deepEqual(visits('a').length, 1);
  assert.ok(visits('a')[0] >= 7);
  assert.equal(code('a', 3), 'inactif');
  assert.equal(r.pools.P.unmet, 1, 'la 2ᵉ visite ne tient plus dans l\'exercice (écart de 6 mois)');
});

test('visites existantes : elles comptent dans l\'exigence et l\'écart minimal vaut en arrière ET en avant', () => {
  // Visite prévue en juin : une seule visite restante, à 6 mois de juin → janvier ou décembre seulement.
  const { visits } = run([site('a', { monthsOver: { 6: { st: 'planifie' } } })], pool({ sites: 1 }));
  const v = visits('a');
  assert.equal(v.length, 1);
  assert.ok(v[0] === 12 || v[0] <= 0 + 1 + 0 || Math.abs(v[0] - 6) >= 6, `écart respecté : ${v}`);
  // Deux visites déjà réalisées : besoin couvert.
  const done = run([site('b', { monthsOver: { 1: { st: 'realise' }, 7: { st: 'realise' } } })], pool({ sites: 1 }), { from: 8 });
  assert.equal(done.visits('b').length, 0);
  assert.equal(done.code('b', 9), 'besoin_couvert');
});

test('échéance : un site dont c\'est le dernier mois possible passe ce mois-là (raison « echeance »)', () => {
  // Juillet → décembre, écart 5 (durée 10, risque 2) : 2 visites ne tiennent qu'en juillet + décembre.
  const { r, visits } = run([site('a')], pool({ duration: 10, sites: 1 }), { from: 7 });
  assert.deepEqual(visits('a'), [7, 12]);
  assert.equal(r.proposals.find((p) => p.month === 7).reason, 'echeance');
});

test('urgent et risque élevé d\'abord ; plus tard dans l\'exercice : raison « plus_tard » avec le mois prévu', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  const sites = ids.map((id) => site(id, { commune: id }));
  sites[11].urgent = true; sites[11].urgentSignals = [{ code: 'fraud', value: 1 }];
  sites[10].finalScore = 2;
  const { r, visits } = run(sites, pool({ sites: 12 }), { from: 1, to: 1 });
  assert.deepEqual(visits('s11'), [1]);
  assert.deepEqual(visits('s10'), [1]);
  assert.equal(r.proposals.find((p) => p.siteId === 's11').why, 'urgent');
  const later = r.sites.find((s) => s.main && s.main.code === 'plus_tard');
  assert.ok(later && later.later, 'un site attend un mois suivant, dit avec le mois');
});

test('zones : sites d\'une même commune regroupés le même jour, TOUTES activités ; jamais dans une commune exclue', () => {
  const sites = [site('a', { pool: 'A' }), site('b', { pool: 'B' }), site('c', { pool: 'A', commune: 'c2' }), site('x', { commune: 'c9', excluded: true })];
  const pools = [pool({ key: 'A', sites: 2 }), pool({ key: 'B', sites: 1 }), pool({ key: 'P', sites: 1 })];
  const { r, code } = run(sites, pools, { from: 1, to: 1 });
  const day = (id) => r.proposals.find((p) => p.siteId === id).day;
  assert.equal(day('a'), day('b'), 'même commune, deux activités : même journée');
  assert.equal(r.proposals.find((p) => p.siteId === 'b').why, 'meme_commune');
  // 'c' (autre commune, même activité que 'a') : la part de janvier de l'activité est prise → un mois suivant.
  assert.equal(code('c', 1), 'plus_tard');
  assert.equal(code('x', 1), 'acces');
  assert.ok(!r.proposals.some((p) => p.siteId === 'x'));
});

test('ressources : agents = journées ÷ jours de terrain, véhicules par district et par jour, écart au déclaré, dates', () => {
  // 12 sites isolés (12 journées) en décembre (dernier mois : tout y passe), 6 jours de terrain par
  // agent → 2 agents ; 2 districts.
  const ids = Array.from({ length: 12 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  const sites = ids.map((id, i) => site(id, { commune: id, district: i < 6 ? 'dA' : 'dB' }));
  const input = { year: 2026, fromMonth: 12, toMonth: 12, sites, pools: { P: pool({ sites: 12, risk: 1, duration: 1 }) }, params: PARAMS };
  const r = scheduleNeeds(input);
  assert.equal(r.proposals.length, 12);
  const info = [{ key: 'P', officeId: 'o1', officeName: 'Bureau 1', workingDays: 6, persons: 1, inScope: true }];
  const n = resourceNeeds(r, info, { year: 2026, agentsPerVehicle: 4, fieldDaysPerMonth: 20 });
  const o = n.offices[0];
  assert.deepEqual([o.agentDays, o.workingDays, o.workingDaysSource, o.agentsNeeded, o.declared, o.gap], [12, 6, 'mmr', 2, 1, 1]);
  assert.equal(o.vehiclesPeak, 1, 'deux agents dans le même district le même jour : un véhicule');
  assert.equal(n.peak.agents, 2);
  for (const p of r.proposals) {
    const sl = n.slots[`${p.siteId}|12`];
    assert.ok(sl && sl.agent >= 1 && sl.agent <= 2 && sl.fieldDay >= 1 && sl.fieldDay <= 6);
    const d = new Date(`${sl.date}T00:00:00Z`).getUTCDay();
    assert.ok(sl.date.startsWith('2026-12-') && d >= 1 && d <= 5, `jour ouvré : ${sl.date}`);
  }
  // Sans jours ouvrés au MMR : le paramètre de repli.
  const n2 = resourceNeeds(r, [{ ...info[0], workingDays: null }], { year: 2026, agentsPerVehicle: 4, fieldDaysPerMonth: 4 });
  assert.deepEqual([n2.offices[0].workingDays, n2.offices[0].workingDaysSource, n2.offices[0].agentsNeeded], [4, 'parametre', 3]);
  // Agents de districts différents le même jour : un véhicule par district.
  const n3 = resourceNeeds(r, [{ ...info[0], workingDays: 1 }], { year: 2026, agentsPerVehicle: 4, fieldDaysPerMonth: 20 });
  assert.equal(n3.offices[0].agentsNeeded, 12);
  assert.equal(n3.offices[0].vehiclesPeak, 4, '6 agents en dA (2 véhicules) + 6 en dB (2 véhicules)');
});

test('jours de terrain : du lundi au vendredi, le samedi seulement si le MMR compte plus de jours', () => {
  assert.equal(fieldDays(2026, 11).length, 21);
  assert.equal(fieldDate(2026, 11, 1), '2026-11-02', '1ᵉʳ novembre 2026 = dimanche');
  assert.equal(fieldDate(2026, 11, 99), '2026-11-30', 'borné au dernier jour de terrain');
  assert.equal(fieldDays(2026, 11, 24).length, 25, 'lundi–samedi');
  assert.equal(fieldDate(2027, 1, 1), '2027-01-01');
});

// ---- Jeux synthétiques à graine fixe ---------------------------------------------------
function shuffle(arr, seed) {
  const rnd = mulberry32(seed); const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

test('jeux synthétiques : 0 violation, déterministe, indépendant de l\'ordre d\'entrée ; ressources cohérentes', () => {
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    const raw = synthRaw({ n: 500 + i * 100, seed: 21 + i, year: 2027, gridShare: i % 2, persons: i % 2 === 0 });
    const adjust = i === 3 ? { excludedCommunes: [{ district: 'District 2', commune: 'Commune 2-1' }] } : {};
    const a = assemble(raw, { year: 2027, todayMonth: '2026-10', from: 1 + i, to: 12, settings: PARAMS, adjust, scope: i === 2 ? { district: 'District 3' } : {} });
    const r1 = scheduleNeeds(a.input);
    assert.deepEqual(checkInvariants(a.input, r1), [], `invariants, jeu ${i}`);
    assert.equal(fingerprintResult(scheduleNeeds(a.input)), fingerprintResult(r1), `déterminisme, jeu ${i}`);
    assert.equal(fingerprintResult(scheduleNeeds({ ...a.input, sites: shuffle(a.input.sites, 7 + i) })), fingerprintResult(r1), `ordre d'entrée, jeu ${i}`);
    const n = resourceNeeds(r1, a.poolInfo, { year: 2027, agentsPerVehicle: 4, fieldDaysPerMonth: 20 });
    for (const o of n.offices) {
      assert.ok(o.agentsNeeded * o.workingDays >= o.agentDays, `agents suffisants pour les journées (${o.officeName}, ${o.month})`);
      assert.ok(o.vehiclesPeak >= Math.ceil(o.agentsNeeded / 4) || o.fieldDaysUsed === 0 || o.vehiclesPeak >= 1);
    }
    for (const p of r1.proposals) assert.ok(n.slots[`${p.siteId}|${p.month}`], 'chaque visite proposée a son agent et son jour');
    total += r1.proposals.length;
  }
  assert.ok(total > 500);
});

test('journée complétée : à 3 suivis par jour, la journée ouverte dans une commune prend 3 visites (aucun déplacement de plus)', () => {
  // Part de janvier = 1 visite (4 sites sur 12 mois), mais la journée ouverte a la place de 2 autres.
  const { r, code } = run(['a', 'b', 'c', 'd'].map((id) => site(id)), pool({ sites: 4, risk: 1, duration: 1 }), { from: 1, to: 1 });
  const days = r.months[0].tours[0].stops[0].days;
  assert.deepEqual(days.map((d) => d.visits.length), [3]);
  assert.ok(days.every((d) => d.used <= U));
  assert.equal(code('d', 1), 'plus_tard');
});
