const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSiteDeletion, SAMPLE_MAX } = require('../src/modules/settings/siteDeletion');

test('sites sans donnée → supprimables ; sites porteurs → gardés, comptés par raison', () => {
  const found = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
  const linked = new Map([
    ['b', { visits: 3, submissions: 1, activation: 0, assignments: 1 }],
    ['c', { visits: 0, submissions: 0, activation: 2, assignments: 0 }],
    ['d', { visits: 0, submissions: 0, activation: 0, assignments: 0 }], // aucun compte > 0 : supprimable
  ]);
  const s = summarizeSiteDeletion(found, linked);
  assert.equal(s.total, 4);
  assert.deepEqual(s.deletable, ['a', 'd']);
  assert.deepEqual(s.kept, ['b', 'c']);
  assert.deepEqual(s.byReason, { visits: 1, submissions: 1, activation: 1, assignments: 1 });
  assert.deepEqual(s.sample.map((x) => x.name), ['B', 'C']);
  assert.deepEqual(s.sample[0].counts, { visits: 3, submissions: 1, activation: 0, assignments: 1 });
});

test('échantillon borné, comptes complets', () => {
  const found = Array.from({ length: SAMPLE_MAX + 25 }, (_, i) => ({ id: `s${i}`, name: `S${i}` }));
  const linked = new Map(found.map((s) => [s.id, { visits: 1 }]));
  const s = summarizeSiteDeletion(found, linked);
  assert.equal(s.kept.length, SAMPLE_MAX + 25);
  assert.equal(s.sample.length, SAMPLE_MAX);
  assert.equal(s.byReason.visits, SAMPLE_MAX + 25);
  assert.equal(s.deletable.length, 0);
});

test('entrées vides : défauts sûrs', () => {
  const s = summarizeSiteDeletion();
  assert.equal(s.total, 0);
  assert.deepEqual(s.deletable, []);
});
