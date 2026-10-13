const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Axes des graphiques du front (web/src/lib/chartAxis.js, module ES pur) testés
// ici, comme webSafety.test.js : le front n'a pas encore de suite de tests propre.
const webLib = (name) => path.join(__dirname, '../../web/src/lib', name);
const load = async (t, name) => {
  const file = webLib(name);
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

test('tickIndexes : ancrés sur le dernier point, pas régulier, jamais plus que maxTicks', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  const { tickIndexes } = m;
  // 12 mois, place pour 6 étiquettes : 1, 3, 5, 7, 9, 11 — le mois choisi (11) toujours étiqueté.
  assert.deepEqual(tickIndexes(12, 6), [1, 3, 5, 7, 9, 11]);
  // Ancien défaut (i % 2 === 0 || dernier) : 10 et 11 côte à côte = « 26-0926-1 ». Plus jamais.
  for (const [n, max] of [[12, 6], [12, 4], [13, 6], [24, 5], [7, 3], [12, 12], [3, 10]]) {
    const ix = tickIndexes(n, max);
    assert.equal(ix[ix.length - 1], n - 1, `dernier point étiqueté (${n}/${max})`);
    assert.ok(ix.length <= max, `au plus ${max} étiquettes`);
    const gaps = new Set(ix.slice(1).map((v, i) => v - ix[i]));
    assert.ok(gaps.size <= 1, `pas régulier (${n}/${max}) : ${ix}`);
    assert.ok(ix[0] >= 0);
  }
  assert.deepEqual(tickIndexes(12, 4), [2, 5, 8, 11]);
  assert.deepEqual(tickIndexes(1, 6), [0]);
  assert.deepEqual(tickIndexes(0, 6), []);
  assert.deepEqual(tickIndexes(5, 0), [4]); // pas de place : seulement le mois choisi
});

test('tickIndexes + largeur : l\'écart entre deux étiquettes est toujours ≥ la largeur réservée', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  for (const width of [120, 200, 320, 560, 900]) {
    for (const n of [2, 6, 12, 24]) {
      const label = 48;                                    // largeur réservée par étiquette (px)
      const maxTicks = Math.max(1, Math.floor(width / label));
      const ix = m.tickIndexes(n, maxTicks);
      const dx = width / Math.max(1, n - 1);               // px entre deux points
      for (let i = 1; i < ix.length; i += 1) assert.ok((ix[i] - ix[i - 1]) * dx >= label, `${width}px, ${n} points`);
    }
  }
});

test('yScale : maximum « rond » et graduations régulières ; maximum imposé (indice /100)', async (t) => {
  const m = await load(t, 'chartAxis.js'); if (!m) return;
  assert.deepEqual(m.yScale(137), { max: 150, ticks: [0, 50, 100, 150] });
  assert.deepEqual(m.yScale(12), { max: 15, ticks: [0, 5, 10, 15] });
  assert.deepEqual(m.yScale(0), { max: 3, ticks: [0, 1, 2, 3] });
  assert.deepEqual(m.yScale(2), { max: 3, ticks: [0, 1, 2, 3] }); // comptages : pas de graduation 0,5
  assert.deepEqual(m.yScale(64, { fixedMax: 100, intervals: 4 }), { max: 100, ticks: [0, 25, 50, 75, 100] });
  assert.equal(m.niceStep(0.3, { integer: false }), 0.5);
  assert.equal(m.niceStep(45.7), 50);
});
