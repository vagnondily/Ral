const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIndicator, computeAll, classify, naReason } = require('../src/modules/monitoring/monitoringMath');
const { naReasonCounts, classDistribution } = require('../src/modules/monitoring/coverageDashboard');

// « Non évalué » expliqué (retour n° 16) : classify décide, naReason dit pourquoi.
const subs = (rows) => rows.map((data) => ({ data }));

test('computeIndicator compte les soumissions qui portent la variable et les codes « hors base », sans changer la valeur', () => {
  const r = computeIndicator({ sourceField: 'q', agg: 'percent_yes', naValues: ['9999'] }, subs([{ q: 'oui' }, { q: '9999' }, { other: 1 }, { q: 'non' }]));
  assert.equal(r.value, 50);
  assert.equal(r.base, 2);
  assert.equal(r.present, 3);
  assert.equal(r.naCount, 1);
});

test('aucune soumission sur la période → « no_data »', () => {
  const [r] = computeAll([{ code: 'a', sourceField: 'q', agg: 'percent_yes' }], []);
  assert.equal(classify(r), 'na');
  assert.equal(naReason(r, { periodCount: 0 }), 'no_data');
});

test('variable absente des soumissions de la période (question d\'une autre version du formulaire) → « variable_absent »', () => {
  // Cas réel GD : les 5 indicateurs « Entrepôt / stock » n'existent qu'à partir de mai 2026.
  const [r] = computeAll([{ code: 'GD_WH', sourceField: 'MOStorageCondition', agg: 'percent_yes' }], subs([{ other: 'oui' }, { other: 'non' }]));
  assert.equal(naReason(r, { periodCount: 2 }), 'variable_absent');
});

test('seulement des codes « hors base » (NA) → « only_na » ; présente mais toujours vide → « no_answer »', () => {
  const [na] = computeAll([{ code: 'a', sourceField: 'q', agg: 'percent_yes', naValues: ['888'] }], subs([{ q: '888' }, { q: '888' }]));
  assert.equal(naReason(na, { periodCount: 2 }), 'only_na');
  const [blank] = computeAll([{ code: 'b', sourceField: 'q', agg: 'percent_yes' }], subs([{ q: '' }, { q: null }]));
  assert.equal(naReason(blank, { periodCount: 2 }), 'no_answer');
});

test('moyenne, somme ou nombre sans cible : valeur calculée mais non classée → « no_target »', () => {
  const [m] = computeAll([{ code: 'CFM3', sourceField: 'score', agg: 'mean' }], subs([{ score: 3 }, { score: 5 }]));
  assert.equal(m.value, 4);
  assert.equal(classify(m), 'na');
  assert.equal(naReason(m, { periodCount: 2 }), 'no_target');
  // Avec une cible, la même moyenne est classée : plus de raison.
  const [t] = computeAll([{ code: 'CFM3', sourceField: 'score', agg: 'mean', target: 4 }], subs([{ score: 3 }, { score: 5 }]));
  assert.equal(naReason(t, { periodCount: 2 }), null);
});

test('indicateur classé : aucune raison ; hors indice (scored=false) : « not_scored »', () => {
  const [ok] = computeAll([{ code: 'a', sourceField: 'q', agg: 'percent_yes' }], subs([{ q: 'oui' }]));
  assert.equal(naReason(ok, { periodCount: 1 }), null);
  const [off] = computeAll([{ code: 'k', sourceField: 'q', agg: 'percent_yes', scored: false }], subs([{ q: 'oui' }]));
  assert.equal(naReason(off, { periodCount: 1 }), 'not_scored');
  assert.equal(naReason(null), null);
});

test('naReasonCounts : raisons des « Non évalué » notés — leur somme égale le compte na de classDistribution', () => {
  const inds = [
    { code: 'a', sourceField: 'q', agg: 'percent_yes' },
    { code: 'b', sourceField: 'absente', agg: 'percent_yes' },
    { code: 'c', sourceField: 'n', agg: 'mean' },
    { code: 'd', sourceField: 'absente2', agg: 'percent_yes', scored: false }, // hors indice : hors décompte
  ];
  const results = computeAll(inds, subs([{ q: 'oui', n: 2 }, { q: 'non', n: 4 }]));
  const reasons = naReasonCounts(results, 2);
  assert.deepEqual(reasons, { variable_absent: 1, no_target: 1 });
  assert.equal(Object.values(reasons).reduce((a, b) => a + b, 0), classDistribution(results).na);
  assert.deepEqual(naReasonCounts(computeAll(inds, []), 0), { no_data: 3 });
});
