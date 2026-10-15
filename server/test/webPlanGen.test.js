/**
 * Planification automatique — fonctions d'affichage de l'écran (web/src/lib/planGen.js) et
 * miroir web de la règle « site actif au mois M » (web/src/lib/planBoard.isActiveMonth ≡
 * server common/siteActivity.isActiveMonth). Les raisons sont des CODES rendus en phrases par
 * `tr` ; chaque code connu du générateur a son libellé.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { POSTPONE_ORDER, WHY } = require('../src/modules/tpm/planGenerator');
const server = require('../src/modules/common/siteActivity');

const lib = (name) => path.join(__dirname, `../../web/src/lib/${name}`);
const load = async (t, name) => {
  if (!fs.existsSync(lib(name))) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(lib(name)).href);
};
const tr = (phrase, vars = {}) => phrase.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));

test('chaque code du générateur (pourquoi, report) a son libellé, son ton et son icône à l\'écran', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  for (const c of WHY) assert.ok(v.WHY[c] && v.WHY[c].label && v.WHY[c].icon, `pourquoi : ${c}`);
  for (const c of POSTPONE_ORDER) assert.ok(v.POSTPONE[c] && v.POSTPONE[c].label && v.POSTPONE[c].icon, `report : ${c}`);
  assert.deepEqual(v.POSTPONE_ORDER, POSTPONE_ORDER, 'même ordre d\'actionnabilité que le serveur');
});

test('raison d\'une proposition : dû (risque, dernière visite, intervalle), urgent, couverture, regroupement', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  const nameOf = (id) => ({ a1: 'EPP Ankily' }[id] || null);
  assert.equal(v.proposalText({ why: 'du', reason: 'du', level: 'haute', detail: { since: 3, gate: 2, risk: 'elevee' } }, tr, nameOf),
    'Dû : risque élevé, dernière visite il y a 3 mois (intervalle 2 mois) · priorité haute');
  assert.equal(v.proposalText({ why: 'meme_commune', reason: 'du', level: 'moyenne', anchor: 'a1', detail: { since: null, risk: 'faible' } }, tr, nameOf),
    'Dû : risque faible, jamais visité · priorité moyenne · regroupé avec EPP Ankily (même commune)');
  assert.equal(v.proposalText({ why: 'urgent', reason: 'urgent', level: 'haute', detail: { signals: [{ code: 'fraud', value: 1 }, { code: 'security', value: 3 }] } }, tr),
    'Recommandation urgente : fraude, restriction stricte · priorité haute');
  assert.equal(v.proposalText({ why: 'couverture', reason: 'couverture', level: 'basse', detail: {} }, tr),
    'Objectif de couverture : pas encore suivi sur l\'exercice');
});

test('raison d\'un report : intervalle (en arrière ou visite prévue trop proche), inactif avec le mois, niveau non retenu', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  const month = (m) => `[${m}]`;
  assert.equal(v.postponeText({ code: 'intervalle', detail: { since: 2, gate: 6 } }, tr, month), 'Dernière visite il y a 2 mois : intervalle de 6 mois non atteint');
  assert.equal(v.postponeText({ code: 'intervalle', detail: { next: '2026-12', gate: 5 } }, tr, month), 'Visite déjà prévue en [2026-12] : trop proche (intervalle 5 mois)');
  assert.equal(v.postponeText({ code: 'inactif', month: 11 }, tr, month, 2026), 'Inactif en [2026-11] (grille Sites actifs / inactifs)');
  assert.equal(v.postponeText({ code: 'non_du', detail: { level: 'basse' } }, tr, month), 'Priorité basse non retenue dans les critères');
  for (const c of POSTPONE_ORDER) assert.ok(v.postponeText({ code: c, detail: {} }, tr, month).length > 5, c);
});

test('grille : propositions mêlées aux coches manuelles (le manuel l\'emporte) ; seules les gardées partent à « Appliquer »', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  const proposals = new Map([['s1|10', { siteId: 's1', month: 10 }], ['s2|10', { siteId: 's2', month: 10 }], ['s3|11', { siteId: 's3', month: 11 }]]);
  const excluded = new Set(['s2|10']);
  const pending = { 's3|11': false, 's9|12': true };
  assert.deepEqual(v.mergePending(pending, proposals, excluded), { 's1|10': true, 's3|11': false, 's9|12': true });
  assert.deepEqual(v.keptProposals(proposals, excluded, pending), [{ siteId: 's1', month: 10 }]);
  assert.deepEqual(v.countByReason([{ code: 'inactif' }, { code: 'capacite_visites' }, { code: 'inactif' }]),
    [{ code: 'capacite_visites', count: 1 }, { code: 'inactif', count: 2 }]);
  assert.equal(v.pct(1, 3), 33);
  assert.equal(v.pct(1, 0), null);
});

test('horizon par défaut : du mois courant à décembre ; exercice passé → rien ; exercice à venir → toute l\'année', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  const today = new Date(2026, 9, 15);
  assert.deepEqual(v.defaultHorizon(2026, today), { from: 10, to: 12 });
  assert.deepEqual(v.defaultHorizon(2027, today), { from: 1, to: 12 });
  assert.equal(v.defaultHorizon(2025, today), null);
});

test('plan selon les besoins : raisons « échéance », « visite n sur r », « plus tard », « besoin couvert », « accès » ; agent et jour', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  const month = (m) => `[${m}]`;
  assert.equal(v.proposalText({ why: 'du', reason: 'echeance', level: 'moyenne', detail: { required: 2, gate: 6 } }, tr),
    'Dernier mois possible pour tenir les 2 visites du MMR (écart minimal 6 mois) · priorité moyenne');
  assert.equal(v.proposalText({ why: 'meme_commune', reason: 'du', level: 'moyenne', anchor: 'a1', agent: 2, fieldDay: 5, detail: { required: 3, visitNo: 2, since: 4, gate: 4 } }, tr, () => 'EPP Ankily'),
    'Visite 2 sur 3 exigées par le MMR · dernière visite il y a 4 mois (écart minimal 4 mois) · priorité moyenne · regroupé avec EPP Ankily (même commune) · Agent 2, jour de terrain 5');
  assert.equal(v.postponeText({ code: 'plus_tard', detail: { next: '2026-12' } }, tr, month), 'Prévu en [2026-12] : la charge est répartie sur l\'exercice');
  assert.equal(v.postponeText({ code: 'besoin_couvert', detail: { required: 2 } }, tr, month), 'Les 2 visites exigées par le MMR sont déjà faites ou prévues');
  assert.equal(v.postponeText({ code: 'acces', detail: null }, tr, month), 'Commune exclue de ce plan (accès)');
  assert.equal(v.postponeText({ code: 'intervalle', detail: { since: null, gate: 6 } }, tr, month), 'L\'écart minimal de 6 mois ne laisse plus de place dans l\'exercice');
});

test('synthèse des besoins : exigence, journées-agent, agents et véhicules au pic, écart au déclaré par bureau', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  const monthName = (m) => ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][m];
  const result = {
    strategy: 'besoins', toMonth: 12,
    totals: { requiredYear: 2347, eligible: 1213, doneYear: 32, proposals: 1193, mmrPerMonth: 250.4, unmet: 1122 },
    needs: {
      agentsPerVehicle: 4, peak: { agents: 22, agentsMonth: 10, vehicles: 8, vehiclesMonth: 10 },
      months: [{ month: 10, agentDays: 410, declared: 18, gap: 4 }, { month: 11, agentDays: 396, declared: 18, gap: 3 }],
      offices: [{ month: 10, officeName: 'Ampanihy', agentsNeeded: 5, declared: 2, gap: 3, vehiclesPeak: 2 }, { month: 10, officeName: 'Toliara', agentsNeeded: 3, declared: 4, gap: -1, vehiclesPeak: 1 }],
    },
  };
  const s = v.needsStatement(result, { tr, monthName });
  assert.deepEqual(s.lead, [
    'Le MMR demande 2347 visites sur l\'exercice pour 1213 sites (32 déjà faites ou prévues). D\'ici déc., 1193 visites sont planifiées, au moins 251 sites par mois selon le MMR.',
    '1122 visite(s) ne tiennent plus dans l\'exercice : l\'écart minimal entre deux visites ne laisse plus de place.',
    'Regroupées par commune, toutes activités, elles demandent 806 journées-agent : 22 agent(s) au mois le plus chargé (oct.) et 8 véhicule(s) au jour le plus chargé (4 agents par véhicule).',
    'Le MMR déclare 18 personne(s) : il en manque 4 ce mois-là.',
  ]);
  assert.deepEqual(s.gaps, ['Il manque 3 agent(s) en oct. à Ampanihy (5 nécessaires, 2 déclarés) ; 2 véhicule(s) au jour le plus chargé.']);
  const none = v.needsStatement({ ...result, needs: { ...result.needs, months: [{ month: 10, agentDays: 1, declared: null, gap: null }] } }, { tr, monthName });
  assert.equal(none.lead.at(-1), 'Le MMR ne déclare pas de personnes : l\'écart n\'est pas calculé.');
});

test('écran ↔ serveur : stratégies, valeurs reprises (lecture seule), catalogue des paramètres et communes à exclure', async (t) => {
  const v = await load(t, 'planGen.js'); if (!v) return;
  const S = require('../src/modules/tpm/planSettings');
  assert.deepEqual(Object.keys(v.STRATEGIES), S.STRATEGIES);
  assert.deepEqual(Object.keys(v.READ_ONLY_META), S.READ_ONLY.map((r) => r.key));
  assert.deepEqual(v.SETTING_FIELDS.map((f) => f.key).sort(), [...S.KEYS].sort());
  assert.deepEqual(v.settingsErrors({ strategy: 'besoins', agentsPerVehicle: 0, fieldDaysPerMonth: 2.5 }, S.BOUNDS),
    { agentsPerVehicle: { code: 'range', min: 1, max: 10 }, fieldDaysPerMonth: { code: 'integer', min: 1, max: 26 } });
  assert.deepEqual(v.settingsErrors({ ...S.DEFAULTS }, S.BOUNDS), {});
  assert.deepEqual(v.settingsDiff({ ...S.DEFAULTS, agentsPerVehicle: 3 }, S.DEFAULTS), ['agentsPerVehicle']);
  const f = v.SETTING_FIELDS.find((x) => x.key === 'strategy');
  assert.equal(v.settingText(f, 'capacite', tr), 'Limiter à la capacité déclarée');
  assert.deepEqual(v.communeChoices([{ district: 'B', commune: 'x' }, { district: 'A', commune: 'y' }, { district: 'a', commune: 'Y' }, { district: 'A', commune: '' }]),
    [{ key: 'a|y', district: 'A', commune: 'y', sites: 2 }, { key: 'b|x', district: 'B', commune: 'x', sites: 1 }]);
});

test('règle « site actif au mois M » : le miroir web est identique au serveur sur tous les cas', async (t) => {
  const v = await load(t, 'planBoard.js'); if (!v) return;
  for (const value of [true, false, null, undefined]) {
    for (const grid of [true, false]) assert.equal(v.isActiveMonth(value, grid), server.isActiveMonth(value, grid), `${value}/${grid}`);
  }
});
