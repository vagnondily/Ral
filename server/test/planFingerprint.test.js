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
    // Date et agent déjà écrits d'une visite d'un mois ouvert (ils réservent un créneau) ; bureau
    // racine du suivi interne d'un site sans TPM de zone.
    ['visites', (i) => { i.sites[1].visits = [{ month: 11, status: 'planifie', date: '2026-11-02', agent: 'Agent 1' }]; }],
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

test('date et agent : seulement là où le moteur les lit (mois ouvert, « Agent N », visite prévue ou réalisée)', () => {
  const withVisit = (v) => { const i = base(); i.sites[1].visits = [{ month: 11, status: 'planifie', ...v }]; return i; };
  const fp = (i) => fingerprintInputs(i, params);
  const ref = fp(withVisit({ date: '2026-11-02', agent: 'Agent 1' }));
  // Lus : autre date, autre agent générique → « visites ».
  assert.deepEqual(changedSections(ref.sections, fp(withVisit({ date: '2026-11-03', agent: 'Agent 1' })).sections), ['visites']);
  assert.deepEqual(changedSections(ref.sections, fp(withVisit({ date: '2026-11-02', agent: 'Agent 2' })).sections), ['visites']);
  // Même agent écrit autrement (le moteur lit son numéro) : rien ne change.
  assert.equal(fp(withVisit({ date: '2026-11-02', agent: ' agent 1 ' })).fingerprint, ref.fingerprint);
  // Non lus : agent nommé, date sans agent, agent sans date → comme une visite sans créneau.
  const bare = fp(withVisit({}));
  for (const v of [{ date: '2026-11-02', agent: 'Rakoto' }, { date: '2026-11-02', agent: 'Rabe' }, { date: '2026-11-02' }, { agent: 'Agent 1' }]) {
    assert.equal(fp(withVisit(v)).fingerprint, bare.fingerprint, JSON.stringify(v));
  }
  // Mois hors période (octobre, quand la période est novembre–décembre) : date et agent non lus.
  const p2 = { ...params, months: [11, 12] };
  const oct = (v) => { const i = base(); i.sites[1].visits = [{ month: 10, status: 'planifie', ...v }]; return fingerprintInputs(i, p2); };
  assert.equal(oct({ date: '2026-10-21', agent: 'Agent 1' }).fingerprint, oct({}).fingerprint);
  // Une visite annulée ne réserve rien.
  const cancelled = (v) => { const i = base(); i.sites[1].visits = [{ month: 11, status: 'annule', ...v }]; return fingerprintInputs(i, params); };
  assert.equal(cancelled({ date: '2026-11-02', agent: 'Agent 1' }).fingerprint, cancelled({}).fingerprint);
});

test('bureau racine : compté seulement pour un site sans TPM de zone un mois ouvert', () => {
  const ref = fingerprintInputs(base(), params);
  // Le site « b » a un TPM toute l'année : son bureau ne change pas son unité.
  const moved = base(); moved.sites[0].unitOfficeId = 'o9';
  assert.equal(fingerprintInputs(moved, params).fingerprint, ref.fingerprint);
  // Son TPM s'arrête en octobre : en novembre il est suivi par son bureau → compté.
  const gap = base(); gap.sites[0].tpmSegments = [{ from: '2026-01', to: '2026-10', providerId: 'p', providerName: 'P' }];
  const gapMoved = base(); gapMoved.sites[0].tpmSegments = gap.sites[0].tpmSegments; gapMoved.sites[0].unitOfficeId = 'o9';
  assert.deepEqual(changedSections(fingerprintInputs(gap, params).sections, fingerprintInputs(gapMoved, params).sections), ['registre']);
  // Le site « a » sans TPM : compté.
  const a = base(); a.sites[1].unitOfficeId = 'o9';
  assert.deepEqual(changedSections(ref.sections, fingerprintInputs(a, params).sections), ['registre']);
});
