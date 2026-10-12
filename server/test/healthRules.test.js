const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHealth, summarizeHealth } = require('../src/modules/settings/healthRules');

const READY = {
  areas: { total: 1900, communes: 1600, communesWithPcode: 1600 },
  detachedZones: 0,
  sites: { total: 1280, withoutPcode: 0, withoutOffice: 0 },
  officesWithoutPerimeter: 0, activityWithoutMmr: 0, formsWithoutActivity: 0, formsActive: 4,
  queue: { entries: 0, sitesOcc: 0, submissionsOcc: 0 },
  submissions: { total: 900, withoutOffice: 0, monthTotal: 120, monthWithoutCommune: 3, month: '2026-09' },
  tpm: { active: 3, withoutAgent: 0, withoutContract: 0, contractsWithoutLine: 0 },
  draftPlansPast: 0, monthsWithoutRate: 0, profile: { currency: 'MGA', center: true }, validators: 3,
};
const by = (rules, code) => rules.find((r) => r.code === code);

test('configuration complète : tout est prêt, les règles des lots à venir sont « non mesurables » (jamais 0)', () => {
  const rules = evaluateHealth(READY);
  const measured = rules.filter((r) => r.status !== 'non_mesurable');
  assert.ok(measured.every((r) => r.status === 'pret'), JSON.stringify(measured.filter((r) => r.status !== 'pret')));
  assert.deepEqual(rules.filter((r) => r.status === 'non_mesurable').map((r) => r.code).sort(),
    ['agents_a_reconnaitre', 'agents_sans_code', 'frequences_risque', 'methode_notation', 'themes_formation']);
  assert.equal(summarizeHealth(rules).worst, 'pret');
  // Chaque règle dit où se régler et qui en dépend.
  for (const r of rules) { assert.ok(r.fix && r.fix.hash, r.code); assert.ok(r.consumers.length, r.code); }
});

test('bloquants : pas de découpage, pas de prestataire de suivi, moins de 2 valideurs', () => {
  const rules = evaluateHealth({ ...READY, areas: { total: 0 }, tpm: { active: 0 }, validators: 1 });
  assert.equal(by(rules, 'decoupage').status, 'bloquant');
  assert.equal(by(rules, 'tpm_absent').status, 'bloquant');
  assert.equal(by(rules, 'valideurs').status, 'bloquant');
  assert.equal(summarizeHealth(rules).worst, 'bloquant');
});

test('découpage sans codes officiels ou sans niveau commune → à compléter, avec le nombre', () => {
  const r1 = by(evaluateHealth({ ...READY, areas: { total: 1900, communes: 1600, communesWithPcode: 1200 } }), 'decoupage');
  assert.equal(r1.status, 'a_completer'); assert.equal(r1.count, 400); assert.equal(r1.total, 1600);
  const r2 = by(evaluateHealth({ ...READY, areas: { total: 35, communes: 0, communesWithPcode: 0 } }), 'decoupage');
  assert.equal(r2.status, 'a_completer');
});

test('formulaires sans commune : seuil de 10 % sur le dernier mois ; file « À rapprocher » bloquante au-delà de 10 % des formulaires', () => {
  const r = by(evaluateHealth({ ...READY, submissions: { ...READY.submissions, monthWithoutCommune: 30 } }), 'formulaires_sans_commune');
  assert.equal(r.status, 'a_completer'); assert.equal(r.message.params.p, 25);
  assert.equal(by(evaluateHealth(READY), 'formulaires_sans_commune').status, 'pret'); // 2,5 %
  const q = (occ) => by(evaluateHealth({ ...READY, queue: { entries: 4, sitesOcc: 10, submissionsOcc: occ } }), 'lieux_a_rapprocher').status;
  assert.equal(q(50), 'a_completer');
  assert.equal(q(91), 'bloquant');
});

test('messages : phrase française à paramètres (traduite par l\'interface)', () => {
  const r = by(evaluateHealth({ ...READY, sites: { total: 1280, withoutPcode: 97, withoutOffice: 5 } }), 'sites_sans_code_commune');
  assert.match(r.message.text, /\{n\} site\(s\) sur \{total\}/);
  assert.deepEqual(r.message.params, { n: 97, total: 1280 });
});
