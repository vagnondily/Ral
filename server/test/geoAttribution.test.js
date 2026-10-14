const test = require('node:test');
const assert = require('node:assert/strict');
const { haversineKm, nearestArea, attributeByGps, validPoint } = require('../src/modules/common/geoAttribution');

// Arbre admin : Région > District > 2 communes (avec centroïdes).
const areas = [
  { id: 'r1', depth: 1, name: 'Atsimo-Andrefana', pcode: 'MG7', lat: -22.5, lng: 44.5, parentId: null },
  { id: 'd1', depth: 2, name: 'Toliara II', pcode: 'MG71', lat: -23.0, lng: 43.8, parentId: 'r1' },
  { id: 'c1', depth: 3, name: 'Commune A', pcode: 'MG7101', lat: -23.10, lng: 43.70, parentId: 'd1' },
  { id: 'c2', depth: 3, name: 'Commune B', pcode: 'MG7102', lat: -23.40, lng: 43.90, parentId: 'd1' },
];

test('haversineKm : distances plausibles', () => {
  assert.equal(Math.round(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })), 0);
  const d = haversineKm({ lat: -23.1, lng: 43.7 }, { lat: -23.4, lng: 43.9 });
  assert.ok(d > 30 && d < 50, `~37 km attendu, obtenu ${d}`);
});

test('validPoint : rejette 0/0, hors bornes, non numérique', () => {
  assert.equal(validPoint({ lat: -23.1, lng: 43.7 }), true);
  assert.equal(validPoint({ lat: 0, lng: 0 }), false);
  assert.equal(validPoint({ lat: 200, lng: 10 }), false);
  assert.equal(validPoint({ lat: 'x', lng: 1 }), false);
  assert.equal(validPoint(null), false);
});

test('nearestArea : la commune la plus proche', () => {
  const near = nearestArea({ lat: -23.11, lng: 43.71 }, areas.filter((a) => a.depth === 3));
  assert.equal(near.area.id, 'c1');
});

test('attributeByGps : rattache à la commune + remonte district/région + pcodes', () => {
  const r = attributeByGps({ lat: -23.11, lng: 43.71 }, areas);
  assert.equal(r.geoStatus, 'gps_centroid');
  assert.equal(r.adm3, 'Commune A');
  assert.equal(r.adm3Pcode, 'MG7101');
  assert.equal(r.adm2, 'Toliara II');
  assert.equal(r.adm2Pcode, 'MG71');
  assert.equal(r.adm1, 'Atsimo-Andrefana');
  assert.equal(r.adm1Pcode, 'MG7');
  assert.equal(r.adminAreaId, 'c1');
});

test('attributeByGps : l\'autre commune pour un point plus au sud', () => {
  const r = attributeByGps({ lat: -23.39, lng: 43.91 }, areas);
  assert.equal(r.adm3, 'Commune B');
  assert.equal(r.adm3Pcode, 'MG7102');
});

test('attributeByGps : point invalide → null', () => {
  assert.equal(attributeByGps({ lat: 0, lng: 0 }, areas), null);
});

test('attributeByGps : repli district si aucune commune n\'a de centroïde', () => {
  const noCommuneCentroids = areas.map((a) => (a.depth === 3 ? { ...a, lat: null, lng: null } : a));
  const r = attributeByGps({ lat: -23.0, lng: 43.8 }, noCommuneCentroids);
  assert.equal(r.adm2, 'Toliara II');
  assert.equal(r.adm3, null, 'pas de commune résolue');
});

test('attributeByGps : drapeau far si au-delà de maxKm', () => {
  const r = attributeByGps({ lat: -18.0, lng: 47.5 }, areas, { maxKm: 100 }); // Tana, loin de Toliara
  assert.equal(r.far, true);
});

test('attributeByGps : mode POLYGONE prioritaire quand des contours sont fournis', () => {
  // locate renvoie l'id de commune c2 quel que soit le point (bouchon).
  const r = attributeByGps({ lat: -23.11, lng: 43.71 }, areas, {
    features: [{ ref: 'c2', bbox: [0, 0, 0, 0], rings: [] }],
    locate: () => 'c2',
  });
  assert.equal(r.geoStatus, 'gps_polygon');
  assert.equal(r.adm3, 'Commune B');
  assert.equal(r.adm2, 'Toliara II');
});
