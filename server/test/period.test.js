const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultPeriod, addMonths, isMonth } = require('../src/modules/common/period');

const counts = (obj) => Object.entries(obj).map(([month, n]) => ({ month, n }));

test('période par défaut : le mois courant quand il a assez de données', () => {
  const r = defaultPeriod(counts({ '2026-08': 60, '2026-09': 70, '2026-10': 65 }), '2026-10');
  assert.equal(r.month, '2026-10');
  assert.equal(r.reason, 'current');
  assert.equal(r.todayCount, 65);
});

test('mois courant vide (octobre) et dernières données en juillet (74) → juillet, raison « latest »', () => {
  const r = defaultPeriod(counts({ '2026-05': 34, '2026-06': 58, '2026-07': 74 }), '2026-10');
  assert.deepEqual([r.month, r.reason, r.latestMonth, r.n, r.todayCount], ['2026-07', 'latest', '2026-07', 74, 0]);
});

test('mois de queue presque vide (août = 2 après juillet = 73, export GD réel) → juillet, « latest_substantial »', () => {
  const r = defaultPeriod(counts({ '2026-02': 64, '2026-03': 53, '2026-04': 15, '2026-05': 34, '2026-06': 58, '2026-07': 73, '2026-08': 2 }), '2026-10');
  assert.equal(r.month, '2026-07');
  assert.equal(r.reason, 'latest_substantial');
  assert.equal(r.latestMonth, '2026-08');
});

test('Résilience : septembre = 8 contre une médiane de 130 → août', () => {
  const r = defaultPeriod(counts({ '2026-03': 120, '2026-04': 130, '2026-05': 140, '2026-06': 125, '2026-07': 135, '2026-08': 131, '2026-09': 8 }), '2026-10');
  assert.equal(r.month, '2026-08');
  assert.equal(r.reason, 'latest_substantial');
});

test('base de démo : octobre = 12 (mois courant) contre ~70 avant → septembre, avec le volume d\'octobre', () => {
  const r = defaultPeriod(counts({ '2025-12': 27, '2026-01': 6, '2026-02': 64, '2026-03': 53, '2026-04': 15, '2026-05': 34, '2026-06': 58, '2026-07': 137, '2026-08': 79, '2026-09': 77, '2026-10': 12 }), '2026-10');
  assert.deepEqual([r.month, r.reason, r.todayCount, r.latestMonth], ['2026-09', 'latest_substantial', 12, '2026-10']);
});

test('aucune donnée → mois courant, raison « none »', () => {
  assert.deepEqual(defaultPeriod([], '2026-10'), { month: '2026-10', reason: 'none', today: '2026-10', latestMonth: null, n: 0, todayCount: 0 });
  assert.equal(defaultPeriod(counts({ '2026-07': 0 }), '2026-10').reason, 'none');
});

test('mois futurs ignorés (date de tablette aberrante)', () => {
  const r = defaultPeriod(counts({ '2026-07': 74, '2027-03': 400, '2026-11': 5 }), '2026-10');
  assert.equal(r.month, '2026-07');
  assert.equal(r.latestMonth, '2026-07');
});

test('un seul mois de données, même petit : il est retenu (rien pour le comparer)', () => {
  const r = defaultPeriod(counts({ '2026-04': 3 }), '2026-10');
  assert.deepEqual([r.month, r.reason], ['2026-04', 'latest']);
});

test('volumes cumulés par mois (plusieurs fiches) et entrées invalides écartées', () => {
  const r = defaultPeriod([{ month: '2026-09', n: 30 }, { month: '2026-09', n: 40 }, { month: 'x', n: 9 }, { month: '2026-13', n: 9 }, null], '2026-10');
  assert.deepEqual([r.month, r.n], ['2026-09', 70]);
});

test('mois courant invalide → erreur explicite', () => {
  assert.throws(() => defaultPeriod([], '2026-1'), /Mois courant invalide/);
});

test('aides de mois', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(isMonth('2026-07'), true);
  assert.equal(isMonth('2026-00'), false);
});
