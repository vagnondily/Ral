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

// ---- Période = plage de mois (lot 1b) ------------------------------------------
const P = require('../src/modules/common/period');

test('parsePeriod : ?month hérité, from/to, AAAA-MM-JJ tronqué au mois', () => {
  assert.deepEqual(P.parsePeriod({ month: '2026-07' }), { ok: true, period: { from: '2026-07', to: '2026-07' } });
  assert.deepEqual(P.parsePeriod({ from: '2026-01', to: '2026-06' }), { ok: true, period: { from: '2026-01', to: '2026-06' } });
  assert.deepEqual(P.parsePeriod({ month: '2026-07-15' }).period, { from: '2026-07', to: '2026-07' });
  assert.deepEqual(P.parsePeriod({ from: '2026-01-01', to: '2026-06-30' }).period, { from: '2026-01', to: '2026-06' });
  assert.deepEqual(P.parsePeriod({ month: ' 2026-07 ' }).period, { from: '2026-07', to: '2026-07' });
  // Autres paramètres de la requête ignorés.
  assert.deepEqual(P.parsePeriod({ month: '2026-07', limit: '50' }).period, { from: '2026-07', to: '2026-07' });
});

test('parsePeriod : valeurs vides ou null → null (ou period_required)', () => {
  assert.deepEqual(P.parsePeriod({}), { ok: true, period: null });
  assert.deepEqual(P.parsePeriod(undefined), { ok: true, period: null });
  assert.deepEqual(P.parsePeriod({ month: '', from: '', to: '  ' }), { ok: true, period: null });
  // Un champ JSON envoyé à null vaut absent (l'aperçu acceptait month: null).
  assert.deepEqual(P.parsePeriod({ month: null, from: null, to: null }), { ok: true, period: null });
  assert.deepEqual(P.parsePeriod({ month: null, from: '2026-01', to: '2026-02' }).period, { from: '2026-01', to: '2026-02' });
  const r = P.parsePeriod({}, { required: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'period_required'); assert.equal(r.message, 'Période requise.');
});

test('parsePeriod : erreurs codées, dans l\'ordre de la règle', () => {
  const code = (q, o) => P.parsePeriod(q, o).code;
  assert.equal(code({ month: ['2026-01', '2026-02'] }), 'period_format');
  assert.equal(code({ month: 5 }), 'period_format');
  assert.equal(code({ month: '2026-07', from: '2026-01' }), 'period_ambiguous');
  assert.equal(code({ month: '2026-07', from: '2026-01', to: '2026-02' }), 'period_ambiguous');
  assert.equal(code({ from: '2026-01' }), 'period_partial');
  assert.equal(code({ to: '2026-01' }), 'period_partial');
  assert.equal(code({ month: 'abc' }), 'period_format');
  assert.equal(code({ month: '2026-13' }), 'period_format');
  assert.equal(code({ month: '2026-1' }), 'period_format');
  assert.equal(code({ month: '2026-07-32' }), 'period_format');
  assert.equal(code({ month: '1999-12' }), 'period_year');
  assert.equal(code({ from: '2026-01', to: '2101-01' }), 'period_year');
  assert.equal(code({ from: '2100-12', to: '2100-12' }), undefined);
  assert.equal(code({ from: '2026-06', to: '2026-01' }), 'period_order');
  // Format avant année : un « to » mal formé l'emporte sur un « from » hors limites.
  assert.equal(code({ from: '1999-01', to: 'x' }), 'period_format');
  const f = P.parsePeriod({ from: '2026-01', to: 'juin' });
  assert.equal(f.details.field, 'to');
  assert.equal(f.message, 'Période invalide : mois attendu au format AAAA-MM (ex. 2026-01).');
  assert.equal(P.parsePeriod({ from: '2026-06', to: '2026-01' }).message, 'Période invalide : le début (2026-06) est après la fin (2026-01).');
  assert.equal(P.parsePeriod({ month: '2026-07', to: '2026-08' }).message, 'Période ambiguë : utilisez soit month, soit from et to.');
  assert.equal(P.parsePeriod({ from: '2026-07' }).message, 'Période incomplète : précisez le début (from) et la fin (to).');
  assert.equal(P.parsePeriod({ month: '1999-01' }).message, 'Période hors limites : années 2000 à 2100.');
});

test('parsePeriod : durée — 60 mois passent, 61 échouent ; plafond propre à un endpoint', () => {
  assert.equal(P.parsePeriod({ from: '2021-01', to: '2025-12' }).ok, true); // 60 mois
  const r = P.parsePeriod({ from: '2021-01', to: '2026-01' }); // 61 mois
  assert.equal(r.code, 'period_span');
  assert.equal(r.message, 'Période trop longue : 60 mois au plus (demandé : 61).');
  assert.deepEqual(r.details, { maxSpan: 60, span: 61 });
  assert.equal(P.parsePeriod({ from: '2026-01', to: '2026-12' }, { maxSpan: 12 }).ok, true);
  assert.equal(P.parsePeriod({ from: '2025-12', to: '2026-12' }, { maxSpan: 12 }).code, 'period_span');
});

test('periodBounds : intervalle semi-ouvert (décembre → 1er janvier suivant)', () => {
  assert.deepEqual(P.periodBounds({ from: '2026-01', to: '2026-06' }), { lo: '2026-01-01', hiExcl: '2026-07-01', hi: '2026-06-01' });
  assert.deepEqual(P.periodBounds({ from: '2026-12', to: '2026-12' }), { lo: '2026-12-01', hiExcl: '2027-01-01', hi: '2026-12-01' });
});

test('monthsOf, spanMonths, monthIndex, single', () => {
  assert.deepEqual(P.monthsOf({ from: '2025-11', to: '2026-02' }), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(P.monthsOf(P.single('2026-07')), ['2026-07']);
  assert.deepEqual(P.monthsOf(null), []);
  assert.equal(P.spanMonths({ from: '2026-01', to: '2026-06' }), 6);
  assert.equal(P.spanMonths({ from: '2025-11', to: '2026-10' }), 12);
  assert.equal(P.monthIndex('2026-01') - P.monthIndex('2025-12'), 1);
  assert.equal(P.monthsOf({ from: '2021-01', to: '2025-12' }).length, 60);
  assert.throws(() => P.monthsOf({ from: '2021-01', to: '2026-01' }), /trop longue/);
});

test('trendWindow : 12 mois finissant à `to`, étendue vers le passé pour une plage plus longue', () => {
  assert.deepEqual(P.trendWindow({ from: '2026-07', to: '2026-07' }, '2026-10'), { from: '2025-08', to: '2026-07' });
  assert.deepEqual(P.trendWindow({ from: '2025-01', to: '2026-06' }, '2026-10'), { from: '2025-01', to: '2026-06' }); // 18 mois
  assert.deepEqual(P.trendWindow(null, '2026-10'), { from: '2025-11', to: '2026-10' });
});

test('overlaps : chevauchement d\'un intervalle (facture pluri-mensuelle) avec la période', () => {
  const p = { from: '2026-02', to: '2026-06' };
  assert.equal(P.overlaps(p, '2026-01-01', '2026-03-01'), true);
  assert.equal(P.overlaps(p, '2026-01-01', null), false);
  assert.equal(P.overlaps(p, '2026-06', null), true);
  assert.equal(P.overlaps(p, '2026-07-01', '2026-09-01'), false);
  assert.equal(P.overlaps(null, '2020-01-01'), true);
});

test('toPeriod : appels internes { month } | { from, to } | null', () => {
  assert.deepEqual(P.toPeriod({ month: '2026-07-01' }), { from: '2026-07', to: '2026-07' });
  assert.deepEqual(P.toPeriod({ from: '2026-01', to: '2026-06', bureau: 'X' }), { from: '2026-01', to: '2026-06' });
  assert.equal(P.toPeriod(null), null);
  assert.equal(P.toPeriod({}), null);
  assert.throws(() => P.toPeriod({ from: '2026-01' }), /partielle/);
  assert.deepEqual(P.periodInfo({ from: '2026-01', to: '2026-06' }), { from: '2026-01', to: '2026-06', months: 6 });
  assert.equal(P.periodInfo(null), null);
});

test('periodLabel : formes longue et courte, français et anglais', () => {
  const L = P.periodLabel;
  assert.equal(L({ from: '2026-07', to: '2026-07' }), 'Juillet 2026');
  assert.equal(L({ from: '2026-01', to: '2026-06' }), 'Janvier à juin 2026');
  assert.equal(L({ from: '2026-01', to: '2026-12' }), 'Année 2026');
  assert.equal(L({ from: '2025-10', to: '2026-03' }), 'Octobre 2025 à mars 2026');
  assert.equal(L({ from: '2026-01', to: '2026-06' }, 'en'), 'January to June 2026');
  assert.equal(L({ from: '2025-10', to: '2026-03' }, 'en'), 'October 2025 to March 2026');
  assert.equal(L({ from: '2026-01', to: '2026-06' }, 'fr', { short: true }), 'Janv. – juin 2026');
  assert.equal(L({ from: '2025-11', to: '2026-10' }, 'fr', { short: true }), 'Nov. 2025 – oct. 2026');
  assert.equal(L({ from: '2026-07', to: '2026-07' }, 'fr', { short: true }), 'Juil. 2026');
  assert.equal(L({ from: '2026-01', to: '2026-12' }, 'fr', { short: true }), 'Année 2026');
  assert.equal(L({ from: '2026-01', to: '2026-06' }, 'en', { short: true }), 'Jan – Jun 2026');
  assert.equal(L({ from: '2025-11', to: '2026-10' }, 'en', { short: true }), 'Nov 2025 – Oct 2026');
});

test('periodSchema / periodQuerySchema : issues codées (zod)', () => {
  assert.equal(P.periodSchema.safeParse({ from: '2026-01', to: '2026-06' }).success, true);
  const bad = P.periodSchema.safeParse({ from: '2021-01', to: '2026-01' });
  assert.equal(bad.success, false);
  assert.equal(bad.error.issues[0].params.code, 'period_span');
  const q = P.periodQuerySchema.safeParse({ from: '2026-06', to: '2026-01', limit: '5' });
  assert.equal(q.success, false);
  assert.equal(q.error.issues[0].params.code, 'period_order');
  assert.equal(P.periodQuerySchema.safeParse({ month: '2026-07', limit: '5' }).success, true);
});

test('readPeriod (bord HTTP) : 400 avec details.code, null sans paramètre', () => {
  const { readPeriod } = require('../src/middleware/period');
  assert.equal(readPeriod({}), null);
  assert.deepEqual(readPeriod({ month: '2026-07' }), { from: '2026-07', to: '2026-07' });
  try { readPeriod({ from: '2026-06', to: '2026-01' }); assert.fail('attendu : 400'); } catch (err) {
    assert.equal(err.statusCode, 400);
    assert.equal(err.details.code, 'period_order');
    assert.equal(err.details.from, '2026-06');
  }
  assert.throws(() => readPeriod({}, { required: true }), (e) => e.statusCode === 400 && e.details.code === 'period_required');
});
