// Largeur des tableaux du concepteur de rapport (lot 7a, C7) — logique PURE, testée depuis le
// serveur (server/test/reportFit.test.js). Un tableau doit tenir dans la largeur imprimable de sa
// section : la police est réduite jusqu'à 0,8 ; au-delà, « trop large » → l'éditeur propose « Mettre
// ce bloc sur une page paysage » (jamais un tableau coupé à droite comme les 1 754 px du retour 18).
//
// Estimation (police Inter 9 pt, chiffres tabulaires) : un caractère ≈ 1,75 mm, un chiffre ≈ 1,8 mm,
// 3,6 mm de marges par cellule. Un texte peut aller à la ligne (largeur minimale = son mot le plus
// long, 14 caractères au moins pour rester lisible) ; un nombre jamais. L'en-tête va à la ligne
// (deux lignes) : seul son mot le plus long compte.

// En dessous de MIN_SCALE le tableau est « trop large » (on propose la page paysage), MAIS on
// continue à réduire la police jusqu'à RENDER_FLOOR pour qu'il TIENNE dans la page (un tableau serré
// est préférable à un tableau qui déborde). Entre les deux : il tient ET l'éditeur suggère le paysage.
export const MIN_SCALE = 0.8;
export const RENDER_FLOOR = 0.6;
const CHAR_MM = 1.75;
const DIGIT_MM = 1.8;
const PAD_MM = 3.6;
const NUMERIC = new Set(['int', 'dec', 'pct', 'money', 'rate', 'month', 'date']);

const longestWord = (s) => String(s == null ? '' : s).split(/[\s/–-]+/).reduce((m, w) => Math.max(m, w.length), 0);

/**
 * @param {{ key, type, label, maxChars?, maxWord? }[]} columns maxChars = valeur la plus longue
 *   (caractères), maxWord = mot le plus long des valeurs (texte)
 * @param {number} widthMm largeur imprimable
 * @returns {{ scale: number, widths: number[], needed: number, tooWide: boolean }}
 */
export function fitTable(columns, widthMm, { minScale = MIN_SCALE, renderFloor = RENDER_FLOOR } = {}) {
  const widths = (columns || []).map((c) => {
    const head = longestWord(c.label) * CHAR_MM * 0.9; // en-tête en petites capitales, plus serré
    if (NUMERIC.has(c.type)) return Math.max(head, (c.maxChars || 1) * DIGIT_MM) + PAD_MM;
    const word = Math.max(Math.min(c.maxChars || 0, 14), c.maxWord || 0);
    return Math.max(head, word * CHAR_MM) + PAD_MM;
  });
  const needed = widths.reduce((a, b) => a + b, 0);
  if (!(widthMm > 0) || needed <= widthMm) return { scale: 1, widths, needed, tooWide: false };
  const raw = widthMm / needed;
  // Échelle de rendu : réduite jusqu'à RENDER_FLOOR pour TENIR dans la page. « Trop large » (donc
  // suggestion paysage) dès que la réduction dépasse MIN_SCALE, même si le tableau tient encore.
  const scale = Math.max(renderFloor, Math.floor(raw * 100) / 100);
  return { scale, widths: widths.map((w) => w * scale), needed, tooWide: raw < minScale };
}

const cellText = (type, v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return String(v.text || '');
  if (type === 'int' || type === 'money') return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  if (type === 'pct' || type === 'rate') return `${Number(v).toFixed(1)} %`;
  if (type === 'dec') return Number(v).toFixed(1);
  if (type === 'band' || type === 'status') return 'Action urgente';
  return String(v);
};

/**
 * Colonnes d'un jeu de données prêtes pour fitTable (longueurs lues dans les lignes).
 * @param {{ columns: object[], rows: object[] }} data ; @param {string[]} [pick] colonnes choisies
 */
export function tableColumns(data, pick, { extra = [] } = {}) {
  const cols = (data && data.columns) || [];
  const chosen = pick && pick.length ? cols.filter((c) => pick.includes(c.key)) : cols;
  const rows = ((data && data.rows) || []).slice(0, 200);
  return [...chosen.map((c) => {
    let maxChars = 0; let maxWord = 0;
    for (const r of rows) {
      const s = cellText(c.type, r[c.key]);
      if (s.length > maxChars) maxChars = s.length;
      const w = longestWord(s);
      if (w > maxWord) maxWord = w;
    }
    return { key: c.key, type: c.type, label: c.label, maxChars, maxWord };
  }), ...extra];
}

/** Ajustement d'un tableau de données à une largeur (mm) : { scale, tooWide, … }. */
export const tableFit = (data, pick, widthMm, opts) => fitTable(tableColumns(data, pick, opts), widthMm);
