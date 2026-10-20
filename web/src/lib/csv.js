/**
 * Export CSV partagé — miroir de server/src/modules/common/csv.js (mêmes règles,
 * verrouillées par server/test/csv.test.js qui teste les deux).
 *
 * Neutralisation des formules (« CSV injection ») : une cellule TEXTE qui commence
 * par = + - @ (ou tabulation / retour chariot / saut de ligne) est préfixée d'une
 * apostrophe, sinon Excel l'exécuterait à l'ouverture. Un nombre reste un nombre :
 * une valeur numérique n'est jamais touchée, et un texte qui n'est qu'un nombre
 * négatif (« -12 », « -1 234,50 », « -12 % ») ou un tiret seul « - » non plus.
 */
const FORMULA_START = /^[=+\-@\t\r\n]/;
// Tiret seul, ou nombre négatif éventuellement formaté (\s couvre les espaces insécables) : sans danger.
const NEGATIVE_NUMBER = /^-(?:(?=[\d\s.,]*\d)[\d\s.,]*%?)?$/;
const BOM = String.fromCharCode(0xfeff);

/** Valeur de cellule neutralisée (texte) ; nombre et vide laissés tels quels. */
export function neutralizeFormula(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  const s = String(v);
  return FORMULA_START.test(s) && !NEGATIVE_NUMBER.test(s) ? `'${s}` : s;
}

/** Cellule CSV : neutralisée, puis entre guillemets si elle contient le séparateur, « " » ou un saut de ligne. */
export function csvCell(v, sep = ';') {
  const s = neutralizeFormula(v);
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Fichier CSV complet (lignes = tableaux de cellules) : BOM UTF-8 + « ; » pour Excel en français. */
export function toCsv(rows, { sep = ';', eol = '\r\n', bom = true } = {}) {
  const body = rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join(eol);
  return `${bom ? BOM : ''}${body}${eol}`;
}

/**
 * Taux (0–1) écrit pour Excel en français : pourcentage arrondi à `digits` décimales, virgule
 * décimale, signe « % » collé — « 12,3% » (lu comme le nombre 0,123 au format pourcentage ;
 * « 12.3% » resterait du texte) ; vide sans taux.
 */
export function csvPercent(rate, digits = 1) {
  if (rate == null || rate === '' || !Number.isFinite(Number(rate))) return '';
  const k = 10 ** digits;
  return `${String(Math.round(Number(rate) * 100 * k) / k).replace('.', ',')}%`;
}

/** Télécharge un CSV (première ligne = en-têtes) sous le nom donné. */
export function downloadCsv(filename, rows) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
