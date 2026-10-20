const test = require('node:test');
const assert = require('node:assert/strict');
const { measure, subScore, formScore, autoScore, checkCriterion, defaultSpan, round1 } = require('../src/modules/evaluation/agentScore');

const m = { valid: 18, excluded: 2, withGps: 9, withSite: 18 };

test('mesures : volume, part écartée sur l\'ensemble reçu, parts GPS / site sur les valides, indicateur', () => {
  assert.equal(measure('volume', m), 18);
  assert.equal(measure('ecartes', m), 10);
  assert.equal(measure('gps', m), 50);
  assert.equal(measure('site', m), 100);
  assert.equal(measure('indicateur', m, 72.5), 72.5);
  assert.equal(measure('indicateur', m, null), null, 'indicateur non calculable : pas de valeur');
  assert.equal(measure('gps', { valid: 0, excluded: 3 }), null, 'aucun formulaire valide : pas de part, jamais 0 %');
  assert.equal(measure('ecartes', { valid: 0, excluded: 0 }), null);
});

test('sous-score : linéaire entre plancher et cible, dans les deux sens, borné à 0–1', () => {
  assert.equal(subScore(5, 5, 20), 0);
  assert.equal(subScore(20, 5, 20), 1);
  assert.equal(subScore(12.5, 5, 20), 0.5);
  assert.equal(subScore(30, 5, 20), 1, 'au-delà de la cible : plein');
  assert.equal(subScore(11, 20, 2), 0.5, 'plus c\'est bas, mieux c\'est (écartés 20 % → 2 %)');
  assert.equal(subScore(25, 20, 2), 0);
  assert.equal(subScore(null, 0, 1), null);
  assert.throws(() => subScore(1, 3, 3), /différer/);
});

const config = {
  formId: 'f1', minSubmissions: 5, minCoveragePct: 60,
  criteria: [
    { label: 'Volume', metric: 'volume', weight: 2, floor: 5, target: 20 },
    { label: 'Écartés', metric: 'ecartes', weight: 1, floor: 20, target: 2 },
    { label: 'Présence du site', metric: 'indicateur', indicatorId: 'i1', weight: 1, floor: 50, target: 100 },
  ],
};

test('note d\'une fiche : 20 × Σ w·s ÷ Σ w des critères mesurés, détail par critère', () => {
  // volume 18 → (18−5)/15 = 0,8667 ; écartés 10 % → (10−20)/(2−20) = 0,5556 ; indicateur 75 → 0,5
  const r = formScore(config, m, new Map([['i1', 75]]));
  assert.equal(r.status, 'note');
  assert.equal(r.coverage, 100);
  assert.equal(r.score, round1((20 * (2 * 13 / 15 + 1 * 10 / 18 + 1 * 0.5)) / 4));
  assert.equal(r.score, 13.9);
  assert.deepEqual(r.criteria.map((c) => [c.value, c.subScore, c.direction]), [[18, 86.7, 'higher'], [10, 55.6, 'lower'], [75, 50, 'higher']]);
  const pts = r.criteria.reduce((s, c) => s + c.points, 0);
  assert.ok(Math.abs(pts - r.score) <= 0.15, 'les points des critères redonnent la note (aux arrondis près)');
});

test('note d\'une fiche : données insuffisantes, couverture trop faible, critères non mesurés écartés', () => {
  assert.equal(formScore(config, { valid: 4, excluded: 0 }).status, 'donnees_insuffisantes');
  // indicateur sans valeur : couverture 3/4 = 75 % ≥ 60 % → note sur les deux critères mesurés
  const partial = formScore(config, m, new Map());
  assert.deepEqual([partial.status, partial.coverage], ['note', 75]);
  assert.equal(partial.score, round1((20 * (2 * 13 / 15 + 10 / 18)) / 3));
  const strict = formScore({ ...config, minCoveragePct: 80 }, m, new Map());
  assert.deepEqual([strict.status, strict.score], ['non_evaluable', null]);
  assert.equal(formScore({ ...config, criteria: [] }, m).status, 'non_configure');
});

test('note automatique : moyenne des fiches notées pondérée par leurs formulaires valides', () => {
  const a = autoScore([
    { status: 'note', score: 16, submissions: 30 },
    { status: 'note', score: 10, submissions: 10 },
    { status: 'donnees_insuffisantes', score: null, submissions: 2 },
  ]);
  assert.deepEqual([a.status, a.score, a.submissions], ['note', 14.5, 42]);
  assert.equal(autoScore([]).status, 'aucune_donnee');
  assert.equal(autoScore([{ status: 'donnees_insuffisantes', submissions: 3 }]).status, 'donnees_insuffisantes');
  assert.equal(autoScore([{ status: 'non_evaluable', submissions: 30 }]).status, 'non_evaluable');
});

test('arrondi au dixième demi vers le haut, sans erreur de flottant', () => {
  assert.equal(round1(12.25), 12.3);
  assert.equal(round1(14.149999999), 14.1);
  assert.equal(round1(0.05), 0.1);
});

test('critère saisi : mesure connue, poids > 0, plancher ≠ cible, indicateur seulement pour « indicateur »', () => {
  assert.deepEqual(checkCriterion({ metric: 'volume', weight: 1, floor: 1, target: 10 }), []);
  assert.deepEqual(checkCriterion({ metric: 'autre', weight: 0, floor: 3, target: 3, indicatorId: 'x' }), ['metric', 'weight', 'thresholds', 'indicator']);
  assert.deepEqual(checkCriterion({ metric: 'indicateur', weight: 1, floor: 0, target: 100 }), ['indicator']);
});

test('période proposée : la plus longue des fiches actives', () => {
  assert.equal(defaultSpan([{ period: 'mois' }, { period: 'semestre', enabled: false }, { period: 'trimestre' }]), 3);
  assert.equal(defaultSpan([]), 3);
  assert.equal(defaultSpan([{ period: 'mois' }]), 1);
});
