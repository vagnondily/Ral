/**
 * Build des contours (web/scripts/geoBuild.js, module ES pur) — testé ici comme
 * webCharts.test.js : simplification à frontières partagées, sens canonique,
 * pôle d'inaccessibilité, arrondi, sortie déterministe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const file = path.join(__dirname, '../../web/scripts/geoBuild.js');
const load = async (t) => {
  if (!fs.existsSync(file)) { t.skip('web/ absent'); return null; }
  return import(pathToFileURL(file).href);
};

// Deux rectangles voisins dont la frontière commune (x ≈ 1) est une ligne brisée
// finement échantillonnée, plus un troisième contour au-dessus qui touche les deux
// (jonction triple en (1, 1)).
function squares() {
  const border = Array.from({ length: 41 }, (_, i) => {
    const y = i / 40;
    return [i === 0 || i === 40 ? 1 : 1 + 0.003 * Math.sin(i * 1.7), y];
  });
  const left = [[0, 0], ...border, [0, 1], [0, 0]];
  const right = [[1, 0], [2, 0], [2, 1], ...border.slice().reverse().slice(0, -1), [1, 0]];
  const top = [[0, 1], [1, 1], [2, 1], [2, 2], [0, 2], [0, 1]];
  const f = (name, ring) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [ring] } });
  return { type: 'FeatureCollection', features: [f('Gauche', left), f('Droite', right), f('Haut', top)] };
}
const edgeSet = (ring, keep) => {
  const s = [];
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1].join(','); const b = ring[i].join(',');
    if (keep(ring[i - 1]) && keep(ring[i])) s.push(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return s.sort();
};

test('normKey : accents, apostrophes, tirets, casse', async (t) => {
  const m = await load(t); if (!m) return;
  assert.equal(m.normKey("Anosibe-An'ala"), 'anosibe anala');
  assert.equal(m.normKey('  Ambovombe-Androy '), 'ambovombe androy');
  assert.equal(m.normKey('Toliary-II'), 'toliary ii');
  assert.equal(m.normKey('Fénérive Est'), 'fenerive est');
  assert.equal(m.normKey(null), '');
});

test('frontière partagée : identique chez les deux voisins après simplification ; jonction triple fixe', async (t) => {
  const m = await load(t); if (!m) return;
  const src = squares();
  const { web } = m.buildShapes(src, { tol: 0.01 });
  const [g, d, h] = web.features.map((f) => f.geometry.coordinates[0]);
  const onBorder = ([x, y]) => Math.abs(x - 1) < 0.01 && y >= 0 && y <= 1;
  const eg = edgeSet(g, onBorder);
  assert.ok(eg.length >= 1);
  assert.deepEqual(eg, edgeSet(d, onBorder));
  for (const r of [g, d, h]) assert.ok(r.some(([x, y]) => x === 1 && y === 1), 'jonction (1,1) conservée');
  assert.ok(g.length < src.features[0].geometry.coordinates[0].length, 'simplifié');
  assert.equal(m.brokenSharedVertices(src.features, web.features), 0);
});

test('Douglas-Peucker canonique : même résultat quel que soit le sens de l\'arc', async (t) => {
  const m = await load(t); if (!m) return;
  const arc = Array.from({ length: 30 }, (_, i) => [i / 10, Math.sin(i / 3) * 0.05]);
  const a = m.canonicalSimplify(arc, 0.02);
  const b = m.canonicalSimplify(arc.slice().reverse(), 0.02).reverse();
  assert.deepEqual(a, b);
  assert.ok(a.length < arc.length);
});

test('pôle d\'inaccessibilité : à l\'intérieur d\'un U concave (le centre de la bbox est dehors)', async (t) => {
  const m = await load(t); if (!m) return;
  const U = [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]];
  assert.equal(m.inPolygon(1.5, 1.5, U), false);
  const [x, y] = m.poleOfInaccessibility(U);
  assert.ok(m.inPolygon(x, y, U), `(${x}, ${y}) dans le U`);
});

test('arrondi à 4 décimales, sans doublons consécutifs ; sortie déterministe', async (t) => {
  const m = await load(t); if (!m) return;
  assert.deepEqual(m.cleanRing([[1.00004, 2.00006], [1.00001, 2.00009], [3, 4], [5, 4]]), [[1, 2.0001], [3, 4], [5, 4], [1, 2.0001]]);
  assert.equal(Object.is(m.roundTo(-0.00001), -0), false);
  assert.equal(JSON.stringify(m.buildShapes(squares()).web), JSON.stringify(m.buildShapes(squares()).web));
  const { web, index } = m.buildShapes(squares(), { shapeSet: 'test.v1', source: 'essai' });
  assert.equal(web.shapeSet, 'test.v1');
  assert.equal(web.source, 'essai');
  assert.deepEqual(index.shapes.map((s) => s.key), ['gauche', 'droite', 'haut']);
  for (const f of web.features) for (const [x, y] of f.geometry.coordinates[0]) {
    assert.equal(x, m.roundTo(x)); assert.equal(y, m.roundTo(y));
  }
});
