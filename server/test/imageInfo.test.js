/**
 * Images des en-têtes du concepteur (lot 7a C8, retour 88) : common/imageInfo — PNG et JPEG
 * reconnus par les OCTETS avec leurs dimensions ; tout le reste refusé en nommant le format.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { imageInfo, MAX_BYTES } = require('../src/modules/common/imageInfo');

/** PNG minimal : signature + bloc IHDR (largeur, hauteur) + IEND. */
function png(width, height, pad = 0) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([sig, ihdr, Buffer.alloc(pad), Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
}
/** JPEG minimal : SOI + APP0 (JFIF) + DQT + SOF0 (hauteur, largeur) + EOI. */
function jpeg(width, height, { sof = 0xc0 } = {}) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]), Buffer.alloc(64, 1)]);
  const sofSeg = Buffer.from([0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dqt, sofSeg, Buffer.from([0xff, 0xd9])]);
}

test('PNG et JPEG (ligne de base et progressif) : type et dimensions lus dans l\'en-tête', () => {
  assert.deepEqual(imageInfo(png(320, 120)), { ok: true, mime: 'image/png', width: 320, height: 120, bytes: png(320, 120).length });
  const j = imageInfo(jpeg(800, 600));
  assert.deepEqual([j.ok, j.mime, j.width, j.height], [true, 'image/jpeg', 800, 600]);
  const prog = imageInfo(jpeg(1024, 256, { sof: 0xc2 }));
  assert.deepEqual([prog.width, prog.height], [1024, 256]);
});

test('formats refusés en NOMMANT le format : SVG, GIF, WebP, BMP, HEIC, PDF, HTML, XML, texte', () => {
  const cases = [
    [Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /image SVG/],
    [Buffer.from('<svg width="10" height="10"></svg>'), /image SVG/],
    [Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]), /image GIF/],
    [Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]), /image WebP/],
    [Buffer.concat([Buffer.from('BM'), Buffer.alloc(40)]), /image BMP/],
    [Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(20)]), /image HEIC/],
    [Buffer.from('%PDF-1.7\n1 0 obj'), /document PDF/],
    [Buffer.from('<!doctype html><html><body>x</body></html>'), /page web/],
    [Buffer.from('<?xml version="1.0"?><root/>'), /fichier XML/],
    [Buffer.from('a;b\n1;2\n'), /fichier texte/],
  ];
  for (const [buf, re] of cases) {
    const r = imageInfo(buf);
    assert.equal(r.ok, false, String(re));
    assert.equal(r.code, 'format');
    assert.match(r.message, re);
    assert.match(r.message, /PNG ou JPEG/);
  }
});

test('tronqué, vide, 0 px, plus de 4 000 px, plus de 512 Ko : refusés avec la raison', () => {
  assert.equal(imageInfo(Buffer.alloc(0)).code, 'empty');
  assert.equal(imageInfo(null).code, 'empty');
  assert.equal(imageInfo(png(10, 10).subarray(0, 14)).code, 'truncated');
  assert.equal(imageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])).code, 'truncated');
  // JPEG dont les données d'image commencent avant toute taille : illisible.
  assert.equal(imageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6])).code, 'truncated');
  assert.equal(imageInfo(png(0, 10)).code, 'dimensions');
  assert.equal(imageInfo(png(4001, 10)).code, 'dimensions');
  assert.equal(imageInfo(jpeg(10, 5000)).code, 'dimensions');
  assert.equal(imageInfo(png(4000, 4000)).ok, true);
  const big = imageInfo(png(100, 100, MAX_BYTES));
  assert.equal(big.code, 'too_large');
  assert.match(big.message, /512 Ko/);
});
