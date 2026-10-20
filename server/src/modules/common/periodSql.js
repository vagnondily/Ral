const { periodBounds, monthDates } = require('./period');

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

/*
 * Mois COCHÉS (retour 68, { from, to, months }) : la plage reste la borne (index), et seul un mois
 * de la liste compte (`date_trunc('month', col) = ANY(liste)`) — une date du 15 reste dans son mois.
 */
/** Paramètre « liste des 1ers jours des mois cochés » ; null pour une plage. */
function monthListParam(period, params) {
  const dates = monthDates(period);
  if (!dates) return null;
  params.push(dates);
  return `$${params.length}::date[]`;
}

/** `col` dans la période ; 'TRUE' sans période (aucun paramètre poussé). */
function monthWithin(col, period, params) {
  if (!period) return 'TRUE';
  const { lo, hiExcl } = periodBounds(period);
  params.push(lo, hiExcl);
  const range = `${col} >= $${params.length - 1}::date AND ${col} < $${params.length}::date`;
  const list = monthListParam(period, params);
  return list ? `${range} AND date_trunc('month', ${col})::date = ANY(${list})` : range;
}

/**
 * L'intervalle [startCol, COALESCE(endCol, startCol)] chevauche la période
 * (ex. une facture pluri-mensuelle period_month…period_end). 'TRUE' sans période.
 */
function spanOverlaps(startCol, endCol, period, params) {
  if (!period) return 'TRUE';
  const { lo, hiExcl } = periodBounds(period);
  params.push(hiExcl, lo);
  const range = `${startCol} < $${params.length - 1}::date AND COALESCE(${endCol}, ${startCol}) >= $${params.length}::date`;
  const list = monthListParam(period, params);
  // Mois cochés : l'intervalle doit toucher au moins UN mois de la liste.
  return list
    ? `${range} AND EXISTS (SELECT 1 FROM unnest(${list}) AS pm(m) WHERE ${startCol} < pm.m + interval '1 month' AND COALESCE(${endCol}, ${startCol}) >= pm.m)`
    : range;
}

/**
 * Série des mois de la période (1er de chaque mois, timestamp) : `generate_series(...)` — ou les seuls
 * mois cochés (`unnest(...)`) —, à nommer par l'appelant.
 */
function monthSeries(period, params) {
  const dates = monthDates(period);
  if (dates) { params.push(dates); return `unnest($${params.length}::timestamp[])`; }
  const { lo, hi } = periodBounds(period);
  params.push(lo, hi);
  return `generate_series($${params.length - 1}::date, $${params.length}::date, interval '1 month')`;
}

module.exports = { monthWithin, spanOverlaps, monthSeries, monthListParam };
