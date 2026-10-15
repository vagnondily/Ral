const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaps, agentAuto, qualitativeFor, agentRow, freezeAgent } = require('../src/modules/evaluation/agentEvaluation');

const period = { from: '2026-04', to: '2026-06' };

test('chevauchement d\'une évaluation et de la période (mois)', () => {
  assert.equal(overlaps('2026-03-01', '2026-04-01', period), true);
  assert.equal(overlaps('2026-06-01', '2026-08-01', period), true);
  assert.equal(overlaps('2026-01-01', '2026-03-01', period), false);
  assert.equal(overlaps('2026-07-01', '2026-07-01', period), false);
  assert.equal(overlaps('2026-04-01', '2026-04-01', null), false);
});

const config = {
  formId: 'f1', formLabel: 'Suivi post-distribution', minSubmissions: 5, minCoveragePct: 60,
  criteria: [{ label: 'Volume', metric: 'volume', weight: 1, floor: 0, target: 20 }],
};

test('note automatique : fiches sans formulaire de l\'agent ignorées, sinon moyenne des fiches', () => {
  const none = agentAuto([config], new Map(), new Map());
  assert.equal(none.status, 'aucune_donnee');
  const a = agentAuto([config], new Map([['f1', { valid: 15, excluded: 0, withGps: 0, withSite: 0 }]]), new Map());
  assert.deepEqual([a.status, a.score, a.submissions], ['note', 15, 15]);
});

test('appréciation retenue : la dernière VALIDÉE qui chevauche la période, jamais une ancienne', () => {
  const evals = [
    { id: 'e3', status: 'brouillon', legacy: false, periodFrom: '2026-06-01', periodTo: '2026-06-01', qualScore: null },
    { id: 'e2', status: 'validee', legacy: false, periodFrom: '2026-04-01', periodTo: '2026-06-01', qualScore: 12 },
    { id: 'e1', status: 'validee', legacy: true, periodFrom: '2026-05-01', periodTo: '2026-05-01', qualScore: null, note: 18 },
    { id: 'e0', status: 'validee', legacy: false, periodFrom: '2025-01-01', periodTo: '2025-03-01', qualScore: 20 },
  ];
  const q = qualitativeFor(evals, period);
  assert.equal(q.validated.id, 'e2');
  assert.equal(q.draft.id, 'e3');
  assert.deepEqual(qualitativeFor([evals[2]], period), { validated: null, draft: null }, 'ancienne évaluation : jamais combinée');
});

test('ligne d\'un agent : note finale = auto × 60 % + qualitative × 40 %, bande et statut', () => {
  const measures = new Map([['f1', { valid: 15, excluded: 0, withGps: 0, withSite: 0 }]]);
  const evaluations = [{ id: 'e2', status: 'validee', legacy: false, periodFrom: '2026-04-01', periodTo: '2026-06-01', qualScore: 10 }];
  const r = agentRow({ id: 'a1', name: 'Agent 1' }, { configs: [config], measures, indicatorValues: new Map(), evaluations, settings: {}, period });
  // 15 × 0,6 + 10 × 0,4 = 13
  assert.deepEqual([r.auto.score, r.qualScore, r.finalScore, r.basis, r.band, r.evaluationStatus], [15, 10, 13, 'both', 'bon', 'validee']);
  const alone = agentRow({ id: 'a2' }, { configs: [config], measures, indicatorValues: new Map(), evaluations: [], settings: { agentAutoWeight: 50 }, period });
  assert.deepEqual([alone.finalScore, alone.basis, alone.evaluationStatus, alone.autoWeight], [15, 'first', 'a_evaluer', 50]);
  const nothing = agentRow({ id: 'a3' }, { configs: [config], measures: new Map(), indicatorValues: new Map(), evaluations: [], settings: {}, period });
  assert.deepEqual([nothing.finalScore, nothing.band, nothing.basis], [null, null, 'none']);
});

test('validation : grille recalculée, note automatique du serveur, combinaison figée avec son détail', () => {
  const current = { scores: [{ code: 'a', label: 'A', weight: 1, rating: 4 }, { code: 'b', label: 'B', weight: 1, rating: 2 }] };
  const f = freezeAgent(current, { auto: { score: 16, status: 'note', submissions: 30, forms: [] }, settings: {}, userId: 'u2' });
  // grille (20 + 6,7) / 2 = 13,3 ; finale 16 × 0,6 + 13,3 × 0,4 = 14,92 → 14,9
  assert.deepEqual([f.qualScore, f.autoScore, f.finalScore, f.band, f.appreciation, f.validatedBy], [13.3, 16, 14.9, 'bon', 'Bon', 'u2']);
  assert.equal(f.autoDetail.basis, 'both');
  const noAuto = freezeAgent(current, { auto: { score: null, status: 'aucune_donnee', submissions: 0, forms: [] }, settings: {}, userId: 'u2' });
  assert.deepEqual([noAuto.finalScore, noAuto.autoDetail.basis], [13.3, 'second']);
});
