/**
 * MMR — Minimum Monitoring Requirements (logique pure, testée).
 *
 * Reproduit la logique de la feuille « Overarching parameters » du Plan de
 * suivi : par bureau × catégorie d'activité, à partir de la durée d'opération,
 * du nombre de sites et du niveau de risque, on dérive l'intervalle minimal
 * entre visites, la fréquence minimale, le nombre de sites ciblés par mois et
 * le ratio de faisabilité. Formules du fichier (vérifiées) :
 *   intervalle  = durée ÷ niveau de risque
 *   fréquence   = durée ÷ intervalle           (= niveau de risque)
 *   ciblé/mois  = nombre de sites ÷ intervalle
 *   ratio       = faisable ÷ ciblé
 * Niveau de risque : 1 = faible, 2 = moyen, 3 = élevé (plus élevé ⇒ intervalle
 * plus court ⇒ on visite plus souvent).
 */

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * @param {object} p
 * @param {number} p.operationDuration  mois d'opération dans l'année (>0)
 * @param {number} p.numberOfSites      nombre de sites actifs
 * @param {number} p.riskLevel          1 | 2 | 3
 * @param {number} [p.feasible]         capacité réelle (sites/mois)
 */
function deriveMmr({ operationDuration, numberOfSites, riskLevel, feasible } = {}) {
  const dur = Number(operationDuration) || 0;
  const sites = Number(numberOfSites) || 0;
  const risk = Number(riskLevel) || 0;
  const feas = feasible == null ? null : Number(feasible);

  const interval = risk > 0 ? round2(dur / risk) : null;                 // mois entre 2 visites
  const frequency = interval > 0 ? round2(dur / interval) : 0;           // nb de visites sur la période
  const targetedPerMonth = interval > 0 ? round2(sites / interval) : null; // sites à visiter / mois
  const coverageRatio = (feas != null && targetedPerMonth > 0) ? round2(feas / targetedPerMonth) : null;

  return {
    operationDuration: dur,
    numberOfSites: sites,
    riskLevel: risk,
    interval,
    frequency,
    targetedPerMonth,
    feasible: feas,
    coverageRatio,
    // Couverture suffisante si la capacité atteint la cible.
    feasibleMeetsTarget: coverageRatio == null ? null : coverageRatio >= 1,
  };
}

module.exports = { deriveMmr, round2 };
