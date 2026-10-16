const { sniffFile } = require('./fileSniff');

/**
 * Image téléversée (logos des en-têtes du concepteur de rapport, lot 7a C8 / retour 88) —
 * logique PURE, sans I/O, testée (test/imageInfo.test.js).
 *
 * Seuls PNG et JPEG sont acceptés, reconnus par leurs OCTETS (jamais par le nom ni le
 * Content-Type) ; largeur et hauteur sont lues dans l'en-tête (IHDR pour PNG, segment SOFn
 * pour JPEG) sans décoder l'image. Tout le reste est refusé en NOMMANT le format reconnu :
 * SVG (peut contenir du code), GIF, WebP, BMP, HEIC / AVIF, puis les familles de
 * common/fileSniff (document PDF, page web, fichier XML…) — une seule liste de formats.
 */
const MAX_BYTES = 512 * 1024;
const MAX_PX = 4000;
const ACCEPTED = 'Formats acceptés : PNG ou JPEG.';

const at = (buf, bytes, offset = 0) => buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s) => [...Buffer.from(s, 'latin1')];

/** Largeur et hauteur d'un PNG (bloc IHDR, juste après la signature). null si tronqué. */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Largeur et hauteur d'un JPEG : parcours des segments jusqu'au premier SOFn (C0–CF hors C4, C8,
 * CC). Boucle bornée par la taille du tampon ; null si tronqué ou si les données d'image
 * commencent (SOS) avant tout SOFn.
 */
function jpegSize(buf) {
  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    if (m === 0xff) { p += 1; continue; } // octets de remplissage
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; } // marqueurs sans longueur
    if (m === 0xd9 || m === 0xda) return null;
    const len = buf.readUInt16BE(p + 2);
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (p + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
    }
    p += 2 + len;
  }
  return null;
}

/** Formats d'image REFUSÉS, nommés (avant la reconnaissance générale de fileSniff). */
function refusedImage(buf) {
  if (at(buf, ascii('GIF8'))) return 'image GIF';
  if (at(buf, ascii('RIFF')) && at(buf, ascii('WEBP'), 8)) return 'image WebP';
  if (at(buf, ascii('BM')) && buf.length > 14) return 'image BMP';
  if (at(buf, ascii('ftyp'), 4)) {
    const brand = buf.toString('latin1', 8, 12);
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return 'image HEIC';
    if (/^avi[fs]$/.test(brand)) return 'image AVIF';
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096)).replace(/^\uFEFF/, '');
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image SVG (refusée : elle peut contenir du code)';
  return null;
}

/**
 * @param {Buffer} buf octets reçus
 * @returns {{ ok: true, mime: 'image/png'|'image/jpeg', width: number, height: number, bytes: number }
 *   | { ok: false, code: 'empty'|'too_large'|'format'|'truncated'|'dimensions', message: string, label?: string }}
 */
function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, code: 'empty', message: 'Aucune image reçue.' };
  if (buf.length > MAX_BYTES) {
    return { ok: false, code: 'too_large', message: `Image trop volumineuse : ${Math.ceil(buf.length / 1024)} Ko (512 Ko au plus).` };
  }
  const named = refusedImage(buf);
  if (named) return { ok: false, code: 'format', label: named, message: `Format refusé : ${named}. ${ACCEPTED}` };
  let mime = null; let size = null;
  if (at(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) { mime = 'image/png'; size = pngSize(buf); } else if (at(buf, [0xff, 0xd8, 0xff])) { mime = 'image/jpeg'; size = jpegSize(buf); }
  if (!mime) {
    const s = sniffFile(buf);
    return { ok: false, code: 'format', label: s.label, message: `Format refusé : ${s.label}. ${ACCEPTED}` };
  }
  if (!size) return { ok: false, code: 'truncated', message: 'Image illisible : son en-tête est incomplet ou abîmé.' };
  const { width, height } = size;
  if (!(width >= 1 && height >= 1 && width <= MAX_PX && height <= MAX_PX)) {
    return { ok: false, code: 'dimensions', message: `Image de ${width} × ${height} px : 1 à ${MAX_PX} px de côté.` };
  }
  return { ok: true, mime, width, height, bytes: buf.length };
}

module.exports = { imageInfo, pngSize, jpegSize, MAX_BYTES, MAX_PX };
