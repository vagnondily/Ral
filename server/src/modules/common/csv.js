/**
 * Écriture CSV sûre — logique PURE (testée, sans I/O), miroir de web/src/lib/csv.js.
 *
 * Neutralisation des formules (« CSV injection ») : une cellule TEXTE qui commence
 * par = + - @ (ou tabulation / retour chariot / saut de ligne) serait exécutée par
 * Excel ou LibreOffice à l'ouverture (=HYPERLINK, =WEBSERVICE, DDE…). Elle est
 * préfixée d'une apostrophe. Un nombre reste un nombre : une valeur numérique
 * (type number) n'est jamais touchée, et un texte qui n'est qu'un nombre négatif
 * (« -12 », « -1 234,50 », « -12 % ») non plus — il ne peut appeler aucune fonction.
 * Mesuré sur les fichiers réels : 344 coordonnées GPS négatives stockées en texte
 * (suivi Résilience) restent des nombres ; le tiret seul « - » (case vide du
 * classeur RBM) reste aussi tel quel.
 */
const FORMULA_START = /^[=+\-@\t\r\n]/;
// Tiret seul, ou nombre négatif éventuellement formaté (espaces de milliers — \s
// couvre les espaces insécables —, virgule ou point, %) : sans danger, laissé tel quel.
const NEGATIVE_NUMBER = /^-(?:(?=[\d\s.,]*\d)[\d\s.,]*%?)?$/;
const BOM = String.fromCharCode(0xfeff);

/** Valeur de cellule neutralisée (texte) ; nombre et vide laissés tels quels. */
function neutralizeFormula(v) {
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  const s = String(v);
  return FORMULA_START.test(s) && !NEGATIVE_NUMBER.test(s) ? `'${s}` : s;
}

/** Cellule CSV : neutralisée, puis entre guillemets si elle contient le séparateur, « " » ou un saut de ligne. */
function csvCell(v, sep = ';') {
  const s = neutralizeFormula(v);
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Fichier CSV complet (lignes = tableaux de cellules). BOM UTF-8 et « ; » par
 * défaut : c'est ce qu'Excel en français ouvre correctement.
 */
function toCsv(rows, { sep = ';', eol = '\r\n', bom = true } = {}) {
  const body = rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join(eol);
  return `${bom ? BOM : ''}${body}${eol}`;
}

const isUnsafeFilenameChar = (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '"\\/'.includes(c);

/**
 * En-tête Content-Disposition sûr pour un téléchargement : nom ASCII de repli
 * (sans guillemet, barre ni caractère de contrôle) + nom UTF-8 (RFC 5987), pour
 * qu'un libellé saisi par l'utilisateur ne casse ni l'en-tête ni la réponse.
 */
function attachmentHeader(filename) {
  const name = [...String(filename || 'export')].map((c) => (isUnsafeFilenameChar(c) ? '_' : c)).join('').trim() || 'export';
  const ascii = name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^ -~]+/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Taux (0–1) écrit pour Excel en français : pourcentage arrondi à `digits` décimales, virgule
 * décimale, signe « % » collé — « 12,3% » (lu comme le nombre 0,123 au format pourcentage ;
 * « 12.3% » resterait du texte) ; vide sans taux.
 */
function csvPercent(rate, digits = 1) {
  if (rate == null || rate === '' || !Number.isFinite(Number(rate))) return '';
  const k = 10 ** digits;
  return `${String(Math.round(Number(rate) * 100 * k) / k).replace('.', ',')}%`;
}

module.exports = { neutralizeFormula, csvCell, toCsv, csvPercent, attachmentHeader };
