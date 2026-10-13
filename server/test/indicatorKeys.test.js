const test = require('node:test');
const assert = require('node:assert/strict');
const { indicatorKeys, calcReferences, unusedKeys, dataWithout } = require('../src/modules/monitoring/indicatorKeys');
const { computeAll } = require('../src/modules/monitoring/monitoringMath');
const { computeCalcFields } = require('../src/modules/monitoring/calcFields');

// Projection SQL (`data - clés inutiles connues`) rejouée en JS, puis champs calculés comme withCalc.
const project = (subs, drop) => subs.map((s) => ({ data: Object.fromEntries(Object.entries(s.data).filter(([k]) => !drop.includes(k))) }));
const withCalc = (subs, defs) => subs.map((s) => ({ data: { ...s.data, ...computeCalcFields(defs, s.data) } }));
const allKeys = (subs) => [...new Set(subs.flatMap((s) => Object.keys(s.data)))];
const same = (inds, subs, defs = []) => {
  const keys = indicatorKeys(inds, defs);
  const full = computeAll(inds, withCalc(subs, defs));
  // Univers complet (toutes les clés connues), puis partiel (échantillon qui n'a pas tout vu) :
  // résultats identiques dans les deux cas — une clé inconnue reste, une clé utile n'est jamais retirée.
  for (const universe of [allKeys(subs), allKeys(subs.slice(0, 1))]) {
    const drop = unusedKeys(universe, keys);
    assert.ok(drop.every((k) => !keys.includes(k.toLowerCase())));
    assert.deepEqual(computeAll(inds, withCalc(project(subs, drop), defs)), full);
  }
  return keys;
};

const SUBS = [
  { data: { Q1: 'Oui', q2: '3', 'Multi.1': '1', 'Multi.2': '0', commentaire: 'long texte '.repeat(50), q3: 'NA', score: '7' } },
  { data: { q1: 'Non', Q2: '9999', 'multi.1': '0', 'Multi.2': '1', commentaire: 'x', q3: 'Oui', score: '2' } },
  { data: { q1: '', q2: '5', 'Multi.1': '1', autre: 'y', score: '' } },
  { data: { autre: 'z' } },
];
const IND = (k, extra = {}) => ({ id: k, code: k, label: k, sourceField: k, agg: 'percent_yes', positiveValue: null, naValues: [], ...extra });

test('projection : résultats profondément égaux au calcul complet (casse, NA, options X.1)', () => {
  const inds = [
    IND('q1'), IND('Q2', { agg: 'mean', naValues: ['9999'] }), IND('Multi.1', { positiveValue: '1' }),
    IND('multi.2', { agg: 'percent_value', positiveValue: '1' }), IND('q3', { naValues: ['NA'] }), IND('absente'),
    IND('score', { agg: 'sum' }), IND('q2', { agg: 'count' }),
  ];
  const keys = same(inds, SUBS);
  assert.deepEqual(keys, ['absente', 'multi.1', 'multi.2', 'q1', 'q2', 'q3', 'score']);
  assert.ok(!keys.includes('commentaire'), 'les réponses inutiles ne sont jamais lues');
});

test('projection : champs calculés (imbriqués) — leurs variables sont lues', () => {
  const defs = [
    { name: 'ok', kind: 'expression', expression: 'IF(q1 = "Oui" AND score > 5, "Oui", "Non")' },
    { name: 'ok2', kind: 'expression', expression: 'IF(ok = "Oui" OR q3 = "Oui", "Oui", "Non")' },
    { name: 'rec', kind: 'recode', sourceField: 'Q2', mapping: { 3: 'Oui', 5: 'Non' } },
  ];
  const inds = [IND('ok2'), IND('rec'), IND('q1')];
  const keys = same(inds, SUBS, defs);
  for (const k of ['q1', 'score', 'q3', 'q2', 'ok', 'ok2', 'rec']) assert.ok(keys.includes(k), k);
  assert.deepEqual([...calcReferences(defs)].sort(), ['ok', 'q1', 'q2', 'q3', 'score']);
  // Sans indicateur sur un champ calculé : seules les sources directes.
  assert.deepEqual(indicatorKeys([IND('q1')], defs), ['q1']);
});

test('aucun indicateur, sources vides ignorées ; clés retirées et fragment SQL', () => {
  assert.deepEqual(indicatorKeys([], []), []);
  assert.deepEqual(indicatorKeys([IND(''), { sourceField: null }], []), []);
  // Une clé utile n'est jamais retirée, quelle que soit sa casse ; doublons et null écartés.
  assert.deepEqual(unusedKeys(['Q1', 'q1', 'commentaire', 'X', null, 'X'], ['q1']), ['X', 'commentaire']);
  assert.deepEqual(unusedKeys([], ['q1']), []);
  assert.equal(dataWithout('s', '$3'), '(s.data - $3::text[])');
});
