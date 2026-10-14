const test = require('node:test');
const assert = require('node:assert/strict');
const { pointInRing, pointInPolygon, signedArea, ringsBbox, inBbox } = require('../src/modules/common/pointInPolygon');

// Carré unité [0,0]-[10,10].
const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

test('pointInRing : dedans / dehors', () => {
  assert.equal(pointInRing([5, 5], square), true);
  assert.equal(pointInRing([15, 5], square), false);
  assert.equal(pointInRing([-1, 5], square), false);
  assert.equal(pointInRing([5, 15], square), false);
});

test('pointInRing : accepte {lng,lat}', () => {
  assert.equal(pointInRing({ lng: 5, lat: 5 }, square), true);
  assert.equal(pointInRing({ lng: 50, lat: 50 }, square), false);
});

test('pointInRing : anneau dégénéré (<3 points) = dehors', () => {
  assert.equal(pointInRing([5, 5], [[0, 0], [1, 1]]), false);
  assert.equal(pointInRing([5, 5], []), false);
});

test('polygone avec trou : dedans l\'anneau, dehors le trou', () => {
  // Extérieur 0..10, trou 4..6.
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6]];
  const rings = [square, hole];
  assert.equal(pointInPolygon([5, 5], rings), false, 'centre = dans le trou → dehors');
  assert.equal(pointInPolygon([1, 1], rings), true, 'coin = dans l\'anneau, hors trou → dedans');
  assert.equal(pointInPolygon([20, 20], rings), false, 'loin → dehors');
});

test('polygone multi-îles (deux anneaux extérieurs disjoints)', () => {
  const islandA = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const islandB = [[10, 10], [12, 10], [12, 12], [10, 12]];
  const rings = [islandA, islandB];
  assert.equal(pointInPolygon([1, 1], rings), true);
  assert.equal(pointInPolygon([11, 11], rings), true);
  assert.equal(pointInPolygon([5, 5], rings), false, 'entre les deux îles → dehors');
});

test('sens de parcours indifférent (règle pair/impair)', () => {
  const cw = [[0, 0], [0, 10], [10, 10], [10, 0]];   // horaire
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]];  // anti-horaire
  assert.equal(pointInPolygon([5, 5], [cw]), true);
  assert.equal(pointInPolygon([5, 5], [ccw]), true);
});

test('signedArea : signe selon le sens', () => {
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(signedArea(ccw) > 0, 'anti-horaire > 0');
  assert.ok(signedArea([...ccw].reverse()) < 0, 'horaire < 0');
  assert.equal(signedArea([[0, 0]]), 0);
});

test('ringsBbox + inBbox', () => {
  const bbox = ringsBbox([square]);
  assert.deepEqual(bbox, [0, 0, 10, 10]);
  assert.equal(inBbox([5, 5], bbox), true);
  assert.equal(inBbox([5, 5], [0, 0, 4, 4]), false);
  assert.equal(inBbox([5, 5], null), true, 'pas de bbox = pas de filtre');
});

test('realiste : un point de Madagascar (Antananarivo) dans un cadre, pas en dehors', () => {
  // Cadre grossier autour de Tana (lng ~47.5, lat ~-18.9).
  const box = [[47.4, -19.0], [47.6, -19.0], [47.6, -18.8], [47.4, -18.8]];
  assert.equal(pointInRing({ lng: 47.52, lat: -18.88 }, box), true);
  assert.equal(pointInRing({ lng: 48.0, lat: -18.88 }, box), false);
});
