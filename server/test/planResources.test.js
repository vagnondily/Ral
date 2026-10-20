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
