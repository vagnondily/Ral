/**
 * Planification automatique sur une période (retours 82, 107, 108) — moteur pur.
 * generatePlan(sites, mmrByKey, settings, months(1..12), year, opts).
 * Stratégie « besoins » par défaut : toutes les visites exigées, communes entières toutes
 * activités, ordre du RBM, plancher ciblé/mois ; « capacite » : dans le faisable du MMR.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePlan, normalizeSettings, siteRemaining, clusterKeyOf } = require('../src/modules/tpm/planAuto');

const H1 = [1, 2, 3, 4, 5, 6];
const FULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const YEAR = 2026;
const site = (o) => ({ forbidden: false, parametered: false, required: 0, visits: [], monthStatus: {}, riskLevel: 'moyenne', lastVisitMonth: null, mmrKey: null, activity: 'A', district: 'D', commune: `C-${o.id}`, ...o });
const monthsOf = (r, id) => r.assignments.filter((a) => a.siteId === id).map((a) => Number(a.month.slice(5)));

test('normalizeSettings : défauts (besoins, 4 agents par véhicule, 20 jours) et bornes', () => {
  const s = normalizeSettings();
  assert.deepEqual(s, { strategy: 'besoins', adjusted: false, reinforceUrgent: false, excludedCommunes: [], agentsPerVehicle: 4, fieldDaysPerMonth: 20 });
  const c = normalizeSettings({ strategy: 'capacite', agentsPerVehicle: 11, fieldDaysPerMonth: 0, reinforceUrgent: true,
    excludedCommunes: [{ district: 'Betioky', commune: 'Vohimary' }, { district: 'betioky ', commune: 'VOHIMARY' }, { commune: '' }] });
  assert.equal(c.strategy, 'capacite');
  assert.equal(c.adjusted, true);              // capacité déclarée → intervalle ajusté du MMR
  assert.equal(c.agentsPerVehicle, 4);         // hors bornes → défaut
  assert.equal(c.fieldDaysPerMonth, 20);
  assert.equal(c.excludedCommunes.length, 1);  // dédoublonné, vide ignoré
  assert.equal(normalizeSettings({ strategy: 'autre' }).strategy, 'besoins');
});

test('siteRemaining : exigées − réalisées − prévues à venir (échu = avant le mois courant)', () => {
  const r = siteRemaining({ required: 2, visits: [{ month: 2, status: 'planifie' }, { month: 5, status: 'realise' }] }, 4);
  assert.equal(r.remaining, 1);
  assert.equal(r.latePlanned, 1);
  // Une prévue à venir APRÈS la période compte aussi (planifier le 1ᵉʳ semestre après le 2ᵉ).
  const r2 = siteRemaining({ required: 2, visits: [{ month: 10, status: 'planifie' }] }, 1);
  assert.deepEqual([r2.remaining, r2.upcoming, r2.latePlanned], [1, 1, 0]);
  assert.equal(siteRemaining({ required: 3, visits: [] }, 1, 2).remaining, 2); // exigées données
});

test('site MMR : exactement les visites exigées, espacées de l\'intervalle', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 2, mmrKey: 'k' })], { k: { interval: 3 } }, {}, H1, YEAR);
  assert.deepEqual(monthsOf(r, 'a'), [1, 4]);
  assert.equal(r.summary.mmrDriven, 1);
});

test('« capacité déclarée » : intervalle ajusté (CO adjusted) et faisable du MMR respecté', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 3, mmrKey: 'k' })],
    { k: { interval: 1, adjustedInterval: 3, feasible: 100 } }, { strategy: 'capacite' }, H1, YEAR);
  assert.deepEqual(monthsOf(r, 'a'), [1, 4]);
  const sites = [1, 2, 3].map((i) => site({ id: `s${i}`, parametered: true, required: 1, mmrKey: 'k', riskLevel: 'elevee' }));
  const c = generatePlan(sites, { k: { interval: 1, feasible: 1 } }, { strategy: 'capacite' }, H1, YEAR);
  const byMonth = {};
  for (const x of c.assignments) byMonth[x.month] = (byMonth[x.month] || 0) + 1;
  assert.ok(Object.values(byMonth).every((n) => n <= 1));
  assert.equal(c.assignments.length, 3);
});

test('selon les besoins : toutes les visites exigées, la capacité est comparée et signalée', () => {
  const sites = Array.from({ length: 6 }, (_, i) => site({ id: `s${i}`, commune: 'Même', parametered: true, required: 1, mmrKey: 'k' }));
  const r = generatePlan(sites, { k: { interval: 12, feasible: 2 } }, {}, [1], YEAR);
  assert.equal(r.summary.planned, 6);                      // aucune visite écartée
  assert.equal(r.summary.monthsOverCapacity, 1);           // 6 > faisable 2 : signalé
  assert.equal(r.byActivity[0].perMonth[0].overCapacity, true);
  const c = generatePlan(sites, { k: { interval: 12, feasible: 2 } }, { strategy: 'capacite' }, [1], YEAR);
  assert.equal(c.summary.planned, 2);
  assert.equal(c.summary.unplacedByReason.capacity, 4);
});

test('communes : les sites d\'une même commune partent dans la même tournée, toutes activités', () => {
  const mmr = { K1: { interval: 4 }, K2: { interval: 4 } };
  const sites = [
    site({ id: 'd1', commune: 'Même', activity: 'A1', parametered: true, mmrKey: 'K1', required: 3 }),
    site({ id: 'd2', commune: 'Même', activity: 'A2', parametered: true, mmrKey: 'K2', required: 3 }),
    site({ id: 'e1', commune: 'Autre', activity: 'A1', parametered: true, mmrKey: 'K1', required: 3 }),
  ];
  const r = generatePlan(sites, mmr, {}, FULL, YEAR);
  assert.deepEqual(monthsOf(r, 'd1'), monthsOf(r, 'd2'));
  assert.equal(monthsOf(r, 'd1').length, 3);
  // Le site le plus exigeant mène la tournée ; l'autre activité s'y joint quand son écart le permet.
  const mixed = generatePlan([
    site({ id: 'a', commune: 'X', activity: 'A1', parametered: true, mmrKey: 'K4', required: 3 }),
    site({ id: 'b', commune: 'X', activity: 'A2', parametered: true, mmrKey: 'K6', required: 2 }),
  ], { K4: { interval: 4 }, K6: { interval: 6 } }, {}, FULL, YEAR);
  assert.deepEqual(monthsOf(mixed, 'a'), [1, 5, 9]);
  assert.deepEqual(monthsOf(mixed, 'b'), [1, 9]);         // jamais un trajet de plus en juillet
});

test('clé de regroupement : commune dans son district (homonymes séparés), GPS en second', () => {
  assert.notEqual(clusterKeyOf({ id: 'x', district: 'D1', commune: 'Ankily' }), clusterKeyOf({ id: 'y', district: 'D2', commune: 'Ankily' }));
  assert.equal(clusterKeyOf({ id: 'x', district: 'D1', commune: 'ankily ' }), clusterKeyOf({ id: 'y', district: 'd1', commune: 'Ankily' }));
  assert.equal(clusterKeyOf({ id: 'x', district: 'D', commune: '', gpsLat: -18.90, gpsLng: 47.52 }), clusterKeyOf({ id: 'y', district: 'D', gpsLat: -18.91, gpsLng: 47.53 }));
  assert.match(clusterKeyOf({ id: 'z', district: 'D' }), /\|s:z$/);
});

test('ordre du RBM : la commune d\'un site urgent passe d\'abord, puis le score, puis jamais visité', () => {
  const mmr = { k: { interval: 12, targetedPerMonth: 1 } };
  const mk = (id, o = {}) => site({ id, parametered: true, required: 1, mmrKey: 'k', ...o });
  const sites = [mk('z-calme', { lastVisitMonth: '2025-01' }), mk('a-score', { finalScore: 2, lastVisitMonth: '2025-01' }),
    mk('m-urgent', { urgent: true, lastVisitMonth: '2025-01' }), mk('b-jamais')];
  const r = generatePlan(sites, mmr, {}, [1, 2, 3, 4], YEAR);
  const order = r.assignments.map((a) => `${a.siteId}:${a.month.slice(5)}`);
  assert.deepEqual(order, ['m-urgent:01', 'a-score:02', 'b-jamais:03', 'z-calme:04']);
});

test('répartition : charge étalée ; plancher ciblé/mois atteint quand les visites dues le permettent, sinon manque signalé', () => {
  const sites = Array.from({ length: 12 }, (_, i) => site({ id: `s${String(i).padStart(2, '0')}`, parametered: true, required: 1, mmrKey: 'k' }));
  const r = generatePlan(sites, { k: { interval: 12, targetedPerMonth: 3 } }, {}, [1, 2, 3, 4], YEAR);
  assert.deepEqual(r.perMonth.map((m) => m.count), [3, 3, 3, 3]);
  assert.equal(r.summary.monthsBelowTarget, 0);
  // Plancher impossible à tenir (trop peu de sites) : manque signalé.
  const few = generatePlan(sites.slice(0, 2), { k: { interval: 12, targetedPerMonth: 3 } }, {}, [1, 2], YEAR);
  assert.ok(few.summary.monthsBelowTarget >= 1);
  // … et jamais atteint un mois en vidant les suivants : 6 sites, plancher 3, 4 mois → 2 / 2 / 1 / 1
  // (et non 3 / 3 / 0 / 0, qui doublerait les agents des premiers mois).
  const six = generatePlan(sites.slice(0, 6), { k: { interval: 12, targetedPerMonth: 3 } }, {}, [1, 2, 3, 4], YEAR);
  assert.deepEqual(six.perMonth.map((m) => m.count), [2, 2, 1, 1]);
  assert.equal(six.summary.monthsBelowTarget, 4);
  // Une échéance seulement quand attendre ferait PERDRE une visite : 2 exigées, écart 5, 3 mois —
  // une seule tient de toute façon, les sites s'étalent sur les 3 mois au lieu de partir tous le 1ᵉʳ.
  const late = Array.from({ length: 9 }, (_, i) => site({ id: `l${i}`, parametered: true, required: 2, mmrKey: 'k5' }));
  const lr = generatePlan(late, { k5: { interval: 5 } }, {}, [10, 11, 12], YEAR, { fromMonth: '2026-10' });
  assert.deepEqual(lr.perMonth.map((m) => m.count), [3, 3, 3]);
  assert.equal(lr.summary.unplacedByReason.period, 9);
  // Mois déjà chargé par des visites prévues : moins de nouvelles visites ce mois-là.
  const pre = generatePlan([...sites.slice(0, 6), ...[0, 1, 2, 3].map((i) => site({ id: `old${i}`, parametered: true, required: 1, mmrKey: 'k', visits: [{ month: 1, status: 'planifie' }] }))],
    { k: { interval: 12 } }, {}, [1, 2, 3, 4, 5], YEAR);
  assert.equal(pre.perMonth[0].count, 0);
});

test('réalisée compte comme faite, et l\'intervalle part d\'elle', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 3, mmrKey: 'k', visits: [{ month: 1, status: 'realise' }] })],
    { k: { interval: 2 } }, {}, H1, YEAR);
  assert.deepEqual(monthsOf(r, 'a'), [3, 5]);
});

test('catch-up : une prévue d\'un mois ÉCHU jamais faite est re-planifiée ; une prévue à venir hors période compte', () => {
  const s = site({ id: 'a', parametered: true, required: 2, mmrKey: 'k', visits: [{ month: 2, status: 'planifie' }] });
  const r = generatePlan([s], { k: { interval: 1 } }, {}, [4, 5, 6], YEAR, { fromMonth: '2026-04' });
  assert.equal(r.assignments.length, 2);
  assert.equal(r.summary.latePlanned, 1);
  // Février est encore à venir (mois courant janvier) : il compte, une seule visite reste à placer.
  const r2 = generatePlan([s], { k: { interval: 1 } }, {}, [4, 5, 6], YEAR, { fromMonth: '2026-01' });
  assert.equal(r2.assignments.length, 1);
  assert.equal(r2.summary.latePlanned, 0);
});

test('zone interdite, sans activité, commune inaccessible : jamais planifiés, comptés à part', () => {
  const r = generatePlan([
    site({ id: 'f', forbidden: true, parametered: true, required: 5, mmrKey: 'k' }),
    site({ id: 'na', activity: null, riskLevel: 'elevee' }),
    site({ id: 'acc', district: 'Betioky', commune: 'Vohimary', riskLevel: 'elevee' }),
    site({ id: 'ok', riskLevel: 'elevee' }),
  ], { k: { interval: 1 } }, { excludedCommunes: [{ district: 'betioky', commune: 'vohimary ' }] }, H1, YEAR);
  assert.deepEqual([...new Set(r.assignments.map((a) => a.siteId))], ['ok']);
  assert.deepEqual([r.summary.forbidden, r.summary.noActivity, r.summary.access, r.summary.sitesActivePlannable], [1, 1, 1, 1]);
});

test('repli RBM au risque du site (sans MMR) : faible tous les 3 mois, élevé tous les mois', () => {
  const r = generatePlan([site({ id: 'b', riskLevel: 'faible' }), site({ id: 'e', riskLevel: 'elevee' })], {}, {}, FULL, YEAR);
  assert.deepEqual(monthsOf(r, 'b'), [1, 4, 7, 10]);
  assert.equal(monthsOf(r, 'e').length, 12);
  assert.equal(r.summary.rbmFallback, 2);
});

test('renfort (option) : un site urgent est visité au premier mois, sans attendre l\'intervalle', () => {
  const s = site({ id: 'u', urgent: true, parametered: true, required: 1, mmrKey: 'k', lastVisitMonth: '2026-08' });
  const mmr = { k: { interval: 6 } };
  const without = generatePlan([s], mmr, {}, [10, 11, 12], YEAR);
  assert.deepEqual(monthsOf(without, 'u'), []);                       // août + 6 → février
  const withR = generatePlan([s], mmr, { reinforceUrgent: true }, [10, 11, 12], YEAR);
  assert.deepEqual(withR.assignments.map((a) => [a.month, a.source]), [['2026-10', 'renfort']]);
  assert.equal(withR.summary.renfort, 1);
  // Déjà dû : la visite exigée sert de renfort (pas de visite en plus).
  const due = generatePlan([{ ...s, lastVisitMonth: '2026-01' }], mmr, { reinforceUrgent: true }, [10, 11, 12], YEAR);
  assert.deepEqual(due.assignments.map((a) => [a.month, a.source]), [['2026-10', 'mmr']]);
});

test('ressources : agents = ⌈journées ÷ jours ouvrés⌉, véhicules = Σ district ⌈agents ÷ agents par véhicule⌉', () => {
  const seg = [{ from: `${YEAR}-01`, to: `${YEAR}-12`, providerId: 'T', providerName: 'TPM T' }];
  // 30 sites dans 3 communes d'un district, 2 suivis/jour, 5 jours ouvrés : 15 journées → 3 agents.
  const sites = Array.from({ length: 30 }, (_, i) => site({ id: `s${String(i).padStart(2, '0')}`, commune: `C${i % 3}`, parametered: true, required: 1, mmrKey: 'k', tpmSegments: seg }));
  const mmr = { k: { interval: 1, visitsPerDay: 2, workingDays: 5, personsToDeploy: 2 } };
  const r = generatePlan(sites, mmr, {}, [3], YEAR);
  const mo = r.resources.months[0];
  assert.equal(mo.agentDays, 15);
  assert.equal(mo.agentsNeeded, 3);
  assert.equal(mo.declared, 2);
  assert.equal(mo.gap, 1);                                 // 1 agent de plus que déclaré : signalé
  assert.equal(r.summary.agentsTotalPeak, 3);
  assert.equal(r.summary.vehiclesPeak, 1);                 // 3 agents, 4 par véhicule
  assert.equal(r.byTpm[0].tpm, 'TPM T');
  assert.equal(r.byTpm[0].planned, 30);
  // Chaque visite nouvelle a son créneau dans le mois : agent générique, jour de terrain, date.
  for (const a of r.assignments) {
    const slot = r.slots[`${a.siteId}|${a.month}`];
    assert.ok(slot && slot.agent >= 1 && slot.agent <= 3 && slot.date.startsWith('2026-03'));
  }
  // Sans jours ouvrés au MMR : paramètre « jours de terrain » (20), signalé.
  const r2 = generatePlan(sites, { k: { interval: 1, visitsPerDay: 2 } }, { fieldDaysPerMonth: 5, agentsPerVehicle: 2 }, [3], YEAR);
  assert.equal(r2.resources.months[0].agentsNeeded, 3);
  assert.equal(r2.byTpm[0].perMonth[0].workingDaysSource, 'parametre');
  assert.equal(r2.summary.vehiclesPeak, 2);               // 3 agents, 2 par véhicule
});

test('sans TPM dans la zone : « Bureau (suivi interne) », hors périmètre non planifié', () => {
  const r = generatePlan([site({ id: 'a', riskLevel: 'elevee' }), site({ id: 'b', riskLevel: 'elevee', inScope: false })], {}, {}, [1], YEAR);
  assert.deepEqual(r.byTpm.map((t) => [t.unitKey, t.assigned, t.planned]), [['bureau:none', false, 1]]);
  assert.equal(r.summary.sitesConsidered, 1);
});

test('suivi interne : une unité PAR bureau (antennes comprises), jamais un « bureau » commun à tout le compte', () => {
  // Bureau o1 (district Nord) et bureau o2 (district Sud), sans TPM : chacun suit avec ses agents.
  const mk = (id, office, district) => site({ id, district, commune: `${district}-${id}`, parametered: true, required: 1, mmrKey: `A|${office}`,
    unitOfficeId: office, unitOfficeName: office === 'o1' ? 'Bureau Nord' : 'Bureau Sud' });
  const sites = [...Array.from({ length: 10 }, (_, i) => mk(`n${i}`, 'o1', 'Nord')), ...Array.from({ length: 10 }, (_, i) => mk(`s${i}`, 'o2', 'Sud'))];
  const mmr = { 'A|o1': { interval: 12, visitsPerDay: 1, workingDays: 20, personsToDeploy: 1 }, 'A|o2': { interval: 12, visitsPerDay: 1, workingDays: 20, personsToDeploy: 1 } };
  const r = generatePlan(sites, mmr, {}, [3], YEAR);
  assert.deepEqual(r.byTpm.map((t) => [t.unitKey, t.officeName, t.visits, t.agentsPeak]).sort(), [['bureau:o1', 'Bureau Nord', 10, 1], ['bureau:o2', 'Bureau Sud', 10, 1]]);
  assert.equal(r.summary.agentsTotalPeak, 2);       // un agent par bureau, pas un pour les deux
  assert.equal(r.summary.agentsGap, 0);             // 2 déclarés au MMR, 2 nécessaires
  // Les créneaux « Agent 1 » des deux bureaux sont deux personnes : jamais un même agent dans les deux districts.
  const agentDistricts = new Map();
  for (const a of r.assignments) {
    const k = `${a.office}|${r.slots[`${a.siteId}|${a.month}`].agent}`;
    if (!agentDistricts.has(k)) agentDistricts.set(k, new Set());
    agentDistricts.get(k).add(a.district);
  }
  assert.ok([...agentDistricts.values()].every((d) => d.size === 1));
});

test('par unité : « Sites » compte les sites de toutes les visites à faire, comme « Visites »', () => {
  const seg = [{ from: `${YEAR}-01`, to: `${YEAR}-12`, providerId: 'T', providerName: 'TPM T' }];
  const sites = Array.from({ length: 40 }, (_, i) => site({ id: `p${i}`, parametered: true, required: 1, mmrKey: 'k', tpmSegments: seg,
    visits: [{ month: 11, status: 'planifie' }] }));
  const r = generatePlan(sites, { k: { interval: 6 } }, {}, [11, 12], YEAR);
  assert.equal(r.summary.planned, 0);
  assert.deepEqual(r.byTpm.map((t) => [t.tpm, t.sites, t.sitesNew, t.visits, t.planned]), [['TPM T', 40, 0, 40, 0]]);
});

test('couverture : un site DÉJÀ planifié dans la période compte comme couvert', () => {
  // Re-générer sur un plan déjà appliqué ne doit pas afficher 0 % (retour 82).
  const sites = Array.from({ length: 10 }, (_, i) => site({ id: `s${i}`, parametered: true, required: 2, mmrKey: 'k', commune: `C${i}`, activity: 'A', visits: [{ month: 1, status: 'planifie' }, { month: 6, status: 'planifie' }] }));
  const r = generatePlan(sites, { k: { interval: 3, feasible: 100 } }, {}, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], YEAR);
  assert.equal(r.summary.sitesCovered, 10);          // tous couverts (déjà prévus)
  assert.equal(r.summary.coverageRate, 100);
  assert.equal(r.summary.alreadyCovered, 10);
  // Une visite réalisée compte aussi comme couverture.
  const r2 = generatePlan([site({ id: 'x', parametered: true, required: 1, mmrKey: 'k', activity: 'A', visits: [{ month: 2, status: 'realise' }] })],
    { k: { interval: 6, feasible: 100 } }, {}, [1, 2, 3, 4, 5, 6], YEAR);
  assert.equal(r2.summary.sitesCovered, 1);
});

test('perMonth couvre toute la période ; plan vide sans erreur', () => {
  const r = generatePlan([site({ id: 'a', parametered: true, required: 2, mmrKey: 'k' })], { k: { interval: 2 } }, {}, H1, YEAR);
  assert.deepEqual(r.perMonth.map((m) => m.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  assert.deepEqual(generatePlan([], {}, {}, [], YEAR).assignments, []);
  assert.equal(generatePlan([], {}, {}, H1, YEAR).summary.coverageRate, null);
});
