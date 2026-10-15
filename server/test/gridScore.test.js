const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  gridScore, combine, average, bandOf, providerScore, weightsOf, DEFAULT_CRITERIA,
} = require('../src/modules/evaluation/gridScore');

test('grille : 1 vaut 0, 4 vaut 20, pondérée, sur les seuls critères notés', () => {
  assert.equal(gridScore([{ weight: 1, rating: 4 }, { weight: 1, rating: 1 }]).score, 10);
  assert.equal(gridScore([{ weight: 1, rating: 3 }]).score, 13.3);
  assert.equal(gridScore([{ weight: 1, rating: 2 }]).score, 6.7);
  // poids 3 × « 4 » + poids 1 × « 1 » → 20 × 9/3 / 4 = 15
  assert.equal(gridScore([{ weight: 3, rating: 4 }, { weight: 1, rating: 1 }]).score, 15);
  const partial = gridScore([{ weight: 1, rating: 4 }, { weight: 1, rating: null }, { weight: 2, rating: 'x' }]);
  assert.deepEqual([partial.score, partial.rated, partial.total, partial.complete], [20, 1, 3, false]);
  const none = gridScore([{ weight: 1, rating: null }]);
  assert.equal(none.score, null, 'aucune note : pas de note, jamais 0');
  assert.equal(gridScore([]).complete, false);
});

test('grille : détail par critère (sur 20, part du poids)', () => {
  const g = gridScore([{ code: 'a', label: 'A', weight: 1, rating: 3 }, { code: 'b', label: 'B', weight: 2, rating: 4 }]);
  assert.deepEqual(g.detail, [
    { code: 'a', label: 'A', rating: 3, on20: 13.3, weightPct: 33.3 },
    { code: 'b', label: 'B', rating: 4, on20: 20, weightPct: 66.7 },
  ]);
  assert.equal(g.score, 17.8); // 20 × (1×2 + 2×3) / 3 / 3 = 17,78
});

test('arrondi au dixième, demi vers le haut, sans erreur de flottant', () => {
  // 12,25 × 10 = 122,49999… en flottant : l'arithmétique entière donne bien 12,3
  assert.equal(combine(12.5, 12, 50).score, 12.3);
  assert.equal(average([12.2, 12.3]), 12.3); // 12,25 → 12,3
  assert.equal(average([10, null, 'x']), 10);
  assert.equal(average([]), null);
});

test('combinaison : les deux, ou l\'une seule (et on le dit)', () => {
  assert.deepEqual(combine(15, 10, 60), { score: 13, basis: 'both' });
  assert.deepEqual(combine(null, 10, 60), { score: 10, basis: 'second' });
  assert.deepEqual(combine(15, null, 60), { score: 15, basis: 'first' });
  assert.deepEqual(combine(null, null, 60), { score: null, basis: 'none' });
  assert.throws(() => combine(1, 2, 120), /Pondération/);
});

test('bandes : 16 Excellent, 12 Bon, 10 Moyen, sinon Insuffisant', () => {
  assert.deepEqual([16, 15.9, 12, 10, 9.9, 0].map(bandOf), ['excellent', 'bon', 'bon', 'moyen', 'insuffisant', 'insuffisant']);
  assert.equal(bandOf(null), null);
});

test('note du prestataire : moyenne des agents × 30 % + grille × 70 % par défaut', () => {
  const p = providerScore({ answers: [{ weight: 1, rating: 4 }], agentScores: [10, 14, null] });
  assert.equal(p.grid.score, 20);
  assert.equal(p.agentsScore, 12);
  assert.equal(p.agentsCount, 2);
  assert.equal(p.score, 17.6); // 0,3 × 12 + 0,7 × 20
  assert.equal(p.band, 'excellent');
  const noAgents = providerScore({ answers: [{ weight: 1, rating: 3 }], agentScores: [] });
  assert.deepEqual([noAgents.score, noAgents.basis], [13.3, 'second']);
});

test('pondérations du compte : valeurs par défaut si absentes ou invalides', () => {
  assert.deepEqual(weightsOf(null), { agentAutoWeight: 60, providerAgentsWeight: 30 });
  assert.deepEqual(weightsOf({ agentAutoWeight: 100, providerAgentsWeight: 0 }), { agentAutoWeight: 100, providerAgentsWeight: 0 });
  assert.deepEqual(weightsOf({ agentAutoWeight: 140, providerAgentsWeight: 'x' }), { agentAutoWeight: 60, providerAgentsWeight: 30 });
});

test('critères par défaut : codes valides et uniques par portée', () => {
  for (const scope of ['prestataire', 'agent']) {
    const codes = DEFAULT_CRITERIA[scope].map(([c]) => c);
    assert.equal(new Set(codes).size, codes.length, scope);
    for (const c of codes) assert.match(c, /^[a-z0-9_]{2,40}$/);
  }
  assert.ok(DEFAULT_CRITERIA.prestataire.some(([c]) => c === 'delai_rapportage'));
});

test('critères par défaut : libellé et aide ont leur anglais (traduits à l\'affichage par tr())', async (t) => {
  const file = path.join(__dirname, '../../web/src/locales/en.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const en = (await import(pathToFileURL(file).href)).default;
  const missing = Object.values(DEFAULT_CRITERIA).flat().flatMap(([, label, help]) => [label, help])
    .filter((s) => !Object.prototype.hasOwnProperty.call(en, s));
  assert.deepEqual(missing, []);
});

test('miroir d\'affichage du navigateur (web/src/lib/evaluation.js) : même note, même bande', async (t) => {
  const file = path.join(__dirname, '../../web/src/lib/evaluation.js');
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return; }
  const web = await import(pathToFileURL(file).href);
  const cases = [
    [{ weight: 1, rating: 3 }], [{ weight: 3, rating: 4 }, { weight: 1, rating: 1 }], [{ weight: 1, rating: 2 }, { weight: 2, rating: 3 }],
    [{ weight: 0.5, rating: 4 }, { weight: 1.25, rating: null }, { weight: 2, rating: 1 }], [], [{ weight: 1, rating: null }],
  ];
  for (const c of cases) {
    const s = gridScore(c); const w = web.gridScore(c);
    assert.deepEqual([w.score, w.rated, w.total, w.complete], [s.score, s.rated, s.total, s.complete]);
  }
  for (const x of [0, 9.9, 10, 11.95, 12, 15.9, 16, 20, null]) assert.equal(web.bandOf(x), bandOf(x));
});
