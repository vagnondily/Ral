const { periodBounds } = require('./period');

/**
 * Prédicats SQL d'une période (lot 1b) — constructeur de fragments, comme
 * tpm/sitePatch.js et db/batch.js : seuls les dépôts l'utilisent. Chaque
 * fonction POUSSE ses paramètres dans `params` et renvoie le texte du fragment.
 *
 * Bornes : intervalle SEMI-OUVERT `col >= 'from-01' AND col < 'to+1-01'`. Les
 * colonnes period_month de monitoring_submissions, pdd_distributions et pdd_stock
 * n'ont pas de contrainte « jour = 1 » : un BETWEEN 'from-01' AND 'to-01'
 * perdrait une date du 15 ; la borne semi-ouverte est sûre par construction.
 */

/** `col` dans la période ; 'TRUE' sans période (aucun paramètre poussé). */
function monthWithin(col, period, params) {
  if (!period) return 'TRUE';
  const { lo, hiExcl } = periodBounds(period);
  params.push(lo, hiExcl);
  return `${col} >= $${params.length - 1}::date AND ${col} < $${params.length}::date`;
}

/**
 * L'intervalle [startCol, COALESCE(endCol, startCol)] chevauche la période
 * (ex. une facture pluri-mensuelle period_month…period_end). 'TRUE' sans période.
 */
function spanOverlaps(startCol, endCol, period, params) {
  if (!period) return 'TRUE';
  const { lo, hiExcl } = periodBounds(period);
  params.push(hiExcl, lo);
  return `${startCol} < $${params.length - 1}::date AND COALESCE(${endCol}, ${startCol}) >= $${params.length}::date`;
}

/** Série des mois de la période (1er de chaque mois) : `generate_series(...)`, à nommer par l'appelant. */
function monthSeries(period, params) {
  const { lo, hi } = periodBounds(period);
  params.push(lo, hi);
  return `generate_series($${params.length - 1}::date, $${params.length}::date, interval '1 month')`;
}

module.exports = { monthWithin, spanOverlaps, monthSeries };
