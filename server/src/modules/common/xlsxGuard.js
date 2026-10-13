/**
 * Chargement sûr d'un classeur Excel (.xlsx, .xlsm) pour les imports — une
 * seule porte pour tous les imports Excel de l'application.
 *
 * ExcelJS (4.4) crée en mémoire CHAQUE cellule d'une zone fusionnée, une entrée
 * par cellule couverte par une validation de données et un objet par colonne
 * déclarée. Un fichier de quelques Ko (A6:AQ1048576 fusionné, une colonne
 * entière validée, <col max="50000000">) suffit à épuiser la mémoire et à
 * arrêter l'API pour tous les utilisateurs. Avant de charger, donc :
 *  - le fichier doit être un classeur dont la liste des entrées se lit (sinon
 *    400 : on ne laisse jamais ExcelJS ouvrir ce que la garde n'a pas vu) ;
 *  - garde de décompression (zipGuard), avec les limites configurées ;
 *  - TOUTES les entrées XML sont examinées, quel que soit leur chemin (ExcelJS
 *    reconnaît une feuille même sous « /xl/… » ou « sheet1.xml.x ») : surface
 *    fusionnée plafonnée, référence illisible refusée, colonnes ≤ 16 384 ;
 *  - « places de cellules » plafonnées : ExcelJS range les cellules d'une ligne
 *    dans un tableau indexé par colonne, que eachRow / eachCell parcourent en
 *    entier. 20 000 lignes ne contenant qu'une cellule en XFD (100 Ko) feraient
 *    parcourir 327 millions de places et bloqueraient l'API ; on additionne donc,
 *    ligne par ligne, la dernière colonne occupée (un vrai export en est très loin) ;
 * puis chargement SANS les nœuds qui n'ont aucune incidence sur les valeurs lues
 * (validations, mises en forme conditionnelles, dessins, extensions).
 */
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { sniffFile } = require('./fileSniff');
const { assertZipEntries, zipLimitsFromEnv } = require('./zipGuard');
const { badRequest } = require('../../middleware/errors');

const MAX_MERGED_CELLS = 100000;
// Σ par ligne de la dernière colonne occupée. Un export réel de 189 lignes × 942 colonnes
// en fait 0,18 million ; la garde de décompression (150 Mo) borne un classeur dense
// à environ 6 millions de cellules.
const MAX_CELL_SLOTS = 10000000;
const MAX_ROW = 1048576; // limites d'une feuille Excel
const MAX_COL = 16384;
const IGNORE_NODES = ['dataValidations', 'conditionalFormatting', 'drawing', 'picture', 'extLst'];
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const NOT_XLSX = 'Classeur Excel (.xlsx) attendu : ce fichier n\'en est pas un, ou il est illisible. '
  + 'Ouvrez-le dans Excel, enregistrez-le au format .xlsx, puis réessayez.';
const refused = (what) => badRequest(`Classeur refusé par sécurité : ${what}. `
  + 'Ouvrez-le dans Excel, défusionnez les grandes zones (Accueil › Fusionner et centrer) ou supprimez les colonnes inutiles, enregistrez, puis réessayez.');

/** Entités XML (&#49; &#x31; &amp;…) décodées, comme le ferait ExcelJS. */
function decodeXml(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const colNumber = (letters) => {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
};

/** Bornes d'une référence « B2 » ou « A6:AQ1048576 » ; null si illisible ou hors de la feuille. */
function refBounds(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref || '').trim().toUpperCase());
  if (!m) return null;
  const c1 = colNumber(m[1]); const r1 = Number(m[2]);
  const c2 = m[3] ? colNumber(m[3]) : c1; const r2 = m[4] ? Number(m[4]) : r1;
  if ([c1, c2].some((c) => c < 1 || c > MAX_COL) || [r1, r2].some((r) => !Number.isSafeInteger(r) || r < 1 || r > MAX_ROW)) return null;
  return { rows: Math.abs(r2 - r1) + 1, cols: Math.abs(c2 - c1) + 1, lastCol: Math.max(c1, c2) };
}

/**
 * Nombre de cellules d'une référence « B2 » ou « A6:AQ1048576 » ; -1 si elle est
 * illisible ou sort de la feuille (au-delà de XFD1048576).
 */
function refArea(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref || '').trim().toUpperCase());
  if (!m) return -1;
  const c1 = colNumber(m[1]); const r1 = Number(m[2]);
  const c2 = m[3] ? colNumber(m[3]) : c1; const r2 = m[4] ? Number(m[4]) : r1;
  if ([c1, c2].some((c) => c < 1 || c > MAX_COL) || [r1, r2].some((r) => !Number.isSafeInteger(r) || r < 1 || r > MAX_ROW)) return -1;
  return (Math.abs(c2 - c1) + 1) * (Math.abs(r2 - r1) + 1);
}

const isSpace = (code) => code === 32 || code === 9 || code === 10 || code === 13;
// Fin d'un nom (élément ou attribut) : blanc XML, « = », « / », « > », « < » ou guillemet.
const NAME_END = new Set([' ', '\t', '\n', '\r', '=', '/', '>', '<', '"', "'"]);
const WATCHED = new Set(['mergeCell', 'col', 'row', 'c']);

/**
 * Balise ouvrante lue strictement à partir de `lt` (le « < ») : nom, puis attributs
 * nom="valeur" séparés par des blancs, puis « > » ou « /> ». Renvoie { name, attrs, end }
 * (end = position après le « > ») ou { error } : tout écart à la syntaxe XML — qu'un
 * vrai classeur ne contient jamais — est refusé plutôt que deviné.
 * Les noms d'attributs sont gardés tels quels (sensibles à la casse, comme ExcelJS).
 */
function readStartTag(text, lt) {
  const n = text.length;
  let j = lt + 1;
  while (j < n && !NAME_END.has(text[j])) j += 1;
  const name = text.slice(lt + 1, j);
  if (!name) return { error: 'balise sans nom' };
  const attrs = Object.create(null);
  for (;;) {
    const before = j;
    while (j < n && isSpace(text.charCodeAt(j))) j += 1;
    if (j >= n) return { error: 'balise non fermée' };
    if (text[j] === '>') return { name, attrs, end: j + 1 };
    if (text[j] === '/') return text[j + 1] === '>' ? { name, attrs, end: j + 2 } : { error: 'balise mal formée' };
    if (j === before) return { error: 'attributs non séparés' };
    const a0 = j;
    while (j < n && !NAME_END.has(text[j])) j += 1;
    const attr = text.slice(a0, j);
    if (!attr) return { error: 'attribut mal formé' };
    while (j < n && isSpace(text.charCodeAt(j))) j += 1;
    if (text[j] !== '=') return { error: 'attribut sans valeur' };
    j += 1;
    while (j < n && isSpace(text.charCodeAt(j))) j += 1;
    const q = text[j];
    if (q !== '"' && q !== "'") return { error: 'valeur d\'attribut sans guillemets' };
    const close = text.indexOf(q, j + 1);
    if (close < 0) return { error: 'valeur d\'attribut non fermée' };
    const value = text.slice(j + 1, close);
    if (value.includes('<')) return { error: 'valeur d\'attribut mal formée' };
    if (attr in attrs) return { error: 'attribut en double' };
    attrs[attr] = value;
    j = close + 1;
  }
}

/** Fin (position après le terminateur) d'un commentaire, d'une section CDATA ou d'une instruction ; -1 si non fermé. */
function skipSpecial(text, lt) {
  if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); return e < 0 ? -1 : e + 3; }
  if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); return e < 0 ? -1 : e + 3; }
  const e = text.indexOf('?>', lt + 2); // <? … ?>
  return e < 0 ? -1 : e + 2;
}

/**
 * Ce qu'une entrée XML ferait créer à ExcelJS : cellules fusionnées, dernière
 * colonne déclarée, places de cellules, et s'il s'y trouve une référence ou une
 * syntaxe illisible (= refus).
 *
 * Lecture en UNE passe, dans l'ordre du document, en temps linéaire : chaque
 * commentaire, CDATA ou instruction est sauté jusqu'à SON terminateur (absent →
 * refus immédiat, jamais de nouvel essai plus loin), chaque balise est lue
 * attribut par attribut. Une déclaration <!DOCTYPE …> / <!ENTITY …> (absente
 * d'un vrai classeur, et dont les littéraux pourraient masquer la suite) est
 * refusée, comme un octet nul (XML encodé autrement qu'en UTF-8).
 */
function scanSheetXml(xml) {
  const text = String(xml || '');
  let merged = 0; let maxCol = 0; let cellSlots = 0; let inRow = false; let rowMax = 0; let pos = 0;
  const done = (unreadable = null) => ({ merged, maxCol, unreadable, cellSlots: cellSlots + rowMax });
  if (text.includes('\u0000')) return done('caractère nul (encodage non pris en charge)');
  let i = 0;
  for (;;) {
    const lt = text.indexOf('<', i);
    if (lt < 0) return done();
    const next = text[lt + 1];
    if (next === '!' || next === '?') {
      if (next === '!' && !text.startsWith('<!--', lt) && !text.startsWith('<![CDATA[', lt)) {
        return done('déclaration de document (DOCTYPE) non prise en charge');
      }
      i = skipSpecial(text, lt);
      if (i < 0) return done('commentaire, section CDATA ou instruction non fermé');
      continue;
    }
    if (next === '/') { // balise fermante : </nom>
      const gt = text.indexOf('>', lt + 2);
      if (gt < 0 || !/^[^\s<>/="']+\s*$/.test(text.slice(lt + 2, gt))) return done('balise fermante mal formée');
      i = gt + 1;
      continue;
    }
    const tag = readStartTag(text, lt);
    if (tag.error) return done(tag.error);
    i = tag.end;
    const local = tag.name.slice(tag.name.lastIndexOf(':') + 1); // préfixe d'espace de noms possible
    if (!WATCHED.has(local)) continue;
    const a = tag.attrs;
    if (local === 'row') { cellSlots += rowMax; inRow = true; rowMax = 0; pos = 0; continue; }
    if (local === 'c') {
      if (!inRow) continue; // <c> hors d'une ligne (calcChain…) : rien de créé dans une feuille
      if (a.r !== undefined) {
        const raw = decodeXml(a.r);
        const col = /^\s*\$?([A-Za-z]{1,3})\$?\d/.exec(raw);
        pos = col ? colNumber(col[1].toUpperCase()) : -1;
        if (pos < 1 || pos > MAX_COL) return done(`référence de cellule hors limites « ${raw.slice(0, 20)} »`);
      } else pos += 1; // cellule sans référence : la suivante de la ligne
      if (pos > rowMax) rowMax = pos;
      continue;
    }
    if (local === 'mergeCell') {
      const ref = a.ref === undefined ? undefined : decodeXml(a.ref);
      const b = refBounds(ref);
      if (!b) return done(`zone fusionnée illisible « ${String(ref ?? '').slice(0, 40)} »`);
      merged += b.rows * b.cols;
      // ExcelJS crée une cellule par case fusionnée : chaque ligne de la zone s'étend jusqu'à sa dernière
      // colonne (une fusion verticale en XFD sur 100 000 lignes = 1,6 milliard de places à parcourir).
      cellSlots += b.rows * b.lastCol;
      continue;
    }
    // <col min max> d'une feuille ; un <xdr:col>3</xdr:col> de dessin (ancrage) n'a pas d'attributs.
    if (a.max === undefined && a.min === undefined) continue;
    const rawMax = decodeXml(a.max ?? a.min);
    const max = Number(rawMax);
    if (!Number.isSafeInteger(max) || max < 1 || max > MAX_COL) return done(`plage de colonnes hors limites (${rawMax.slice(0, 20)})`);
    maxCol = Math.max(maxCol, max);
  }
}

/**
 * Texte d'une entrée XML : UTF-16 décodé d'après sa marque d'ordre des octets (Office écrit
 * ainsi les métadonnées customXml/item*.xml), sinon octet par octet (les balises sont en ASCII).
 */
function entryText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(0, buf.length - (buf.length % 2)));
    return le.swap16().toString('utf16le');
  }
  return buf.toString('latin1');
}

/** Cellules fusionnées déclarées dans le XML d'une feuille (compatibilité). */
const mergedCellsInXml = (xml) => scanSheetXml(xml).merged;

/**
 * Charge un classeur après les gardes. Lève une AppError 400 (classeur refusé)
 * ou 413 (trop volumineux une fois décompressé) ; une autre erreur signifie
 * « fichier illisible », à traduire par l'appelant.
 * @param {Buffer} buffer
 * @param {{ zipLimits?: object, maxMergedCells?: number }} [opts]
 * @returns {Promise<ExcelJS.Workbook>}
 */
async function loadWorkbook(buffer, { zipLimits = zipLimitsFromEnv(process.env), maxMergedCells = MAX_MERGED_CELLS, maxCellSlots = MAX_CELL_SLOTS } = {}) {
  const sniff = sniffFile(buffer);
  if (sniff.kind !== 'xlsx' || !sniff.entries) throw badRequest(NOT_XLSX);
  assertZipEntries(sniff.entries, zipLimits, { archiveBytes: buffer.length }); // 413 / 400 AVANT décompression
  let entries;
  try { entries = new AdmZip(buffer).getEntries(); } catch { throw badRequest(NOT_XLSX); }
  let merged = 0; let cellSlots = 0;
  for (const e of entries) {
    if (e.isDirectory || !/\.xml/i.test(e.entryName)) continue;
    let xml;
    try { xml = entryText(e.getData()); } catch { throw badRequest(NOT_XLSX); }
    const scan = scanSheetXml(xml);
    if (scan.unreadable) throw refused(scan.unreadable);
    merged += scan.merged;
    if (merged > maxMergedCells) throw refused(`il fusionne plus de ${maxMergedCells.toLocaleString('fr-FR')} cellules`);
    cellSlots += scan.cellSlots;
    if (cellSlots > maxCellSlots) {
      throw refused(`ses lignes s'étendent sur plus de ${maxCellSlots.toLocaleString('fr-FR')} cellules (souvent une cellule isolée très à droite sur de nombreuses lignes)`);
    }
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer, { ignoreNodes: IGNORE_NODES });
  return wb;
}

/** Erreur de chargement à laisser passer telle quelle (refus motivé) plutôt que « illisible ». */
const isRefusal = (err) => Boolean(err && err.statusCode && err.statusCode < 500);

module.exports = { loadWorkbook, isRefusal, refArea, scanSheetXml, mergedCellsInXml, decodeXml, MAX_MERGED_CELLS, MAX_CELL_SLOTS, IGNORE_NODES };
