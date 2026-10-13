const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIndicator, computeAll, rate, overallIndex, classify, classifyDetail, explainIndicator, keyIndex, namesFor } = require('../src/modules/monitoring/monitoringMath');

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

// --- Explication du calcul (retour n° 20) : « Comment c'est calculé » ------------------
// Soumissions de démonstration : 10 avec la variable, 1 sans, 1 vide, 2 hors base, du texte.
const MIXED = [
  { data: { q: '1' } }, { data: { q: '1' } }, { data: { q: '1' } }, { data: { q: ' 2 ' } }, { data: { q: '0' } },
  { data: { q: '9999' } }, { data: { q: '888' } }, { data: { q: '' } }, { data: { q: null } }, { data: { q: 'abc' } },
  { data: { q: '3,5' } }, { data: { other: 'x' } },
];

test('explainIndicator : même valeur et même base que computeIndicator, pour les 5 méthodes', () => {
  const defs = [
    { sourceField: 'q', agg: 'percent_yes', naValues: ['9999', '888'] },
    { sourceField: 'q', agg: 'percent_yes', positiveValue: '1|2', naValues: ['9999'] },
    { sourceField: 'q', agg: 'percent_value', positiveValue: '0', target: 20, direction: 'lower_better' },
    { sourceField: 'q', agg: 'mean', naValues: ['9999', '888'] },
    { sourceField: 'q', agg: 'mean' },
    { sourceField: 'q', agg: 'sum', naValues: ['9999'], target: 5 },
    { sourceField: 'q', agg: 'count', naValues: ['888'] },
    { sourceField: 'absente', agg: 'percent_yes' },
  ];
  for (const d of defs) {
    const c = computeIndicator(d, MIXED);
    const x = explainIndicator(d, MIXED);
    assert.equal(x.value, c.value, `${d.agg} ${d.positiveValue || ''} : valeur`);
    assert.equal(x.base, c.base, `${d.agg} : base`);
    assert.equal(x.classification.rating, c.rating, `${d.agg} : classe`);
    // Toutes les soumissions sont réparties : comptées + hors base + vides + sans la variable.
    assert.equal(x.answered + x.naCount + x.blank + x.absent, x.total, `${d.agg} : répartition`);
  }
});

test('explainIndicator : base, numérateur et dénominateur d\'un %, codes hors base et vides décomptés', () => {
  const labels = new Map([['1', 'Oui'], ['0', 'Non'], ['9999', 'Sans objet']]);
  const x = explainIndicator({ sourceField: 'q', agg: 'percent_yes', positiveValue: '1|2', naValues: ['9999', '888'] }, MIXED, ['q'], { choiceLabels: labels });
  assert.equal(x.total, 12);
  assert.equal(x.absent, 1);   // { other }
  assert.equal(x.blank, 2);    // '' et null
  assert.deepEqual(x.na, [{ value: '9999', label: 'Sans objet', n: 1 }, { value: '888', label: null, n: 1 }]);
  assert.equal(x.naCount, 2);
  assert.equal(x.base, 7);     // 1 1 1 2 0 abc 3,5
  assert.equal(x.numerator, 4); // trois « 1 » et « 2 » (espaces ignorés)
  assert.equal(x.denominator, 7);
  assert.equal(x.value, 57.1);
  assert.deepEqual(x.positiveValues, ['1', '2']);
  const one = x.distribution.find((r) => r.value === '1');
  assert.deepEqual(one, { value: '1', label: 'Oui', n: 3, role: 'positive' });
  assert.equal(x.distribution.find((r) => r.value === '2').role, 'positive');
  assert.equal(x.distribution.find((r) => r.value === 'abc').role, 'negative');
  assert.equal(x.distribution.find((r) => r.value === '0').label, 'Non');
});

test('explainIndicator : moyenne — réponses non numériques ignorées, somme ÷ nombre', () => {
  const x = explainIndicator({ sourceField: 'q', agg: 'mean', naValues: ['9999', '888'] }, MIXED);
  assert.equal(x.ignored, 1);          // « abc »
  assert.equal(x.denominator, 6);      // 1 1 1 2 0 3,5
  assert.equal(x.numerator, 8.5);
  assert.equal(x.value, 1.4);
  assert.equal(x.distribution.find((r) => r.value === 'abc').role, 'ignored');
  assert.deepEqual(x.classification, { rating: 'na', basis: 'none', reason: 'no_target' });
});

test('explainIndicator : répartition limitée aux valeurs les plus fréquentes, le reste agrégé', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ data: { v: String(i % 15) } }));
  const x = explainIndicator({ sourceField: 'v', agg: 'percent_value', positiveValue: '14' }, rows, ['v'], { top: 5 });
  assert.equal(x.distribution.length, 5);
  assert.equal(x.distinct, 15);
  assert.equal(x.others.n, 20);
  assert.equal(x.others.positives + x.distribution.filter((r) => r.role === 'positive').reduce((s, r) => s + r.n, 0), x.numerator);
});

test('explainIndicator : même règle de casse que le calcul (namesFor)', () => {
  const rows = [{ data: { MOWHBadCommodIsol: '1' } }, { data: { MOWhBadCommodIsol: '0' } }];
  const names = namesFor('MOWhBadCommodIsol', keyIndex(rows));
  const x = explainIndicator({ sourceField: 'MOWhBadCommodIsol', agg: 'percent_yes' }, rows, names);
  assert.equal(x.base, 2);
  assert.equal(x.value, computeAll([{ sourceField: 'MOWhBadCommodIsol', agg: 'percent_yes' }], rows)[0].value);
});

test('classifyDetail : la règle appliquée, et classify = classifyDetail().rating', () => {
  // Sans cible : bandes 80 / 65 / 50 sur le score orienté (GD_WAIT_2H : 29,3 % plus bas = mieux → 70,7 → sat).
  assert.deepEqual(classifyDetail({ value: 29.3, base: 290, agg: 'percent_value', direction: 'lower_better' }),
    { rating: 'sat', basis: 'bands', oriented: 70.7, thresholds: { exc: 80, sat: 65, imp: 50 } });
  assert.equal(classifyDetail({ value: 98.4, base: 322, agg: 'percent_yes' }).rating, 'exc');
  // Avec cible : atteinte, ou écart relatif (≤ 10 % sat, ≤ 30 % imp).
  assert.deepEqual(classifyDetail({ value: 95, base: 10, target: 90, agg: 'percent_yes' }),
    { rating: 'exc', basis: 'target', target: 90, achieved: true, gapPct: 0, thresholds: { sat: 10, imp: 30 } });
  const gap = classifyDetail({ value: 21.2, base: 189, target: 90, agg: 'percent_yes' });
  assert.equal(gap.rating, 'urg');
  assert.equal(gap.gapPct, 76.4);
  assert.equal(classifyDetail({ value: 6, base: 3, target: 5, direction: 'lower_better', agg: 'mean' }).gapPct, 20);
  // Non évalué : aucune donnée, ou moyenne / somme / nombre sans cible.
  assert.deepEqual(classifyDetail({ value: null, base: 0 }), { rating: 'na', basis: 'none', reason: 'no_data' });
  assert.equal(classifyDetail({ value: 3, base: 3, agg: 'count' }).reason, 'no_target');
  for (const r of [{ value: 90, target: 80 }, { value: 75, target: 80 }, { value: 60, target: 80 }, { value: 50, target: 80 }, { value: 70, agg: 'percent_yes' }, { value: 3, agg: 'mean' }, null]) {
    assert.equal(classify(r), classifyDetail(r).rating);
  }
});

test('computeAll transmet la définition complète (valeur comptée, codes hors base, modèle, actif)', () => {
  const [r] = computeAll([{ id: 'i', code: 'c', sourceField: 'q', agg: 'percent_yes', positiveValue: '1', naValues: ['9999'], templateCode: 'GD_X', active: true }], MIXED);
  assert.equal(r.positiveValue, '1');
  assert.deepEqual(r.naValues, ['9999']);
  assert.equal(r.templateCode, 'GD_X');
  assert.equal(r.active, true);
  const [s] = computeAll([{ id: 'j', code: 'd', sourceField: 'q', agg: 'mean' }], MIXED);
  assert.equal(s.positiveValue, null);
  assert.deepEqual(s.naValues, []);
  assert.equal(s.templateCode, null);
});

test('nombre ou somme sans aucune réponse comptée : non évalué, même avec une cible', () => {
  const r = computeIndicator({ sourceField: 'x', agg: 'count', target: 10 }, subs('x', ['', '']));
  assert.equal(r.value, 0);
  assert.equal(r.base, 0);
  assert.equal(r.rating, 'na');
  const [c] = computeAll([{ code: 's', sourceField: 'x', agg: 'sum', target: 5, direction: 'lower_better' }], subs('x', ['']));
  assert.equal(c.rating, 'na');
});
