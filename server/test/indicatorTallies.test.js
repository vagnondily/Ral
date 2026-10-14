/**
 * Décomptes additifs des indicateurs (lot 7a, C1) : lus page par page et par
 * groupe (curseur d'indicatorFacts.repository), puis réunis, ils doivent donner
 * EXACTEMENT le calcul d'un seul tenant (computeAll) — valeur, base, classe,
 * présents, hors base, explication — sur 500 jeux tirés avec une graine fixe :
 * percent_yes, percent_value, count, sum, mean ; NA, vides, absents ; variantes de
 * casse, y compris deux variantes dans la même soumission (priorité du nom exact) ;
 * nombres 1.50, 1e15, 1e-5, 1e21, 123456789012345678, -0, 0.1 + 0.2 ; booléens,
 * tableaux ; positiveValue « 1|2 » ; champs calculés ; découpage en pages et en
 * groupes quelconque, ordre de lecture quelconque.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAll, explainIndicator, keyIndex, namesFor, tallyIndicator, mergeTallies } = require('../src/modules/monitoring/monitoringMath');
const { computeCalcFields } = require('../src/modules/monitoring/calcFields');
const { talliesOf, mergeAll, resultsFromTallies, explainOf, readsCalc } = require('../src/modules/monitoring/indicatorTallies');

// Générateur à graine (mulberry32) : jeux reproductibles.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALUES = [
  'Oui', 'Non', 'oui', ' 1 ', '1', '2', '1.50', '9999', 'NA', '', ' ', 'x', '3,5', '-2', '1e+15',
  0, 1, 2, 1.5, 1e15, 1e-5, 1e21, 123456789012345678, -0, 9999, 0.1, 0.2, 7,
  true, false, null, [1, 2], { a: 1 },
];
const NAMES = { q1: ['q1', 'Q1'], q2: ['q2'], q3: ['q3', 'Q3'], q4: ['q4'] };

function dataset(seed) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const n = Math.floor(r() * 70);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const data = {};
    for (const variants of Object.values(NAMES)) {
      if (r() < 0.2) continue; // variable absente de cette soumission
      data[pick(variants)] = pick(VALUES);
      // Parfois deux variantes de casse dans la MÊME soumission.
      if (variants.length > 1 && r() < 0.1) data[variants[1]] = pick(VALUES);
    }
    // Comme PostgreSQL : le jsonb est relu depuis son texte (-0 → 0).
    rows.push({ data: JSON.parse(JSON.stringify(data)), g: pick(['A', 'B', 'C']) });
  }
  const inds = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, k) => ({
    id: `i${k}`, code: `I${k}`, label: `Indicateur ${k}`, module: pick(['D1', 'D2', null]),
    sourceField: pick(['q1', 'Q1', 'q2', 'q3', 'Q3', 'q4', 'absente', 'calc_ok', 'CALC_OK', '']),
    agg: pick(['percent_yes', 'percent_value', 'count', 'sum', 'mean']),
    positiveValue: pick([null, '1', '1|2', 'oui', '']), naValues: pick([[], ['9999'], ['NA', '9999'], [' na ']]),
    target: pick([null, 50, 80, 3]), direction: pick(['higher_better', 'lower_better']), scored: r() > 0.1,
  }));
  const defs = r() < 0.5 ? [{ name: 'calc_ok', kind: 'expression', expression: 'IF(q1 = "Oui", "Oui", "Non")' }] : [];
  const pageSize = 1 + Math.floor(r() * 12);
  return { rows, inds, defs, pageSize, shuffle: r() };
}

/** Lecture « en flux » simulée : pages de `pageSize` lignes, décomptes par groupe, réunis. */
function streamed({ rows, inds, defs, pageSize }) {
  const groups = new Map();
  for (let i = 0; i < rows.length; i += pageSize) {
    const byGroup = new Map();
    for (const r of rows.slice(i, i + pageSize)) { if (!byGroup.has(r.g)) byGroup.set(r.g, []); byGroup.get(r.g).push(r); }
    for (const [g, list] of byGroup) groups.set(g, mergeAll([groups.get(g), talliesOf(inds, list, defs)], inds.length));
  }
  return { groups, overall: mergeAll([...groups.values()], inds.length) };
}

const withCalc = (rows, defs) => rows.map((r) => ({ ...r, data: defs.length ? { ...r.data, ...computeCalcFields(defs, r.data) } : r.data }));

test('propriété : décomptes par pages et par groupes réunis = calcul d\'un seul tenant (500 jeux)', () => {
  let compared = 0;
  for (let seed = 1; seed <= 500; seed += 1) {
    const ds = dataset(seed);
    const all = withCalc(ds.rows, ds.defs);
    const ref = computeAll(ds.inds, all);
    const s = streamed(ds);
    assert.deepStrictEqual(resultsFromTallies(ds.inds, s.overall), ref, `jeu ${seed} : global`);
    for (const g of ['A', 'B', 'C']) {
      const part = all.filter((r) => r.g === g);
      assert.deepStrictEqual(resultsFromTallies(ds.inds, s.groups.get(g) || mergeAll([], ds.inds.length)), computeAll(ds.inds, part), `jeu ${seed} : groupe ${g}`);
    }
    // Ordre de lecture quelconque : même résultat (somme et explication à ordre fixe).
    const reversed = streamed({ ...ds, rows: [...ds.rows].reverse() });
    assert.deepStrictEqual(resultsFromTallies(ds.inds, reversed.overall), ref, `jeu ${seed} : ordre inverse`);
    const idx = keyIndex(all);
    ds.inds.forEach((ind, i) => {
      const expected = explainIndicator(ind, all, namesFor(ind.sourceField, idx), { top: 5 });
      assert.deepStrictEqual(explainOf(ind, s.overall[i], { top: 5 }), expected, `jeu ${seed} : explication ${ind.code}`);
      assert.deepStrictEqual(explainOf(ind, reversed.overall[i], { top: 5 }), expected, `jeu ${seed} : explication (ordre inverse) ${ind.code}`);
    });
    compared += ds.inds.length;
  }
  assert.ok(compared > 1500);
});

// Boucle de décompte AVANT le lot 7a (copie figée) : garde-fou contre tout changement de règle
// introduit par l'optimisation de tallyIndicator (seul l'ordre de la somme flottante diffère).
const { toNumber, isYes } = require('../src/modules/monitoring/monitoringMath');
function referenceTally(indicator, submissions, names) {
  const na = new Set((indicator.naValues || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  const pct = !['count', 'sum', 'mean'].includes(indicator.agg);
  const numericAgg = indicator.agg === 'sum' || indicator.agg === 'mean';
  const valueKey = (v) => { const x = String(v); return x.trim() === '' ? x : x.trim(); };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const t = { total: 0, absent: 0, blank: 0, naExcluded: new Map(), values: new Map(), answered: 0, positives: 0, numeric: 0, sum: 0 };
  for (const s of submissions) {
    t.total += 1;
    const d = s.data || {};
    const field = names.find((n) => Object.prototype.hasOwnProperty.call(d, n));
    if (field === undefined) { t.absent += 1; continue; }
    const v = d[field];
    if (v == null || v === '') { t.blank += 1; continue; }
    if (na.has(String(v).trim().toLowerCase())) { bump(t.naExcluded, valueKey(v)); continue; }
    t.answered += 1;
    bump(t.values, valueKey(v));
    if (pct) { if (isYes(v, indicator.positiveValue) === 1) t.positives += 1; } else if (numericAgg) {
      const n = toNumber(v);
      if (n != null) { t.numeric += 1; t.sum += n; }
    }
  }
  return t;
}

test('règle inchangée : le décompte optimisé = la boucle d\'avant le lot 7a (500 jeux)', () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const ds = dataset(seed);
    const all = withCalc(ds.rows, ds.defs);
    const idx = keyIndex(all);
    for (const ind of ds.inds) {
      const names = namesFor(ind.sourceField, idx);
      const a = tallyIndicator(ind, all, names);
      const b = referenceTally(ind, all, names);
      for (const k of ['total', 'absent', 'blank', 'answered', 'positives', 'numeric']) assert.equal(a[k], b[k], `jeu ${seed} ${ind.code} ${k}`);
      assert.deepStrictEqual([...a.naExcluded].sort(), [...b.naExcluded].sort(), `jeu ${seed} ${ind.code} hors base`);
      assert.deepStrictEqual([...a.values].sort(), [...b.values].sort(), `jeu ${seed} ${ind.code} valeurs`);
      const tol = 1e-9 * Math.max(1, Math.abs(b.sum));
      assert.ok(Math.abs(a.sum - b.sum) <= tol || Object.is(a.sum, b.sum), `jeu ${seed} ${ind.code} somme ${a.sum} ≠ ${b.sum}`);
    }
  }
});

test('somme : indépendante de l\'ordre et du découpage (0,1 + 0,2 + 0,1…)', () => {
  const ind = { sourceField: 'x', agg: 'sum' };
  const rows = [0.1, 0.2, 0.1, 0.1, 1e21, -1e21, 3].map((x) => ({ data: { x } }));
  const one = tallyIndicator(ind, rows);
  const parts = mergeTallies([tallyIndicator(ind, rows.slice(4)), tallyIndicator(ind, rows.slice(0, 2)), tallyIndicator(ind, rows.slice(2, 4))]);
  assert.equal(parts.sum, one.sum);
  assert.equal(tallyIndicator(ind, [...rows].reverse()).sum, one.sum);
  assert.equal(parts.numeric, 7);
});

test('variables à plusieurs noms : nom exact d\'abord, sur chaque page comme sur le tout', () => {
  const rows = [{ data: { Q1: 'Non', q1: 'Oui' } }, { data: { q1: 'Oui' } }, { data: { Q1: 'Oui' } }];
  const inds = [{ id: 'a', sourceField: 'q1', agg: 'percent_yes' }, { id: 'b', sourceField: 'Q1', agg: 'percent_yes' }];
  const pages = mergeAll(rows.map((r) => talliesOf(inds, [r])), 2);
  const [a, b] = resultsFromTallies(inds, pages);
  assert.equal(a.value, 100); // « q1 » d'abord : Oui, Oui, Oui
  assert.equal(b.value, 66.7); // « Q1 » d'abord : Non, Oui, Oui
  assert.deepStrictEqual([a, b], computeAll(inds, rows));
});

test('champs calculés évalués seulement si un indicateur en lit un ; aucune soumission = non évalué', () => {
  const defs = [{ name: 'Calc', kind: 'expression', expression: '1' }];
  assert.equal(readsCalc([{ sourceField: 'calc' }], defs), true);
  assert.equal(readsCalc([{ sourceField: 'q1' }], defs), false);
  const ind = { id: 'a', sourceField: 'q1', agg: 'mean' };
  assert.deepStrictEqual(resultsFromTallies([ind], mergeAll([], 1)), computeAll([ind], []));
});
