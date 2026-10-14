/**
 * Contours embarqués de la carte (lot 6a) : l'asset servi à l'écran et l'index
 * lu par le serveur sont produits ensemble par web/scripts/build-geo.mjs. On
 * vérifie ici leurs invariants : 119 contours, clés uniques = normKey(nom),
 * étiquette dans son polygone, emprise de Madagascar, index = asset, taille.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const webAsset = path.join(__dirname, '../../web/public/geo/mdg-adm2.v1.json');
const index = require('../src/modules/map/shapes/mdg-adm2.v1.json');
const buildLib = path.join(__dirname, '../../web/scripts/geoBuild.js');

test('index serveur : 119 contours, clés uniques et normalisées, emprise de Madagascar', () => {
  assert.equal(index.shapeSet, 'mdg-adm2.v1');
  assert.match(index.source, /geoBoundaries/);
  assert.equal(index.shapes.length, 119);
  const keys = index.shapes.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const s of index.shapes) {
    assert.ok(s.name && s.key);
    const [w, so, e, n] = s.bbox;
    assert.ok(w >= 43 && e <= 51 && so >= -26 && n <= -11.5 && w < e && so < n, `${s.name} : bbox ${s.bbox}`);
    assert.ok(s.label[0] >= w && s.label[0] <= e && s.label[1] >= so && s.label[1] <= n);
  }
});

test('asset web : mêmes clés que l\'index, étiquettes dans leur polygone, ≤ 100 Ko gzip', async (t) => {
  if (!fs.existsSync(webAsset) || !fs.existsSync(buildLib)) { t.skip('web/ absent'); return; }
  const m = await import(pathToFileURL(buildLib).href);
  const raw = fs.readFileSync(webAsset, 'utf8');
  const geo = JSON.parse(raw);
  assert.deepEqual(geo.features.map((f) => f.properties.key), index.shapes.map((s) => s.key));
  for (const f of geo.features) {
    assert.equal(f.properties.key, m.normKey(f.properties.name));
    const [x, y] = f.properties.label;
    assert.ok(m.polygonsOf(f.geometry).some((p) => m.inPolygon(x, y, p)), `étiquette de ${f.properties.name}`);
  }
  assert.match(geo.source, /geoBoundaries/); // attribution imprimée au pied de la carte
  assert.ok(zlib.gzipSync(raw).length <= 100 * 1024, `gzip ${zlib.gzipSync(raw).length}`);
  assert.ok(raw.length <= 360 * 1024, `brut ${raw.length}`); // servi sans compression en dev
});
