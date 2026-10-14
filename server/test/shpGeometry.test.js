const test = require('node:test');
const assert = require('node:assert/strict');
const { readShpGeometries } = require('../src/modules/common/shpGeometry');

// --- Fabricant minimal de .shp (pour tester le lecteur sans fichier réel) ---

function polygonContent(rings) {
  const numParts = rings.length;
  const pts = rings.flat();
  const numPoints = pts.length;
  const size = 4 + 32 + 4 + 4 + 4 * numParts + 16 * numPoints;
  const b = Buffer.alloc(size);
  let o = 0;
  b.writeInt32LE(5, o); o += 4; // type polygon
  // bbox
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  b.writeDoubleLE(Math.min(...xs), o); o += 8;
  b.writeDoubleLE(Math.min(...ys), o); o += 8;
  b.writeDoubleLE(Math.max(...xs), o); o += 8;
  b.writeDoubleLE(Math.max(...ys), o); o += 8;
  b.writeInt32LE(numParts, o); o += 4;
  b.writeInt32LE(numPoints, o); o += 4;
  let acc = 0;
  for (const r of rings) { b.writeInt32LE(acc, o); o += 4; acc += r.length; }
  for (const [x, y] of pts) { b.writeDoubleLE(x, o); o += 8; b.writeDoubleLE(y, o); o += 8; }
  return b;
}

function pointContent(lng, lat) {
  const b = Buffer.alloc(4 + 16);
  b.writeInt32LE(1, 0);
  b.writeDoubleLE(lng, 4);
  b.writeDoubleLE(lat, 12);
  return b;
}

function buildShp(contents) {
  const records = contents.map((content, i) => {
    const head = Buffer.alloc(8);
    head.writeInt32BE(i + 1, 0);            // record number (1-based)
    head.writeInt32BE(content.length / 2, 4); // content length en mots de 16 bits
    return Buffer.concat([head, content]);
  });
  const body = Buffer.concat(records);
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE((100 + body.length) / 2, 24);
  header.writeInt32LE(1000, 28);
  return Buffer.concat([header, body]);
}

test('.shp invalide → erreur claire', () => {
  assert.throws(() => readShpGeometries(Buffer.alloc(50)), /\.shp invalide/);
});

test('lit un polygone (anneau unique) avec ses points et sa bbox', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const geoms = readShpGeometries(buildShp([polygonContent([ring])]));
  assert.equal(geoms.length, 1);
  assert.equal(geoms[0].type, 'polygon');
  assert.deepEqual(geoms[0].bbox, [0, 0, 10, 10]);
  assert.equal(geoms[0].rings.length, 1);
  assert.equal(geoms[0].rings[0].length, 5);
  assert.deepEqual(geoms[0].rings[0][1], [10, 0]);
});

test('lit un polygone à trou (deux anneaux)', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]];
  const geoms = readShpGeometries(buildShp([polygonContent([outer, hole])]));
  assert.equal(geoms[0].rings.length, 2);
  assert.equal(geoms[0].rings[1][0][0], 4);
});

test('lit un point', () => {
  const geoms = readShpGeometries(buildShp([pointContent(47.52, -18.88)]));
  assert.equal(geoms[0].type, 'point');
  assert.ok(Math.abs(geoms[0].point.lng - 47.52) < 1e-9);
  assert.ok(Math.abs(geoms[0].point.lat + 18.88) < 1e-9);
});

test('plusieurs enregistrements dans l\'ordre', () => {
  const r1 = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const r2 = [[5, 5], [6, 5], [6, 6], [5, 5]];
  const geoms = readShpGeometries(buildShp([polygonContent([r1]), pointContent(2, 2), polygonContent([r2])]));
  assert.equal(geoms.length, 3);
  assert.equal(geoms[0].type, 'polygon');
  assert.equal(geoms[1].type, 'point');
  assert.equal(geoms[2].type, 'polygon');
  assert.deepEqual(geoms[2].bbox, [5, 5, 6, 6]);
});

test('bout à bout : parse puis point-dans-polygone', () => {
  const { pointInPolygon } = require('../src/modules/common/pointInPolygon');
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const geoms = readShpGeometries(buildShp([polygonContent([ring])]));
  assert.equal(pointInPolygon([5, 5], geoms[0].rings), true);
  assert.equal(pointInPolygon([50, 50], geoms[0].rings), false);
});
