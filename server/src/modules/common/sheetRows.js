/**
 * Lecture bornée des lignes d'une feuille ExcelJS — pour tous les imports.
 *
 * ExcelJS range les cellules d'une ligne dans un tableau indexé par colonne : une
 * ligne dont la seule cellule est en XFD donne un tableau creux de 16 384 places,
 * que `eachCell`, `row.values` ou `hasValues` (donc `eachRow`) parcourent ou
 * recopient en entier ; `actualRowCount` et `columnCount` reparcourent toute la
 * feuille à CHAQUE appel ; `getRow` / `getCell` créent ce qui n'existe pas.
 * Ici on ne touche que les cellules utiles (`findRow` / `findCell`), dans des
 * bornes calculées une fois. La garde `xlsxGuard` plafonne en plus, par classeur,
 * le total des places de ces tableaux.
 */
const { badRequest } = require('../../middleware/errors');

/** Largeur maximale d'un tableau lu ligne à ligne (XLSForm, découpage, en-têtes). */
const MAX_TABLE_COLUMNS = 1024;
/** Dernière colonne d'une feuille Excel (XFD). */
const MAX_SHEET_COLUMNS = 16384;

const isEmptyValue = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const filled = (cell) => Boolean(cell) && !isEmptyValue(cell.value);

/**
 * Dernière colonne non vide d'une ligne parmi les `cap` premières, et si une
 * valeur existe au-delà (`beyond`).
 */
function filledWidth(row, cap = MAX_TABLE_COLUMNS) {
  if (!row) return { width: 0, beyond: false };
  const n = row.cellCount;
  let beyond = false;
  for (let c = n; c > cap; c -= 1) if (filled(row.findCell(c))) { beyond = true; break; }
  let width = Math.min(n, cap);
  while (width > 0 && !filled(row.findCell(width))) width -= 1;
  return { width, beyond };
}

/** Cellules 1..width d'une ligne passées à `read` (tableau de longueur `width`, trous = undefined). */
function rowValues(row, width, read = (cell) => cell.value) {
  const out = new Array(width);
  const w = Math.min(width, row ? row.cellCount : 0);
  for (let c = 1; c <= w; c += 1) {
    const cell = row.findCell(c);
    if (cell) out[c - 1] = read(cell);
  }
  return out;
}

/** Une valeur non vide parmi les colonnes 1..width ? */
function hasValueWithin(row, width) {
  const w = Math.min(width, row ? row.cellCount : 0);
  for (let c = 1; c <= w; c += 1) if (filled(row.findCell(c))) return true;
  return false;
}

/** Lignes existantes, de `from` à la dernière ligne de la feuille (borne lue une fois). */
function* existingRows(ws, from = 1) {
  const last = ws.rowCount;
  for (let r = Math.max(1, from); r <= last; r += 1) {
    const row = ws.findRow(r);
    if (row) yield { row, r };
  }
}

/**
 * Feuille → lignes non vides en tableaux de valeurs, à la largeur de la première
 * ligne non vide (l'en-tête). Une valeur d'en-tête au-delà de `cap` colonnes
 * refuse le classeur (400) au lieu de faire lire 16 384 colonnes par ligne.
 * @returns {Array<Array<*>>} comme `row.values.slice(1)` par ligne, en-tête compris
 */
function sheetTable(ws, { cap = MAX_TABLE_COLUMNS, read } = {}) {
  const rows = [];
  let width = null;
  for (const { row } of existingRows(ws)) {
    if (width === null) {
      const head = filledWidth(row, cap);
      if (head.beyond) {
        throw badRequest(`Feuille « ${ws.name} » refusée : son en-tête dépasse ${cap.toLocaleString('fr-FR')} colonnes. `
          + 'Supprimez les colonnes inutiles, enregistrez, puis réessayez.');
      }
      if (!head.width) continue;
      width = head.width;
    } else if (!hasValueWithin(row, width)) continue;
    rows.push(rowValues(row, width, read));
  }
  return rows;
}

module.exports = { MAX_TABLE_COLUMNS, MAX_SHEET_COLUMNS, filledWidth, rowValues, hasValueWithin, existingRows, sheetTable };
