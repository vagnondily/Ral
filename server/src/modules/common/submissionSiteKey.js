/**
 * Clé UNIQUE d'un « site (données) » d'une soumission (lot 1b) — la même expression
 * SQL dans la Synthèse (processOverview), la Couverture & performance
 * (coverageDashboard), les résultats d'une fiche (dashboard) et le concepteur de
 * rapport (reportMonitoringData) : sur une période, les « sites distincts » de ces
 * écrans sont comptés de la même façon.
 *
 *  - site reconnu à l'import (site_id) : `id:<site>` — le même site, quelle que soit la fiche ;
 *  - sinon le code de site de la fiche : `code:<fiche>:<code>` — un code brut n'a de sens
 *    que dans SA fiche (le « 12 » d'une fiche n'est pas le « 12 » d'une autre) ;
 *  - jamais la commune (admin3) : une donnée rattachée seulement à la commune n'est pas
 *    une visite d'un site (définition commune) ; sans site, la soumission ne compte pas.
 * À distinguer de la couverture terrain (sites actifs / réalisés, visites) : libellé
 * « sites (données) » à l'écran.
 */
function submissionSiteKey(alias = 's') {
  const a = alias ? `${alias}.` : '';
  return `COALESCE('id:' || ${a}site_id::text, 'code:' || ${a}form_id::text || ':' || NULLIF(btrim(${a}site), ''))`;
}

module.exports = { submissionSiteKey };
