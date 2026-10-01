/**
 * RBM — scoring multi-critères d'un site (logique pure, testée).
 *
 * Reproduit la logique du bloc « RBM » du Plan de suivi : chaque site porte des
 * critères de risque qui, agrégés, donnent un FINAL SCORE (0 = faible, 1 =
 * moyen, 2 = élevé) et une PRIORITÉ, combinés au retard de visite (temps écoulé
 * depuis la dernière visite vs intervalle MMR). Les pondérations sont
 * transparentes et ajustables ici — les cellules du fichier contiennent des
 * valeurs calculées par macro, pas des formules ; on reproduit les bandes
 * documentées (issues/CFM/fraude urgents ⇒ priorité haute).
 *
 * Critères (tous optionnels, défaut 0) :
 *   security          0 = pas de restriction, 1 = modérée, 2 = élevée
 *   synergies         0 = une seule activité dans la commune, 1 = plusieurs
 *   beneficiaryOver200 0 = ≤200 bénéficiaires, 1 = >200 (caseload)
 *   newPartner        0 = partenaire expérimenté, 1 = nouveau partenaire
 *   issuesProcess     0 = aucun, 1 = important, 2 = urgent (suivi interne)
 *   issuesPartnerReport 0/1/2 (rapport partenaire)
 *   issuesCFM         0/1/2 (mécanisme de plainte)
 *   fraud             0 = non suspecté, 1 = suspecté
 */

function monthIndex(m) {
  if (!m) return null;
  const [y, mo] = String(m).slice(0, 7).split('-').map(Number);
  if (!y || !mo) return null;
  return y * 12 + (mo - 1);
}

/** Mois écoulés depuis la dernière visite jusqu'à targetMonth (null si jamais visité). */
function monthsSinceVisit(lastVisitMonth, targetMonth) {
  const a = monthIndex(lastVisitMonth);
  const b = monthIndex(targetMonth) ?? monthIndex(new Date().toISOString().slice(0, 7));
  if (a == null || b == null) return null;
  return b - a;
}

const FINAL_LABEL = { 0: 'Faible', 1: 'Moyen', 2: 'Élevé' };
const PRIORITY_LABEL = { 0: 'Basse', 1: 'Moyenne', 2: 'Haute' };

/**
 * @param {object} site   critères ci-dessus + lastVisitMonth
 * @param {object} opts   { targetMonth:'YYYY-MM', mmrInterval:number }
 */
function scoreSite(site = {}, { targetMonth, mmrInterval } = {}) {
  const n = (v) => Math.max(0, Number(v) || 0);
  const security = Math.min(2, n(site.security));
  const synergies = Math.min(1, n(site.synergies));
  const caseload = Math.min(1, n(site.beneficiaryOver200));
  const newPartner = Math.min(1, n(site.newPartner));
  const issP = Math.min(2, n(site.issuesProcess));
  const issR = Math.min(2, n(site.issuesPartnerReport));
  const issC = Math.min(2, n(site.issuesCFM));
  const fraud = Math.min(1, n(site.fraud));

  // Drapeaux urgents : tout problème « urgent » (=2), fraude suspectée ou
  // sécurité élevée ⇒ attention immédiate.
  const urgentFlags = issP === 2 || issR === 2 || issC === 2 || fraud === 1 || security === 2;

  // Points de risque cumulés (vue d'ensemble).
  const riskPoints = security + synergies + caseload + newPartner + issP + issR + issC + 2 * fraud;

  // FINAL SCORE (0/1/2).
  let finalScore;
  if (urgentFlags) finalScore = 2;
  else if (riskPoints >= 4) finalScore = 2;
  else if (riskPoints >= 2) finalScore = 1;
  else finalScore = 0;

  // Retard de visite vs intervalle MMR.
  const since = monthsSinceVisit(site.lastVisitMonth, targetMonth);
  const neverVisited = since == null;
  const interval = Number(mmrInterval) > 0 ? Number(mmrInterval) : null;
  const overdue = neverVisited || (interval != null && since >= interval);

  // PRIORITÉ : combine le score et le retard.
  let priority;
  if (urgentFlags || (finalScore === 2 && overdue)) priority = 2;
  else if (finalScore === 2 || overdue || finalScore === 1) priority = 1;
  else priority = 0;

  // « À suivre ce mois » : en retard (ou jamais visité), modulé par la priorité.
  const due = overdue;

  return {
    finalScore,
    finalLabel: FINAL_LABEL[finalScore],
    priority,
    priorityLabel: PRIORITY_LABEL[priority],
    riskPoints,
    urgentFlags,
    monthsSinceVisit: since,
    neverVisited,
    overdue,
    due,
  };
}

module.exports = { scoreSite, monthsSinceVisit, FINAL_LABEL, PRIORITY_LABEL };
