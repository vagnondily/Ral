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
 * La capacité « faisable » (sites/mois) peut être SAISIE directement, ou
 * CALCULÉE à partir des ressources : personnes à déployer × suivis par jour
 * (par activité, paramétrable) × jours ouvrés par mois. Quand les trois sont
 * fournis, la capacité calculée prime sur la valeur saisie.
 *
 * @param {object} p
 * @param {number} p.operationDuration  mois d'opération dans l'année (>0)
 * @param {number} p.numberOfSites      nombre de sites actifs
 * @param {number} p.riskLevel          1 | 2 | 3
 * @param {number} [p.feasible]         capacité réelle saisie (sites/mois)
 * @param {number} [p.personsToDeploy]  nb de personnes à déployer
 * @param {number} [p.visitsPerDay]     suivis réalisables par jour et par personne
 * @param {number} [p.workingDays]      jours ouvrés par mois
 */
function deriveMmr({ operationDuration, numberOfSites, riskLevel, feasible, personsToDeploy, visitsPerDay, workingDays } = {}) {
  const dur = Number(operationDuration) || 0;
  const sites = Number(numberOfSites) || 0;
  const risk = Number(riskLevel) || 0;
  const manualFeas = feasible == null || feasible === '' ? null : Number(feasible);

  const persons = Number(personsToDeploy) || 0;
  const perDay = Number(visitsPerDay) || 0;
  const days = Number(workingDays) || 0;
  const computedCapacity = (persons > 0 && perDay > 0 && days > 0) ? round2(persons * perDay * days) : null;
  const feas = computedCapacity != null ? computedCapacity : manualFeas;

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
    personsToDeploy: persons || null,
    visitsPerDay: perDay || null,
    workingDays: days || null,
    computedCapacity,
    feasible: feas,
    feasibleSource: computedCapacity != null ? 'calculée' : (manualFeas != null ? 'saisie' : null),
    coverageRatio,
    // Couverture suffisante si la capacité atteint la cible.
    feasibleMeetsTarget: coverageRatio == null ? null : coverageRatio >= 1,
  };
}

module.exports = { deriveMmr, round2 };
