/**
 * Score par VISITE (lot 7a) et phrase d'interprétation d'un indicateur — monitoringMath,
 * pur. Une visite est notée sur les indicateurs EN % notés auxquels elle a répondu, avec les
 * mêmes règles de réponse que le décompte et la même règle de classe (bandes 80 / 65 / 50).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { visitScore, interpretIndicator, classify } = require('../src/modules/monitoring/monitoringMath');
const { pageFacts, mergeVisits } = require('../src/modules/monitoring/indicatorTallies');

const IND = [
  { id: 'a', sourceField: 'a', agg: 'percent_yes', direction: 'higher_better' },
  { id: 'b', sourceField: 'b', agg: 'percent_yes', direction: 'lower_better' },
  { id: 'c', sourceField: 'c', agg: 'percent_value', positiveValue: '2|3', naValues: ['99'] },
  { id: 'm', sourceField: 'm', agg: 'mean' },
  { id: 'x', sourceField: 'x', agg: 'percent_yes', scored: false },
];

test('score d\'une visite : moyenne orientée des indicateurs % notés répondus', () => {
  // a oui (100), b oui mais « plus bas = mieux » (0), c = 3 positif (100) → 66,7 → « Satisfaisant »
  assert.deepEqual(visitScore(IND, { a: 'oui', b: 'oui', c: '3', m: '12', x: 'non' }), { score: 66.7, answered: 3, rating: 'sat' });
  // vides et codes « hors base » écartés, moyenne et hors indice ignorés
  assert.deepEqual(visitScore(IND, { a: '', c: '99', m: '4', x: 'oui' }), { score: null, answered: 0, rating: 'na' });
  assert.equal(visitScore(IND, { a: 'non', b: 'non' }).rating, classify({ value: 50, base: 2, agg: 'percent_yes', target: null }));
});

test('classes par visite : la somme des classes = nombre de visites ; visites urgentes gardées triées', () => {
  const rows = [{ a: 'oui' }, { a: 'non', b: 'oui' }, { a: 'non' }, {}, { c: '2' }].map((data, i) => ({ data, meta: { id: `v${i}` } }));
  const { visits } = pageFacts(IND, rows, [], { visits: true, keep: 10 });
  assert.equal(visits.n, 5);
  assert.deepEqual(visits.classes, { exc: 2, sat: 0, imp: 0, urg: 2, na: 1 });
  assert.deepEqual(visits.urgent.map((u) => u.id), ['v1', 'v2']);
  const merged = mergeVisits([visits, visits], 3);
  assert.equal(merged.n, 10); assert.equal(merged.urgent.length, 3);
});

test('phrase d\'interprétation (fr / en) : mêmes chiffres, alerte sous le seuil', () => {
  const r = { value: 52.4, base: 120, target: 80, agg: 'percent_yes', direction: 'higher_better' };
  const fr = interpretIndicator(r, 'fr');
  const sp = (x) => x.replace(/\s/g, ' '); // espaces insécables du format français
  assert.equal(sp(fr.sentence), '52,4 % des 120 réponses comptées sont positives (cible 80 %).');
  assert.equal(fr.rating, classify(r)); assert.ok(fr.alert);
  const en = interpretIndicator(r, 'en');
  assert.equal(en.sentence, '52.4% of the 120 counted answers are positive (target 80%).');
  assert.equal(interpretIndicator({ value: null, base: 0, agg: 'percent_yes' }, 'en').ratingLabel, 'Not assessed');
  assert.equal(sp(interpretIndicator({ value: 12.5, base: 40, agg: 'mean', target: null }, 'fr').sentence), 'Moyenne de 12,5 sur 40 réponses.');
});
