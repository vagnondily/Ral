const AdmZip = require('adm-zip');

/**
 * Reconnaissance d'un fichier par son CONTENU (les octets), jamais par son nom
 * ni par l'en-tête Content-Type — logique pure, sans I/O, testée.
 *
 * Un nom de fichier ment souvent (un « .xls » Kobo qui est une page HTML, un
 * « .csv » qui est un classeur, un « .sav » compressé en ZSAV…). Chaque import
 * commence donc par `sniffFile` puis décide, selon `kind`, s'il sait lire le
 * fichier ou s'il le refuse en NOMMANT le format reconnu (`label`).
 *
 * Familles reconnues :
 *  - conteneurs zip : `xlsx` (et .xlsm), `xlsb`, `docx`, `pptx`, `ods`, `odf`
 *    (autre OpenDocument), `zip` (archive quelconque, ex. export SPSS de Kobo) ;
 *  - `ole` : conteneur Office 97-2003 (.xls, .doc, .ppt…) ;
 *  - `sav` ($FL2) et `zsav` ($FL3) : SPSS ;
 *  - `pdf`, `html`, `xml`, `json`, `rtf` ;
 *  - `gzip`, `7z`, `rar`, `image` ; `binary` (autre contenu binaire) ;
 *  - `text` : texte tabulaire (CSV), avec son encodage ; `empty`.
 *
 * Pour un zip, `entries` liste les entrées avec leurs tailles DÉCLARÉES
 * (lues dans le répertoire central, sans rien décompresser) : c'est la base de
 * la garde de décompression (`zipGuard.js`).
 */

const LABELS = {
  empty: 'fichier vide',
  text: 'fichier texte (CSV)',
  xlsx: 'classeur Excel (.xlsx)',
  xlsb: 'classeur Excel binaire (.xlsb)',
  docx: 'document Word (.docx)',
  pptx: 'présentation PowerPoint (.pptx)',
  ods: 'classeur OpenDocument (.ods)',
  odf: 'document OpenDocument',
  zip: 'archive .zip',
  ole: 'fichier Office 97-2003 (.xls, .doc…)',
  sav: 'fichier SPSS (.sav)',
  zsav: 'fichier SPSS compressé (.zsav)',
  pdf: 'document PDF',
  html: 'page web (HTML)',
  xml: 'fichier XML',
  json: 'fichier JSON',
  rtf: 'document RTF',
  gzip: 'archive compressée (.gz)',
  '7z': 'archive 7-Zip (.7z)',
  rar: 'archive RAR (.rar)',
  image: 'image',
  binary: 'fichier binaire non reconnu',
};

// Au-delà, le répertoire central d'un zip coûterait trop de mémoire à lire :
// on refuse sans le parcourir (un classeur réel en compte quelques dizaines).
const MAX_ZIP_ENTRIES = 10000;

const at = (buf, bytes, offset = 0) => buf.length >= offset + bytes.length
  && bytes.every((b, i) => buf[offset + i] === b);
const ascii = (s) => [...Buffer.from(s, 'latin1')];

// Signatures binaires en tête de fichier (ordre indifférent : elles sont disjointes).
const MAGIC = [
  ['ole', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  ['sav', ascii('$FL2')],
  ['zsav', ascii('$FL3')],
  ['gzip', [0x1f, 0x8b]],
  ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ['rar', ascii('Rar!\x1a\x07')],
  ['image', [0x89, 0x50, 0x4e, 0x47]],      // PNG
  ['image', [0xff, 0xd8, 0xff]],            // JPEG
  ['image', ascii('GIF8')],
];

const isZip = (buf) => at(buf, [0x50, 0x4b, 0x03, 0x04]) || at(buf, [0x50, 0x4b, 0x05, 0x06]) || at(buf, [0x50, 0x4b, 0x07, 0x08]);

/**
 * Nombre d'entrées annoncé par la fin de répertoire central (EOCD, ou ZIP64),
 * sans lire le répertoire lui-même. null si l'EOCD est introuvable.
 */
function zipDeclaredEntryCount(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let p = buf.length - 22; p >= min; p -= 1) {
    if (buf.readUInt32LE(p) !== 0x06054b50) continue;
    const count = buf.readUInt16LE(p + 10);
    if (count !== 0xffff) return count;
    // ZIP64 : localisateur juste avant l'EOCD → fin de répertoire ZIP64.
    if (p >= 20 && buf.readUInt32LE(p - 20) === 0x07064b50) {
      const off = Number(buf.readBigUInt64LE(p - 12));
      if (off + 40 <= buf.length && buf.readUInt32LE(off) === 0x06064b50) return Number(buf.readBigUInt64LE(off + 32));
    }
    return count;
  }
  return null;
}

/**
 * Entrées d'un zip avec leurs tailles déclarées (rien n'est décompressé).
 * @returns {{ entries: Array<{name, size, compressedSize, isDirectory}>|null, error: string|null }}
 */
function zipEntries(buf) {
  const declared = zipDeclaredEntryCount(buf);
  if (declared == null) return { entries: null, error: 'corrupt' };
  if (declared > MAX_ZIP_ENTRIES) return { entries: null, error: 'too-many-entries', declared };
  try {
    const entries = new AdmZip(buf).getEntries().map((e) => ({
      name: e.entryName,
      size: Number(e.header.size) || 0,
      compressedSize: Number(e.header.compressedSize) || 0,
      isDirectory: e.isDirectory,
    }));
    return { entries, error: null };
  } catch {
    return { entries: null, error: 'corrupt' };
  }
}

/** Type OpenDocument lu dans l'entrée « mimetype » (minuscule, non compressée par convention). */
function odfMimetype(buf, entries) {
  const e = entries.find((x) => x.name === 'mimetype');
  if (!e || e.size > 200 || e.compressedSize > 200) return null;
  try { return new AdmZip(buf).getEntry('mimetype').getData().toString('latin1').trim(); } catch { return null; }
}

function classifyZip(buf) {
  const { entries, error, declared } = zipEntries(buf);
  if (!entries) return { kind: 'zip', entries: null, error, declaredEntries: declared ?? null };
  const names = entries.map((e) => e.name.toLowerCase());
  const has = (re) => names.some((n) => re.test(n));
  let kind = 'zip';
  if (has(/^xl\/workbook\.bin$/)) kind = 'xlsb';
  else if (has(/^xl\/workbook\.xml$/) || (has(/^\[content_types\]\.xml$/) && has(/^xl\//))) kind = 'xlsx';
  else if (has(/^word\//)) kind = 'docx';
  else if (has(/^ppt\//)) kind = 'pptx';
  else if (names.includes('mimetype') && has(/^meta-inf\/manifest\.xml$/)) {
    kind = /opendocument\.spreadsheet/.test(odfMimetype(buf, entries) || '') ? 'ods' : 'odf';
  }
  return { kind, entries, error: null };
}

/**
 * Texte ou binaire ? Un octet NUL (hors UTF-16 annoncé par sa marque) ou trop
 * de caractères de contrôle désignent un binaire. Renvoie l'encodage du texte.
 */
function textEncoding(buf) {
  if (at(buf, [0xef, 0xbb, 0xbf])) return { encoding: 'utf8', bom: 3 };
  if (at(buf, [0xff, 0xfe])) return { encoding: 'utf16le', bom: 2 };
  if (at(buf, [0xfe, 0xff])) return { encoding: 'utf16be', bom: 2 };
  const n = Math.min(buf.length, 65536);
  let control = 0;
  for (let i = 0; i < n; i += 1) {
    const c = buf[i];
    if (c === 0) return null;
    // Tabulation, sauts de ligne, saut de page, tab. verticale et fin de fichier DOS (0x1A) sont du texte.
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0b && c !== 0x0c && c !== 0x0d && c !== 0x1a) control += 1;
  }
  return control > n * 0.02 ? null : { encoding: 'utf8', bom: 0 };
}

/** Décode le texte d'un tampon reconnu comme `text`, marque d'ordre retirée. */
function decodeText(buf, { encoding = 'utf8', bom = 0 } = {}) {
  const body = buf.subarray(bom);
  if (encoding === 'utf16le') return body.toString('utf16le');
  if (encoding === 'utf16be') {
    const swapped = Buffer.from(body.subarray(0, body.length - (body.length % 2)));
    return swapped.swap16().toString('utf16le');
  }
  return body.toString('utf8');
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : all; }
  return XML_ENTITIES[e] ?? all;
});

/**
 * Noms des feuilles d'un .xlsx, lus dans xl/workbook.xml — sans charger le
 * classeur (à n'appeler qu'après la garde de décompression). [] si illisible.
 */
function xlsxSheetNames(buf) {
  try {
    const zip = new AdmZip(buf);
    const entry = zip.getEntry('xl/workbook.xml')
      || zip.getEntries().find((e) => e.entryName.toLowerCase() === 'xl/workbook.xml');
    if (!entry || entry.header.size > 5e6) return [];
    const xml = entry.getData().toString('utf8');
    return [...xml.matchAll(/<(?:\w+:)?sheet\b[^>]*?\bname\s*=\s*(["'])(.*?)\1/g)].map((m) => unescapeXml(m[2]));
  } catch {
    return [];
  }
}

const HTML_START =/^<(?:!doctype\s+html|html|head|body|meta|title|table|div|script|style|link|iframe|form|p|h[1-6])(?=[\s>/])/i;

/** Nature d'un contenu texte : HTML, XML, JSON, RTF ou texte tabulaire. */
function classifyText(head) {
  const s = head.replace(/^\uFEFF/, '').replace(/^\s+/, '');
  if (/^<!--/.test(s) || /^<!doctype/i.test(s) || /^<\?xml/i.test(s)) {
    return /<html[\s>]|<!doctype\s+html/i.test(s.slice(0, 4096)) ? 'html' : 'xml';
  }
  if (HTML_START.test(s)) return 'html';
  if (/^\{\\rtf/.test(s)) return 'rtf';
  if (/^\[\s*(?:[{["\d\]-]|$)/.test(s) || /^\{\s*(?:["}]|$)/.test(s)) return 'json';
  return 'text';
}

/**
 * @param {Buffer} buf  contenu brut du fichier reçu
 * @returns {{ kind: string, label: string, encoding?: string, bom?: number,
 *            entries?: Array|null, error?: string|null, declaredEntries?: number|null }}
 */
function sniffFile(buf) {
  const out = (kind, extra = {}) => ({ kind, label: LABELS[kind], ...extra });
  if (!Buffer.isBuffer(buf) || buf.length === 0) return out('empty');
  if (isZip(buf)) { const z = classifyZip(buf); return out(z.kind, z); }
  for (const [kind, bytes] of MAGIC) if (at(buf, bytes)) return out(kind);
  const pdf = buf.indexOf('%PDF-');
  if (pdf >= 0 && pdf < 1024) return out('pdf');
  const enc = textEncoding(buf);
  if (!enc) return out('binary');
  const head = decodeText(buf.subarray(0, Math.min(buf.length, 8192)), enc);
  if (!head.trim()) return out('empty');
  const kind = classifyText(head);
  return kind === 'text' ? out('text', enc) : out(kind);
}

module.exports = { sniffFile, zipEntries, zipDeclaredEntryCount, xlsxSheetNames, decodeText, LABELS, MAX_ZIP_ENTRIES };
