#!/usr/bin/env node
/**
 * Contours de la carte (lot 6a) — build reproductible :
 *   node web/scripts/build-geo.mjs [--src chemin.geojson] [--tol 0.005]
 * Lit la source geoBoundaries (ADM2 Madagascar, propriété `name`) et écrit
 *   web/public/geo/mdg-adm2.v1.json               (contours servis, hors ligne)
 *   server/src/modules/map/shapes/mdg-adm2.v1.json (index : clé, nom, bbox, étiquette)
 * Même entrée → mêmes octets. Les fonctions sont dans geoBuild.js (pures, testées).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildShapes, brokenSharedVertices, inPolygon, polygonsOf } from './geoBuild.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const root = path.resolve(web, '..');
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const SHAPE_SET = 'mdg-adm2.v1';
const candidates = [path.join(web, 'geo-src/mdg-adm2.geoboundaries.geojson'), path.join(web, 'public/mdg-adm2.geojson')];
const srcPath = arg('src', candidates.find((p) => fs.existsSync(p)));
if (!srcPath || !fs.existsSync(srcPath)) {
  console.error('Source introuvable :', candidates.join(' | '));
  process.exit(1);
}
const tol = Number(arg('tol', '0.005'));
// Métadonnées facultatives à côté de la source (source / licence lues de geoBoundaries).
const metaPath = srcPath.replace(/\.geojson$/, '.meta.json');
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};

const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const { web: out, index, stats } = buildShapes(src, {
  tol,
  shapeSet: SHAPE_SET,
  source: meta.source || 'geoBoundaries — Madagascar ADM2',
  license: meta.license || null,
});

const webOut = path.join(web, `public/geo/${SHAPE_SET}.json`);
const idxOut = path.join(root, `server/src/modules/map/shapes/${SHAPE_SET}.json`);
fs.mkdirSync(path.dirname(webOut), { recursive: true });
fs.mkdirSync(path.dirname(idxOut), { recursive: true });
const webJson = JSON.stringify(out);
fs.writeFileSync(webOut, webJson);
fs.writeFileSync(idxOut, `${JSON.stringify(index, null, 1)}\n`);

const labelsIn = out.features.filter((f) => polygonsOf(f.geometry).some((p) => inPolygon(f.properties.label[0], f.properties.label[1], p))).length;
console.log(JSON.stringify({
  src: path.relative(root, srcPath),
  ...stats,
  bytes: webJson.length,
  gzip: zlib.gzipSync(webJson).length,
  labelsInside: labelsIn,
  brokenSharedVertices: brokenSharedVertices(src.features, out.features),
  outputs: [path.relative(root, webOut), path.relative(root, idxOut)],
}, null, 1));
