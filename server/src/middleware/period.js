const { parsePeriod } = require('../modules/common/period');
const { badRequest } = require('./errors');

/**
 * Période d'une requête HTTP — la règle unique common/period.parsePeriod au bord :
 * `?month=AAAA-MM` (rétrocompatible) ou `?from=AAAA-MM&to=AAAA-MM`, bornes incluses.
 * Renvoie { from, to } ou null (aucun paramètre, période facultative) ; toute
 * période mal formée lève un 400 avec `details.code` (period_format, period_partial,
 * period_ambiguous, period_order, period_span, period_year, period_required),
 * que l'interface traduit. Le module pur n'importe pas errors.js (qui charge db/schemaStatus).
 *
 * @param {object} src  req.query, ou le corps déjà validé (req.valid)
 * @param {{ required?: boolean, maxSpan?: number }} [opts]
 */
function readPeriod(src, opts) {
  const r = parsePeriod(src, opts);
  if (!r.ok) throw badRequest(r.message, { code: r.code, ...r.details });
  return r.period;
}

module.exports = { readPeriod };
