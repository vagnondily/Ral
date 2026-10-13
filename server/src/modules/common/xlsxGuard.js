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
// Balise <mergeCell …>, <col …>, <row …> ou <c …> (préfixe d'espace de noms possible), avec ses attributs.
const TAG = /<(?:[\w.-]+:)?(mergeCell|col|row|c)(?=[\s>/])([^>]*)>/g;
const CELL_REF = /(?:^|\s)r\s*=\s*(?:"([^"]*)"|'([^']*)')/;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
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

function attributes(raw) {
  const out = {};
  for (const m of raw.matchAll(ATTR)) out[m[1].toLowerCase()] = decodeXml(m[2] ?? m[3]);
  return out;
}

const colNumber = (letters) => {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
};

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

/**
 * Ce qu'une entrée XML ferait créer à ExcelJS : cellules fusionnées, dernière
 * colonne déclarée, et s'il s'y trouve une référence illisible (= refus).
 */
function scanSheetXml(xml) {
  let merged = 0; let maxCol = 0; let unreadable = null;
  let cellSlots = 0; let inRow = false; let rowMax = 0; let pos = 0;
  for (const m of String(xml || '').matchAll(TAG)) {
    if (m[1] === 'row') { cellSlots += rowMax; inRow = true; rowMax = 0; pos = 0; continue; }
    if (m[1] === 'c') {
      if (!inRow) continue; // <c> hors d'une ligne (calcChain…) : rien de créé dans une feuille
      const ref = CELL_REF.exec(m[2]);
      if (ref) {
        const raw = ref[1] ?? ref[2];
        const col = /^\s*\$?([A-Za-z]{1,3})\$?\d/.exec(raw.includes('&') ? decodeXml(raw) : raw);
        pos = col ? colNumber(col[1].toUpperCase()) : -1;
        if (pos < 1 || pos > MAX_COL) { unreadable = unreadable || `référence de cellule hors limites « ${String(raw).slice(0, 20)} »`; continue; }
      } else pos += 1; // cellule sans référence : la suivante de la ligne
      if (pos > rowMax) rowMax = pos;
      continue;
    }
    const a = attributes(m[2]);
    if (m[1] === 'mergeCell') {
      const area = refArea(a.ref);
      if (area < 0) { unreadable = unreadable || `zone fusionnée illisible « ${String(a.ref ?? '').slice(0, 40)} »`; continue; }
      merged += area;
    } else {
      // <col min max> d'une feuille ; un <xdr:col>3</xdr:col> de dessin (ancrage) n'a pas d'attributs.
      if (a.max === undefined && a.min === undefined) continue;
      const max = Number(a.max ?? a.min);
      if (!Number.isSafeInteger(max) || max < 1 || max > MAX_COL) { unreadable = unreadable || `plage de colonnes hors limites (${String(a.max ?? '').slice(0, 20)})`; continue; }
      maxCol = Math.max(maxCol, max);
    }
  }
  cellSlots += rowMax;
  return { merged, maxCol, unreadable, cellSlots };
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
    try { xml = e.getData().toString('latin1'); } catch { throw badRequest(NOT_XLSX); }
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
