const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFeatures, locate, locateRef, locateAll } = require('../src/modules/common/gpsLocate');

// Deux communes carrées adjacentes + une avec un trou.
const commA = { type: 'polygon', rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };          // A
const commB = { type: 'polygon', rings: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]] };        // B
const commC = { type: 'polygon', rings: [                                                           // C avec trou
  [[0, 20], [10, 20], [10, 30], [0, 30], [0, 20]],
  [[4, 24], [6, 24], [6, 26], [4, 26], [4, 24]],
] };
const point = { type: 'point', point: { lng: 1, lat: 1 } }; // ignoré (pas un polygone)

const geoms = [commA, commB, point, commC];
const pcodes = ['MG-A', 'MG-B', null, 'MG-C'];

test('buildFeatures : ne garde que les polygones, calcule la bbox, porte la ref', () => {
  const feats = buildFeatures(geoms, pcodes);
  assert.equal(feats.length, 3); // le point est exclu
  assert.deepEqual(feats[0].ref, 'MG-A');
  assert.deepEqual(feats[0].bbox, [0, 0, 10, 10]);
  assert.deepEqual(feats[2].ref, 'MG-C');
});

test('locate : rattache un point à la bonne commune', () => {
  const feats = buildFeatures(geoms, pcodes);
  assert.equal(locateRef({ lng: 5, lat: 5 }, feats), 'MG-A');
  assert.equal(locateRef({ lng: 15, lat: 5 }, feats), 'MG-B');
  assert.equal(locateRef({ lng: 2, lat: 22 }, feats), 'MG-C');
  // locate renvoie le contour complet (avec sa ref et sa bbox).
  const f = locate({ lng: 5, lat: 5 }, feats);
  assert.equal(f.ref, 'MG-A');
  assert.deepEqual(f.bbox, [0, 0, 10, 10]);
});

test('locate : point hors de tout contour → null', () => {
  const feats = buildFeatures(geoms, pcodes);
  assert.equal(locateRef({ lng: 100, lat: 100 }, feats), null);
});

test('locate : point dans le trou de C → null (pas rattaché)', () => {
  const feats = buildFeatures(geoms, pcodes);
  assert.equal(locateRef({ lng: 5, lat: 25 }, feats), null);
});

test('locateRef : sans refs, renvoie l\'index d\'origine du polygone', () => {
  const feats = buildFeatures(geoms); // pas de refs
  // commA est le 1er polygone → ref = index 0 dans le tableau d'origine
  assert.equal(locateRef({ lng: 5, lat: 5 }, feats), 0);
  assert.equal(locateRef({ lng: 15, lat: 5 }, feats), 1);
});

test('locateAll : renvoie tous les contours contenant le point', () => {
  const feats = buildFeatures(geoms, pcodes);
  assert.equal(locateAll({ lng: 5, lat: 5 }, feats).length, 1);
  assert.equal(locateAll({ lng: 999, lat: 999 }, feats).length, 0);
});

test('bout à bout : .shp → features → rattachement', () => {
  const { readShpGeometries } = require('../src/modules/common/shpGeometry');
  // On réutilise le fabricant du test shpGeometry via un petit polygone.
  const content = (() => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const pts = ring; const b = Buffer.alloc(4 + 32 + 4 + 4 + 4 + 16 * pts.length);
    let o = 0; b.writeInt32LE(5, o); o += 4;
    b.writeDoubleLE(0, o); o += 8; b.writeDoubleLE(0, o); o += 8; b.writeDoubleLE(10, o); o += 8; b.writeDoubleLE(10, o); o += 8;
    b.writeInt32LE(1, o); o += 4; b.writeInt32LE(pts.length, o); o += 4; b.writeInt32LE(0, o); o += 4;
    for (const [x, y] of pts) { b.writeDoubleLE(x, o); o += 8; b.writeDoubleLE(y, o); o += 8; }
    return b;
  })();
  const head = Buffer.alloc(8); head.writeInt32BE(1, 0); head.writeInt32BE(content.length / 2, 4);
  const header = Buffer.alloc(100); header.writeInt32BE(9994, 0); header.writeInt32BE((100 + 8 + content.length) / 2, 24);
  const shp = Buffer.concat([header, head, content]);

  const feats = buildFeatures(readShpGeometries(shp), ['MG-ONLY']);
  assert.equal(locateRef({ lng: 3, lat: 3 }, feats), 'MG-ONLY');
  assert.equal(locateRef({ lng: 30, lat: 3 }, feats), null);
});
