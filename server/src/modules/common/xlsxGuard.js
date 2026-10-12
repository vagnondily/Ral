/**
 * Chargement sûr d'un classeur Excel (.xlsx, .xlsm) pour les imports — une
 * seule porte pour tous les imports Excel de l'application.
 *
 * ExcelJS (4.4) crée en mémoire CHAQUE cellule d'une zone fusionnée, et une
 * entrée par cellule couverte par une validation de données. Un fichier de
 * 6 Ko qui fusionne A6:AQ1048576, ou qui valide une colonne entière, suffit à
 * épuiser la mémoire et à arrêter l'API pour tous les utilisateurs. Avant de
 * charger, donc :
 *  - garde de décompression (zipGuard), comme pour les autres formats ;
 *  - surface fusionnée lue dans le XML des feuilles et plafonnée (les classeurs
 *    réels du pays en fusionnent au plus ~3 300 cellules) ;
 * puis chargement SANS les nœuds qui n'ont aucune incidence sur les valeurs lues
 * (validations, mises en forme conditionnelles, dessins, extensions).
 */
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { sniffFile } = require('./fileSniff');
const { assertZipEntries, DEFAULT_ZIP_LIMITS } = require('./zipGuard');
const { badRequest } = require('../../middleware/errors');

const MAX_MERGED_CELLS = 100000;
const IGNORE_NODES = ['dataValidations', 'conditionalFormatting', 'drawing', 'picture', 'extLst'];
const SHEET_XML = /^xl\/worksheets\/[^/]+\.xml$/i;
const MERGE_REF = /<(?:\w+:)?mergeCell\b[^>]*?\bref="([^"]+)"/g;

const colNumber = (letters) => {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
};

/** Nombre de cellules d'une référence « B2 » ou « A6:AQ1048576 » (0 si illisible). */
function refArea(ref) {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})(?::\$?([A-Z]{1,3})\$?(\d{1,7}))?$/.exec(String(ref || '').trim().toUpperCase());
  if (!m) return 0;
  const c1 = colNumber(m[1]); const r1 = Number(m[2]);
  const c2 = m[3] ? colNumber(m[3]) : c1; const r2 = m[4] ? Number(m[4]) : r1;
  return (Math.abs(c2 - c1) + 1) * (Math.abs(r2 - r1) + 1);
}

/** Cellules fusionnées déclarées dans le XML d'une feuille. */
function mergedCellsInXml(xml) {
  const text = String(xml || '');
  const start = text.search(/<(?:\w+:)?mergeCells\b/);
  if (start < 0) return 0;
  let total = 0;
  for (const m of text.slice(start).matchAll(MERGE_REF)) total += refArea(m[1]);
  return total;
}

/**
 * Charge un classeur après les gardes. Lève une AppError 400 (classeur refusé)
 * ou 413 (trop volumineux une fois décompressé) ; une autre erreur signifie
 * « fichier illisible », à traduire par l'appelant.
 * @param {Buffer} buffer
 * @param {{ zipLimits?: object, maxMergedCells?: number }} [opts]
 * @returns {Promise<ExcelJS.Workbook>}
 */
async function loadWorkbook(buffer, { zipLimits = DEFAULT_ZIP_LIMITS, maxMergedCells = MAX_MERGED_CELLS } = {}) {
  const sniff = sniffFile(buffer);
  if (sniff.entries) {
    assertZipEntries(sniff.entries, zipLimits, { archiveBytes: buffer.length }); // 413 / 400 AVANT décompression
    const zip = new AdmZip(buffer);
    let merged = 0;
    for (const e of sniff.entries) {
      if (e.isDirectory || !SHEET_XML.test(e.name)) continue;
      merged += mergedCellsInXml(zip.getEntry(e.name).getData().toString('latin1'));
      if (merged > maxMergedCells) {
        throw badRequest(`Classeur refusé par sécurité : il fusionne plus de ${maxMergedCells.toLocaleString('fr-FR')} cellules. `
          + 'Défusionnez les grandes zones (Accueil › Fusionner et centrer), enregistrez, puis réessayez.');
      }
    }
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer, { ignoreNodes: IGNORE_NODES });
  return wb;
}

/** Erreur de chargement à laisser passer telle quelle (refus motivé) plutôt que « illisible ». */
const isRefusal = (err) => Boolean(err && err.statusCode && err.statusCode < 500);

module.exports = { loadWorkbook, isRefusal, refArea, mergedCellsInXml, MAX_MERGED_CELLS, IGNORE_NODES };
