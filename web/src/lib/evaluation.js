// Grilles d'appréciation et bandes de notes — MIROIR d'affichage de
// server/src/modules/evaluation/gridScore.js (même arithmétique entière, parité testée par
// server/test/gridScore.test.js). Le serveur reste la source : il recalcule et fige les notes ;
// ce miroir ne sert qu'à l'aperçu pendant la saisie.

export const SCALE = 20;
export const RATINGS = [
  { value: 1, label: 'Insuffisant', tone: 'red' },
  { value: 2, label: 'À améliorer', tone: 'orange' },
  { value: 3, label: 'Satisfaisant', tone: 'green' },
  { value: 4, label: 'Très bien', tone: 'green' },
];

// Bandes : couleur + icône + libellé (jamais la couleur seule).
export const BANDS = {
  excellent: { min: 16, label: 'Excellent', tone: 'green', icon: 'check' },
  bon: { min: 12, label: 'Bon', tone: 'green', icon: 'check' },
  moyen: { min: 10, label: 'Moyen', tone: 'orange', icon: 'warn' },
  insuffisant: { min: 0, label: 'Insuffisant', tone: 'red', icon: 'x' },
};
const BAND_ORDER = ['excellent', 'bon', 'moyen', 'insuffisant'];

export const EVAL_STATUS = {
  brouillon: { label: 'Brouillon', tone: null, icon: 'draft' },
  validee: { label: 'Validée', tone: 'green', icon: 'check' },
};

const weightUnits = (w) => Math.round(Number(w) * 100);
const roundDiv = (n, d) => Math.floor((2 * n + d) / (2 * d));
const ratingOf = (r) => { const n = Number(r); return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null; };

/** Note d'une grille sur 20 (critères notés seulement) ; null sans note. */
export function gridScore(answers) {
  let num = 0; let den = 0; let rated = 0; let total = 0;
  for (const a of answers || []) {
    const w = weightUnits(a.weight);
    if (!(w > 0)) continue;
    total += 1;
    const r = ratingOf(a.rating);
    if (r != null) { num += w * (r - 1); den += w; rated += 1; }
  }
  return { score: den ? roundDiv(SCALE * 10 * num, 3 * den) / 10 : null, rated, total, complete: total > 0 && rated === total };
}

/** Bande d'une note sur 20 (code) ; null sans note. */
export function bandOf(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  return BAND_ORDER.find((k) => Number(score) >= BANDS[k].min);
}

/** « 13,3 / 20 » dans la langue de l'écran. */
export function formatScore(score, lang = 'fr') {
  if (score == null) return '—';
  return `${Number(score).toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / ${SCALE}`;
}
