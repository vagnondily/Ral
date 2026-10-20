/**
 * Empreinte des entrées de la planification automatique (planFingerprint) — pure : même entrée
 * dans un autre ordre → même empreinte ; chaque changement est nommé par sa section.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprintInputs, changedSections, canonical, SECTIONS } = require('../src/modules/tpm/planFingerprint');

const base = () => ({
  yearHasGrid: true,
  mmrByKey: { K: { interval: 4, feasible: 10 } },
  sites: [
    { id: 'b', district: 'D', commune: 'C', activity: 'A', riskLevel: 'moyenne', parametered: true, mmrKey: 'K', required: 3,
      visits: [{ month: 6, status: 'planifie' }, { month: 2, status: 'realise' }], cancelledMonths: [9], monthStatus: { 1: true },
      tpmSegments: [{ from: '2026-01', to: '2026-12', providerId: 'p', providerName: 'P' }] },
    { id: 'a', district: 'D', commune: 'E', activity: 'A', riskLevel: 'faible', visits: [], monthStatus: {} },
  ],
});
const params = { year: 2026, months: [10, 11, 12], fromMonth: '2026-10', settings: { strategy: 'besoins' }, writeSchedule: false };

test('canonique : clés et sites dans un autre ordre → même empreinte', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  const x = base(); const y = base();
  y.sites.reverse(); y.sites[1].visits.reverse();
  assert.equal(fingerprintInputs(x, params).fingerprint, fingerprintInputs(y, params).fingerprint);
  assert.match(fingerprintInputs(x, params).fingerprint, /^[0-9a-f]{64}$/);
});

test('chaque changement est nommé par sa section', () => {
  const ref = fingerprintInputs(base(), params);
  const cases = [
    ['registre', (i) => { i.sites[0].riskLevel = 'elevee'; }],
    ['registre', (i) => { i.sites[0].urgent = true; }],              // priorité du RBM : ordre des communes
    ['registre', (i) => { i.sites[1].finalScore = 7; }],
    ['visites', (i) => { i.sites[1].outsideVisits = [{ month: '2025-12', status: 'planifie' }]; }], // exercice voisin
    // Date et agent déjà écrits (ils réservent des créneaux) ; bureau racine du suivi interne.
    ['visites', (i) => { i.sites[0].visits[0].date = '2026-06-02'; }],
    ['visites', (i) => { i.sites[0].visits[0].agent = 'Agent 1'; }],
    ['registre', (i) => { i.sites[1].unitOfficeId = 'o2'; }],
    ['visites', (i) => { i.sites[0].visits.push({ month: 11, status: 'planifie' }); }],
    ['visites', (i) => { i.sites[0].cancelledMonths = []; }],
    ['activation', (i) => { i.sites[1].monthStatus = { 11: true }; }],
    ['activation', (i) => { i.yearHasGrid = false; }],
    ['mmr', (i) => { i.mmrByKey.K.feasible = 12; }],
    ['tpm', (i) => { i.sites[0].tpmSegments = []; }],
  ];
  for (const [section, mutate] of cases) {
    const inp = base(); mutate(inp);
    const fp = fingerprintInputs(inp, params);
    assert.notEqual(fp.fingerprint, ref.fingerprint, section);
    assert.deepEqual(changedSections(ref.sections, fp.sections), [section]);
  }
  // Paramètres : le premier mois planifiable dépend de l'horloge.
  const later = fingerprintInputs(base(), { ...params, fromMonth: '2026-11' });
  assert.deepEqual(changedSections(ref.sections, later.sections), ['parametres']);
  assert.deepEqual(SECTIONS, ['registre', 'visites', 'activation', 'mmr', 'tpm', 'parametres']);
});
