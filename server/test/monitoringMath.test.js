const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIndicator, computeAll, rate, overallIndex } = require('../src/modules/monitoring/monitoringMath');

const subs = (field, values) => values.map((v) => ({ data: { [field]: v } }));

test('percent_yes: share of positive answers among those answered', () => {
  const r = computeIndicator({ sourceField: 'cfm', agg: 'percent_yes' }, subs('cfm', ['yes', 'no', 'oui', '', 'non']));
  assert.equal(r.base, 4);          // the empty one is excluded
  assert.equal(r.value, 50);        // 2 of 4
});

test('percent_value: positive when equal to positiveValue', () => {
  const r = computeIndicator({ sourceField: 'q', agg: 'percent_value', positiveValue: 'A' }, subs('q', ['A', 'B', 'A', 'C']));
  assert.equal(r.value, 50);
});

test('mean averages the numeric answers', () => {
  const r = computeIndicator({ sourceField: 'score', agg: 'mean' }, subs('score', ['10', '20', 'x', '30']));
  assert.equal(r.base, 3);
  assert.equal(r.value, 20);
});

test('count and sum', () => {
  assert.equal(computeIndicator({ sourceField: 'x', agg: 'count' }, subs('x', ['a', '', 'b'])).value, 2);
  assert.equal(computeIndicator({ sourceField: 'x', agg: 'sum' }, subs('x', ['5', '7', ''])).value, 12);
});

test('value is null (na) when nothing was answered', () => {
  const r = computeIndicator({ sourceField: 'x', agg: 'percent_yes' }, subs('x', ['', '']));
  assert.equal(r.value, null);
  assert.equal(r.rating, 'na');
});

test('rating against a higher-better target', () => {
  assert.equal(rate(90, { target: 80, direction: 'higher_better' }), 'exc');
  assert.equal(rate(75, { target: 80, direction: 'higher_better' }), 'sat'); // within 10 %
  assert.equal(rate(60, { target: 80, direction: 'higher_better' }), 'imp'); // écart ≤ 30 %
  assert.equal(rate(50, { target: 80, direction: 'higher_better' }), 'urg'); // au-delà : action urgente
  assert.equal(rate(null, { target: 80 }), 'na');
});

test('rating against a lower-better target (e.g. % de fraude)', () => {
  assert.equal(rate(2, { target: 5, direction: 'lower_better' }), 'exc');
  assert.equal(rate(6, { target: 5, direction: 'lower_better' }), 'imp');
  assert.equal(rate(30, { target: 5, direction: 'lower_better' }), 'urg');
});

test('sans cible : un % est classé par les bandes des modèles (score orienté), une moyenne reste non évaluée', () => {
  assert.equal(rate(85, { agg: 'percent_yes' }), 'exc');
  assert.equal(rate(70, { agg: 'percent_value' }), 'sat');
  assert.equal(rate(55, { agg: 'percent_yes' }), 'imp');
  assert.equal(rate(40, { agg: 'percent_yes' }), 'urg');
  assert.equal(rate(10, { agg: 'percent_yes', direction: 'lower_better' }), 'exc'); // 100 − 10 = 90
  assert.equal(rate(3.2, { agg: 'mean' }), 'na');
  const r = computeIndicator({ sourceField: 'x', agg: 'percent_yes' }, subs('x', ['oui', 'oui', 'non']));
  assert.equal(r.rating, 'sat'); // 66,7 % sans cible : ≥ 65
});

test('overallIndex averages only the percentage indicators that computed', () => {
  const results = [
    { agg: 'percent_yes', value: 80 },
    { agg: 'percent_value', value: 60 },
    { agg: 'mean', value: 12 },      // excluded (not a percentage)
    { agg: 'percent_yes', value: null }, // excluded (na)
  ];
  assert.equal(overallIndex(results), 70);
  assert.equal(overallIndex([{ agg: 'mean', value: 5 }]), null);
  assert.equal(overallIndex([]), null);
});

test('computeAll returns one result per indicator', () => {
  const inds = [
    { id: 'i1', code: 'cfm', label: 'CFM utilisé', sourceField: 'cfm', agg: 'percent_yes', target: 80, direction: 'higher_better' },
    { id: 'i2', code: 'sc', label: 'Score', sourceField: 'score', agg: 'mean' },
  ];
  const rows = [{ data: { cfm: 'yes', score: 10 } }, { data: { cfm: 'no', score: 20 } }];
  const out = computeAll(inds, rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].value, 50);
  assert.equal(out[1].value, 15);
});

// --- Règles des modèles de référence (tableau de bord et rapport de suivi) ----------
test('réponses « hors base » (Sans objet 9999, Ne sait pas 888) exclues, pas comptées comme « non »', () => {
  const rows = ['1', '0', '9999', '1', '888'].map((v) => ({ data: { HelpDesk: v } }));
  const r = computeIndicator({ sourceField: 'HelpDesk', agg: 'percent_yes', positiveValue: '1', naValues: ['9999', '888'] }, rows);
  assert.equal(r.base, 3);
  assert.equal(r.value, 66.7);
  // Sans liste hors base : comportement inchangé (9999 compté comme « non »).
  assert.equal(computeIndicator({ sourceField: 'HelpDesk', agg: 'percent_yes', positiveValue: '1' }, rows).value, 40);
});

test('plusieurs valeurs positives (« Très sûr » 1 et « Sûr » 2)', () => {
  const rows = ['1', '2', '3', '4'].map((v) => ({ data: { Acces: v } }));
  assert.equal(computeIndicator({ sourceField: 'Acces', agg: 'percent_value', positiveValue: '1|2' }, rows).value, 50);
});

test('indice = moyenne des domaines ; indicateurs « plus bas = mieux » inversés (GD D7 = 91)', () => {
  const lower = 'lower_better';
  const d7 = [
    { agg: 'percent_yes', module: 'D7', value: 19, direction: lower },
    { agg: 'percent_yes', module: 'D7', value: 6, direction: lower },
    { agg: 'percent_yes', module: 'D7', value: 8, direction: lower },
    { agg: 'percent_yes', module: 'D7', value: 98 },
  ];
  assert.equal(Math.round(overallIndex(d7)), 91);
  // Deux domaines à poids égaux : (90 + 50) / 2 = 70, pas la moyenne des 3 indicateurs (76,7).
  assert.equal(overallIndex([
    { agg: 'percent_yes', module: 'D1', value: 80 }, { agg: 'percent_yes', module: 'D1', value: 100 },
    { agg: 'percent_yes', module: 'D2', value: 50 },
  ]), 70);
});

test('chiffres clés et modules complémentaires (scored = faux) hors de l\'indice', () => {
  assert.equal(overallIndex([
    { agg: 'percent_yes', module: 'D1', value: 80 },
    { agg: 'percent_yes', module: 'KPI', value: 10, scored: false },
  ]), 80);
  const [r] = computeAll([{ code: 'k', sourceField: 'q', agg: 'percent_yes', scored: false }], [{ data: { q: 'oui' } }]);
  assert.equal(r.scored, false);
});

test('variable du XLSForm (« field_office ») trouvée dans un export qui l\'écrit autrement (« Field_office ») ; le nom exact passe d\'abord', () => {
  const subs2 = [{ data: { Field_office: '6' } }, { data: { Field_office: '7' } }, { data: { field_office: '6', Field_office: '9' } }];
  const [r] = computeAll([{ code: 'a', sourceField: 'field_office', agg: 'percent_value', positiveValue: '6' }], subs2);
  assert.equal(r.base, 3);
  assert.equal(r.value, 66.7); // ligne 3 : « field_office » exact = 6, pas 9
});
