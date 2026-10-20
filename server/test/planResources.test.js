/**
 * Ressources nécessaires d'un plan (planResources, retour 108) — module pur, unités entières :
 * journées par commune toutes activités, agents = ⌈journées ÷ jours de terrain⌉, véhicules par
 * jour et par district, comparaison au déclaré, créneaux des visites nouvelles.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { U, visitCost, fieldDays, fieldDate, communeDays, planResources } = require('../src/modules/tpm/planResources');

const v = (o) => ({ siteId: o.id, month: '2026-03', unitKey: 'id:T', unitName: 'T', assigned: true, district: 'D1', commune: 'C1',
  activityKey: 'k', visitsPerDay: 2, workingDays: 20, isNew: true, ...o });

test('jours de terrain : lundi–vendredi, lundi–samedi si les jours ouvrés dépassent', () => {
  assert.equal(fieldDays(2026, 3).length, 22);           // mars 2026 : 22 jours de semaine
  assert.equal(fieldDays(2026, 3, 24).length, 26);       // + les samedis
  assert.equal(fieldDate(2026, 3, 1), '2026-03-02');     // 1er mars 2026 = dimanche
  assert.equal(fieldDate(2026, 3, 99), '2026-03-31');    // borné au dernier jour de terrain
});

test('coût d\'une visite en unités entières ; suivis/jour vide → 1 par journée, signalé', () => {
  assert.deepEqual(visitCost(2), { cost: U / 2, unknown: false });
  assert.deepEqual(visitCost(0.5), { cost: 2 * U, unknown: false });
  assert.deepEqual(visitCost(null), { cost: U, unknown: true });
  assert.ok(Number.isInteger(visitCost(1.5).cost) && Number.isInteger(visitCost(3).cost));
  // Journées d'une commune : 1/3 + 1/2 tiennent, + 1/3 ouvre une 2ᵉ journée ; une visite de 2 jours seule.
  const days = communeDays([{ cost: U / 3 }, { cost: U / 2 }, { cost: U / 3 }, { cost: 2 * U }]);
  assert.deepEqual(days.map((d) => [d.span, d.visits.length]), [[1, 2], [1, 1], [2, 1]]);
});

test('agents et véhicules : une commune toutes activités, journées données à l\'agent libre le plus tôt', () => {
  // 10 visites à 2 par jour dans une commune (5 journées) + 6 visites à 3 par jour dans une autre
  // commune du même district (2 journées) + 4 visites à 1 par jour dans un autre district (4 journées).
  const visits = [
    ...Array.from({ length: 10 }, (_, i) => v({ id: `a${i}`, commune: 'C1' })),
    ...Array.from({ length: 6 }, (_, i) => v({ id: `b${i}`, commune: 'C2', activityKey: 'k3', visitsPerDay: 3 })),
    ...Array.from({ length: 4 }, (_, i) => v({ id: `c${i}`, district: 'D2', commune: 'C9', visitsPerDay: 1 })),
  ];
  const r = planResources(visits, { agentsPerVehicle: 2, declared: { k: 1, k3: 1 } });
  const mo = r.months[0];
  assert.equal(mo.agentDays, 11);
  assert.equal(mo.agentsNeeded, 1);                  // 11 journées ≤ 20 jours ouvrés
  assert.equal(mo.declared, 2);
  assert.equal(mo.gap, -1);
  assert.equal(mo.vehiclesPeak, 1);
  assert.deepEqual(mo.zones.map((z) => [z.district, z.agentDays, z.visits]), [['D1', 7, 16], ['D2', 4, 4]]);
  // Moins de jours ouvrés : plus d'agents ; véhicules = Σ district ⌈agents ÷ agents par véhicule⌉.
  const tight = planResources(visits.map((x) => ({ ...x, workingDays: 3 })), { agentsPerVehicle: 2 });
  assert.equal(tight.months[0].agentsNeeded, 4);     // ⌈11 ÷ 3⌉
  assert.ok(tight.months[0].vehiclesPeak >= 2);
  // Créneaux : chaque visite nouvelle a un agent, un jour de terrain et une date du mois.
  for (const x of visits) {
    const s = tight.slots[`${x.siteId}|2026-03`];
    assert.ok(s && s.agent >= 1 && s.agent <= 4 && s.fieldDay >= 1 && s.fieldDay <= 3 && s.date.startsWith('2026-03-'));
  }
});

test('visites existantes : comptent dans les ressources, sans créneau ; jours ouvrés manquants → paramètre', () => {
  const visits = [v({ id: 'old', isNew: false, workingDays: null }), v({ id: 'new', workingDays: null })];
  const r = planResources(visits, { fieldDaysPerMonth: 10 });
  assert.equal(r.months[0].visits, 2);
  assert.equal(r.months[0].newVisits, 1);
  assert.equal(r.slots['old|2026-03'], undefined);
  assert.ok(r.slots['new|2026-03']);
  assert.equal(r.units[0].months[0].workingDays, 10);
  assert.equal(r.units[0].workingDaysSource, 'parametre');
});

test('unités : un TPM par zone, « bureau » sans TPM ; pic et moyenne sur les mois', () => {
  const visits = [
    ...Array.from({ length: 50 }, (_, i) => v({ id: `t${i}`, visitsPerDay: 1, workingDays: 10 })),
    ...Array.from({ length: 5 }, (_, i) => v({ id: `b${i}`, unitKey: 'bureau', unitName: null, assigned: false, month: '2026-04' })),
    ...Array.from({ length: 10 }, (_, i) => v({ id: `u${i}`, month: '2026-04', visitsPerDay: 1, workingDays: 10 })),
  ];
  const r = planResources(visits);
  const t = r.units.find((u) => u.unitKey === 'id:T');
  assert.deepEqual(t.months.map((m) => [m.month, m.agentsNeeded]), [['2026-03', 5], ['2026-04', 1]]);
  assert.equal(t.agentsPeak, 5);
  assert.equal(t.agentsAvg, 3);
  const b = r.units.find((u) => u.unitKey === 'bureau');
  assert.equal(b.assigned, false);
  assert.equal(r.peak.agents, 5);
  assert.equal(r.peak.agentsMonth, '2026-03');
  assert.deepEqual(planResources([]).months, []);
});

test('agents : le plus petit effectif qui tient dans le mois (dichotomie), visite plus longue que le mois comprise', () => {
  const { scheduleUnit } = require('../src/modules/tpm/planResources');
  // 30 journées d'un jour, 10 jours de terrain → 3 agents, chacun 10 journées.
  const days = Array.from({ length: 30 }, () => ({ span: 1 }));
  const r = scheduleUnit(days, 10);
  assert.equal(r.agents, 3);
  assert.ok(r.assign.every((x) => x.fieldDay <= 10));
  // Une journée de 2 jours au milieu : 32 jours-agent → 4 agents, rien au-delà du 10ᵉ jour.
  const mixed = [...days.slice(0, 15), { span: 2 }, ...days.slice(15)];
  const m = scheduleUnit(mixed, 10);
  assert.equal(m.agents, 4);
  assert.ok(m.assign.every((x) => x.fieldDay + x.item.span - 1 <= 10));
  // Visites de 20 jours (0,05 suivi par jour) dans un mois de 10 jours : une par agent, au 1ᵉʳ jour,
  // et le calcul reste rapide (dichotomie, jamais une boucle agent par agent).
  const t0 = Date.now();
  const long = scheduleUnit(Array.from({ length: 400 }, () => ({ span: 20 })), 10);
  assert.equal(long.agents, 400);
  assert.ok(long.assign.every((x) => x.fieldDay === 1));
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(scheduleUnit([], 10), { agents: 0, agentDays: 0, assign: [] });
});

test('mois en cours : seulement les jours de terrain restants (jamais une date passée), effectif dimensionné dessus', () => {
  const { usableDays } = require('../src/modules/tpm/planResources');
  // 20 octobre 2026 (mardi) : restent 20, 21, 22, 23, 26, 27, 28, 29, 30 → 9 jours de terrain.
  assert.deepEqual(usableDays(2026, 10, 20, '2026-10-20'), [20, 21, 22, 23, 26, 27, 28, 29, 30]);
  assert.equal(usableDays(2026, 11, 20, '2026-10-20').length, 21);   // un autre mois : entier
  assert.deepEqual(usableDays(2026, 10, 20, '2026-10-31'), [31]);     // samedi 31 : au moins aujourd'hui
  const visits = Array.from({ length: 40 }, (_, i) => v({ id: `o${i}`, month: '2026-10', commune: `C${i}`, visitsPerDay: 1, workingDays: 20 }));
  const r = planResources(visits, { today: '2026-10-20' });
  assert.equal(r.months[0].agentsNeeded, 5);                          // ⌈40 ÷ 9⌉, pas ⌈40 ÷ 20⌉ = 2
  assert.equal(r.units[0].months[0].workingDays, 9);
  assert.ok(Object.values(r.slots).every((s) => s.date >= '2026-10-20' && s.date <= '2026-10-30'), 'aucune date passée');
  // Sans jour courant (ou un mois à venir) : le mois entier.
  assert.equal(planResources(visits).months[0].agentsNeeded, 2);
});

test('créneaux déjà écrits (« Agent N » daté) réservés : un nouvel agent n\'est jamais à deux endroits le même jour', () => {
  // 1ᵉʳ passage écrit : Agent 1 et Agent 2 dans le district A, du 1ᵉʳ au 14 janvier 2027 (28 communes).
  const days = [];
  for (let d = 1; d <= 31; d += 1) { const wd = new Date(Date.UTC(2027, 0, d)).getUTCDay(); if (wd >= 1 && wd <= 5) days.push(d); }
  const fixed = Array.from({ length: 20 }, (_, i) => v({ id: `A${i}`, month: '2027-01', district: 'A', commune: `A${i}`, visitsPerDay: 1, workingDays: 20,
    isNew: false, agent: `Agent ${1 + (i % 2)}`, date: `2027-01-${String(days[Math.floor(i / 2)]).padStart(2, '0')}` }));
  const fresh = Array.from({ length: 20 }, (_, i) => v({ id: `B${i}`, month: '2027-01', district: 'B', commune: `B${i}`, visitsPerDay: 1, workingDays: 20 }));
  const r = planResources([...fixed, ...fresh]);
  const cells = new Map();
  for (const f of fixed) cells.set(`${f.agent.slice(6)}|${f.date}`, f.commune);
  for (const x of fresh) {
    const s = r.slots[`${x.siteId}|2027-01`];
    const k = `${s.agent}|${s.date}`;
    assert.ok(!cells.has(k), `créneau ${k} déjà pris par ${cells.get(k)}`);
    cells.set(k, x.commune);
  }
  assert.equal(r.months[0].agentsNeeded, 2);   // les 6 jours libres des deux agents puis un 3ᵉ… : 20 + 20 journées ≤ 2 × 20
  assert.equal(r.months[0].agentDays, 40);
  assert.equal(r.units[0].months[0].reservedSlots, 20);
});

test('regroupement des ressources = celui du moteur : casse et espaces ignorés, cellules GPS séparées', () => {
  const same = [v({ id: 'x1', district: 'Ambovombe', commune: 'Androy', visitsPerDay: 4, clusterKey: 'ambovombe|c:androy', districtKey: 'ambovombe' }),
    v({ id: 'x2', district: 'AMBOVOMBE ', commune: 'ANDROY ', visitsPerDay: 4, clusterKey: 'ambovombe|c:androy', districtKey: 'ambovombe' })];
  const r = planResources(same, { agentsPerVehicle: 1 });
  assert.equal(r.months[0].agentDays, 1);          // une tournée, une journée
  assert.equal(r.months[0].zones.length, 1);       // un district
  assert.equal(r.months[0].vehiclesPeak, 1);
  // Sans commune : deux cellules GPS distinctes = deux journées, jamais une journée « commune vide ».
  const gps = [v({ id: 'g1', commune: null, visitsPerDay: 4, clusterKey: 'd1|g:-189:475' }), v({ id: 'g2', commune: null, visitsPerDay: 4, clusterKey: 'd1|g:-201:470' })];
  assert.equal(planResources(gps).months[0].agentDays, 2);
});

test('borne basse des agents : une visite plus longue que le mois prend un agent, les autres journées se partagent le reste', () => {
  const { scheduleUnit } = require('../src/modules/tpm/planResources');
  const r = scheduleUnit([2, 1, 5, 2].map((span) => ({ span })), 3);
  assert.equal(r.agents, 3);                       // 1 agent pour la visite de 5 jours + ⌈5 ÷ 3⌉ = 2
  assert.ok(r.assign.every((x) => x.fieldDay + x.item.span - 1 <= Math.max(3, x.item.span)));
  // Véhicules : un agent compté une fois par jour, même quand sa visite dépasse le mois.
  const long = planResources([v({ id: 'L', visitsPerDay: 0.2, workingDays: 3 })], { agentsPerVehicle: 1 });
  assert.equal(long.months[0].vehiclesPeak, 1);
  assert.equal(long.months[0].agentsNeeded, 1);
});

test('agents : tas « agent libre le plus tôt » — 6 000 journées d\'une unité en un instant', () => {
  const { scheduleUnit } = require('../src/modules/tpm/planResources');
  const t0 = Date.now();
  const r = scheduleUnit(Array.from({ length: 6000 }, () => ({ span: 1 })), 20);
  assert.equal(r.agents, 300);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

test('visite écrite de plusieurs jours (0,5 suivi par jour) : TOUS ses jours sont réservés, comptés et ont leur véhicule', () => {
  // Passage 1 écrit : Agent 1, 2027-01-01, -05, -07, -11 — chaque visite prend 2 jours de terrain.
  const fixed = ['2027-01-01', '2027-01-05', '2027-01-07', '2027-01-11'].map((date, i) => v({ id: `A${i}`, month: '2027-01', district: 'A',
    commune: `A-c${i}`, visitsPerDay: 0.5, workingDays: 20, isNew: false, agent: 'Agent 1', date }));
  const fresh = [0, 1, 2].map((i) => v({ id: `B${i}`, month: '2027-01', district: 'B', commune: `B-c${i}`, visitsPerDay: 0.5, workingDays: 20 }));
  const r = planResources([...fixed, ...fresh], { agentsPerVehicle: 1 });
  // Jours couverts par Agent 1 (passage 1) : 1, 4 (le 2 est un samedi), 5, 6, 7, 8, 11, 12 janvier.
  const busy = new Set(['2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-11', '2027-01-12']);
  for (const x of fresh) {
    const s = r.slots[`${x.siteId}|2027-01`];
    if (s.agent === 1) assert.ok(!busy.has(s.date) && s.date > '2027-01-12', `Agent 1 · ${s.date} déjà pris`);
  }
  assert.equal(r.months[0].agentDays, 8 + 6);          // 4 visites × 2 jours + 3 nouvelles × 2 jours
  assert.equal(r.months[0].vehiclesPeak, 1);
  // Mois en cours : une visite de 2 jours commencée hier réserve aujourd'hui.
  const started = v({ id: 'Y', month: '2026-10', isNew: false, agent: 'Agent 1', date: '2026-10-19', visitsPerDay: 0.5, workingDays: 20 });
  const now = planResources([started, v({ id: 'N', month: '2026-10', commune: 'Autre', visitsPerDay: 1, workingDays: 20 })], { today: '2026-10-20' });
  const slot = now.slots['N|2026-10'];
  assert.ok(!(slot.agent === 1 && slot.date === '2026-10-20'), 'Agent 1 est encore sur Y aujourd\'hui');
});
