const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGrid, applyRatings, checkValidation, freeze, RuleError } = require('../src/modules/evaluation/providerEvaluation');

const criteria = [
  { code: 'proactivite', label: 'Proactivité', weight: 1, sortOrder: 10 },
  { code: 'delai_rapportage', label: 'Délais de rapportage', weight: 2, sortOrder: 20 },
];

test('brouillon : une ligne par critère actif (libellé et poids copiés), notes saisies reprises', () => {
  const g = buildGrid(criteria, [{ code: 'delai_rapportage', rating: 4, comment: '  À temps  ' }]);
  assert.deepEqual(g.scores.map((s) => [s.code, s.label, s.weight, s.rating, s.comment]), [
    ['proactivite', 'Proactivité', 1, null, null],
    ['delai_rapportage', 'Délais de rapportage', 2, 4, 'À temps'],
  ]);
  assert.equal(g.gridScore, 20, 'note sur les seuls critères notés');
  assert.throws(() => buildGrid(criteria, [{ code: 'inconnu', rating: 2 }]), (e) => e instanceof RuleError && e.code === 'unknown_criterion');
});

test('modification : seulement les critères de SA grille, par son évaluateur, jamais une évaluation validée', () => {
  const current = { status: 'brouillon', evaluatedBy: 'u1', scores: buildGrid(criteria, []).scores };
  const r = applyRatings(current, [{ code: 'proactivite', rating: 1 }], 'u1');
  assert.deepEqual(r.scores.map((s) => [s.code, s.rating]), [['proactivite', 1]], 'seules les lignes modifiées repartent en base');
  assert.equal(r.gridScore, 0);
  assert.throws(() => applyRatings({ ...current, status: 'validee' }, [], 'u1'), (e) => e.code === 'validated');
  assert.throws(() => applyRatings(current, [{ code: 'autre', rating: 1 }], 'u1'), (e) => e.code === 'unknown_criterion');
  assert.throws(() => applyRatings(current, [{ code: 'proactivite', rating: 4 }], 'u2'), (e) => e.code === 'duty', 'le valideur ne retouche pas la grille');
  assert.throws(() => applyRatings(current, []), (e) => e.code === 'duty', 'sans auteur connu : refusé');
});

test('validation : déjà validée (409), même personne (403), grille incomplète (400 avec la liste)', () => {
  const scores = buildGrid(criteria, [{ code: 'proactivite', rating: 3 }]).scores;
  assert.throws(() => checkValidation({ status: 'validee', evaluatedBy: 'u1', scores }, 'u2'), (e) => e.code === 'validated');
  assert.throws(() => checkValidation({ status: 'brouillon', evaluatedBy: 'u1', scores }, 'u1'), (e) => e.code === 'duty');
  assert.throws(() => checkValidation({ status: 'brouillon', evaluatedBy: 'u1', scores }, 'u2'),
    (e) => e.code === 'incomplete' && e.missing.join() === 'Délais de rapportage');
  assert.throws(() => checkValidation({ status: 'brouillon', evaluatedBy: 'u1', scores: [] }, 'u2'), (e) => e.code === 'incomplete');
  const full = buildGrid(criteria, [{ code: 'proactivite', rating: 3 }, { code: 'delai_rapportage', rating: 2 }]).scores;
  assert.doesNotThrow(() => checkValidation({ status: 'brouillon', evaluatedBy: 'u1', scores: full }, 'u2'));
});

test('notes figées : grille recalculée, moyenne des agents, pondération du compte, détail', () => {
  const scores = buildGrid(criteria, [{ code: 'proactivite', rating: 4 }, { code: 'delai_rapportage', rating: 4 }]).scores;
  const f = freeze({ scores }, {
    agents: [{ agentId: 'a1', name: 'A', score: 10 }, { agentId: 'a2', name: 'B', score: null }, { agentId: 'a3', name: 'C', score: 14 }],
    settings: { providerAgentsWeight: 50 }, userId: 'u2',
  });
  assert.deepEqual([f.gridScore, f.agentsScore, f.agentsCount, f.agentsWeight, f.finalScore, f.band, f.validatedBy],
    [20, 12, 2, 50, 16, 'excellent', 'u2']);
  assert.equal(f.detail.basis, 'both');
  assert.equal(f.detail.agents.length, 3, 'le détail montre aussi les agents sans note');
  const alone = freeze({ scores }, { agents: [], settings: null, userId: 'u2' });
  assert.deepEqual([alone.finalScore, alone.agentsWeight, alone.detail.basis], [20, 30, 'second']);
});

test('notes des agents pour la note du TPM : dernière évaluation validée, lot 8 avant ancienne ; ancienne /20 comptée', () => {
  const { agentScoresForPeriod } = require('../src/modules/evaluation/providerEvaluation');
  const rows = [
    { agentId: 'a1', name: 'H. Solo', evaluationId: 'e1', legacy: true, note: 14, periodTo: '2026-02', createdAt: '2026-02-10T08:00:00Z' },
    { agentId: 'a2', name: 'R. Randria', evaluationId: 'e2', legacy: true, note: 11, periodTo: '2026-01', createdAt: '2026-01-05T08:00:00Z' },
    { agentId: 'a2', name: 'R. Randria', evaluationId: 'e3', legacy: true, note: 15, periodTo: '2026-03', createdAt: '2026-03-05T08:00:00Z' },
    { agentId: 'a3', name: 'L. Miora', evaluationId: 'e4', legacy: true, note: 9, periodTo: '2026-04', createdAt: '2026-04-05T08:00:00Z' },
    { agentId: 'a3', name: 'L. Miora', evaluationId: 'e5', legacy: false, finalScore: 13.25, periodTo: '2026-03', validatedAt: new Date('2026-03-31T08:00:00Z') },
    { agentId: 'a4', name: 'Sans note', evaluationId: null },
    { agentId: 'a5', name: 'Note vide', evaluationId: 'e6', legacy: true, note: null, periodTo: '2026-02' },
  ];
  assert.deepEqual(agentScoresForPeriod(rows), [
    { agentId: 'a1', name: 'H. Solo', score: 14, source: 'ancienne', evaluationId: 'e1' },
    { agentId: 'a2', name: 'R. Randria', score: 15, source: 'ancienne', evaluationId: 'e3' },
    { agentId: 'a3', name: 'L. Miora', score: 13.3, source: 'evaluation', evaluationId: 'e5' },
    { agentId: 'a4', name: 'Sans note', score: null, source: null, evaluationId: null },
    { agentId: 'a5', name: 'Note vide', score: null, source: null, evaluationId: null },
  ]);
  // Repris par la note du TPM : moyenne des agents notés seulement.
  const f = freeze({ scores: [{ code: 'x', label: 'X', weight: 1, rating: 4 }] }, { agents: agentScoresForPeriod(rows), settings: null, userId: 'u2' });
  assert.equal(f.agentsCount, 3);
});

test('validation : seulement la version vue par le valideur (updatedAt), sinon 409', () => {
  const { checkSeen } = require('../src/modules/evaluation/providerEvaluation');
  const current = { updatedAt: new Date('2026-10-20T06:00:00.123Z') };
  assert.doesNotThrow(() => checkSeen(current, '2026-10-20T06:00:00.123Z'));
  assert.doesNotThrow(() => checkSeen(current, '2026-10-20T09:00:00.123+03:00'));
  for (const seen of ['2026-10-20T06:00:00.124Z', undefined, 'n\'importe quoi']) {
    assert.throws(() => checkSeen(current, seen), (e) => e instanceof RuleError && e.code === 'stale');
  }
});
