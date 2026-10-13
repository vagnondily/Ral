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
 * Critères (tous optionnels, défaut 0) — échelles du classeur RBM (Sheet4) :
 *   security          0 = pas de restriction, 1 = modérée, 3 = stricte, 99 = zone interdite
 *                     (l'ancienne valeur MEMS 2 = « élevée » est lue comme stricte)
 *   synergies         0 = une seule activité dans la commune, 1 = plusieurs
 *   beneficiaryNumber nombre de bénéficiaires (> 200 = caseload élevé) ; à défaut
 *   beneficiaryOver200 0 = ≤200, 1 = >200
 *   newPartner        0 = partenaire expérimenté, 1 = nouveau partenaire
 *   experiencedPartner 0 = bonne expérience, 1 = moyenne, 2 = mauvaise
 *   issuesProcess     0 = aucun, 1 = important, 2 = urgent (suivi interne)
 *   issuesPartnerReport 0/1/2 (rapport partenaire)
 *   issuesCFM         0/1/2 (mécanisme de plainte)
 *   fraud             0 = non suspecté, 1 = fraude suspectée, 2 = partenaire impliqué
 * Une zone interdite (99) est signalée `forbidden` : ni proposée ni planifiée.
 *
 * Retour n° 48 — un drapeau sans justification est incompréhensible : le score
 * rend aussi `reasons` (chaque règle qui a compté, avec la valeur du site et ses
 * points, urgentes d'abord), `consequence` (niveau, priorité, fréquence, état de
 * la visite) et `actions` (que faire, et pour quel mois). Ces explications
 * dérivent des MÊMES valeurs que le score : la somme des points des raisons est
 * exactement `riskPoints`.
 */
const { addMonths, toMonth, currentMonth } = require('./rbmMath');

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

// Libellés des valeurs (échelles du classeur) — phrases françaises, traduites à l'écran.
const SECURITY_LABEL = { 0: 'Pas de restriction', 1: 'Restriction modérée', 3: 'Restriction stricte', 99: 'Zone interdite' };
const ISSUE_LABEL = { 0: 'Aucun', 1: 'Important', 2: 'Urgent' };
const FRAUD_LABEL = { 0: 'Non suspectée', 1: 'Fraude suspectée', 2: 'Partenaire impliqué' };
const EXPERIENCE_LABEL = { 0: 'Bonne expérience', 1: 'Expérience moyenne', 2: 'Mauvaise expérience' };
const ISSUE_CRITERIA = [
  ['issuesProcess', 'Problème de processus (suivi interne)'],
  ['issuesPartnerReport', 'Problème de rapport partenaire'],
  ['issuesCFM', 'Problème signalé par le mécanisme de plainte (CFM)'],
];

// Pourquoi la priorité : chaque cas correspond à UNE branche de la règle (et à sa priorité).
const PRIORITY_OF_BASIS = { urgent: 2, highOverdue: 2, high: 1, overdue: 1, medium: 1, low: 0 };

function priorityBasisOf({ urgentFlags, finalScore, overdue }) {
  if (urgentFlags) return 'urgent';
  if (finalScore === 2 && overdue) return 'highOverdue';
  if (finalScore === 2) return 'high';
  if (overdue) return 'overdue';
  if (finalScore === 1) return 'medium';
  return 'low';
}

const reason = (code, label, value, valueLabel, points, urgent) => ({ code, label, value, valueLabel, points, urgent });

/** Une raison par critère qui a compté (points > 0), urgentes d'abord puis par points décroissants. */
function riskReasons(c) {
  const out = [];
  if (c.security > 0) out.push(reason('security', 'Situation sécuritaire', c.securityValue, SECURITY_LABEL[c.securityValue] || null, c.security, c.security === 2));
  for (const [code, label] of ISSUE_CRITERIA) {
    if (c[code] > 0) out.push(reason(code, label, c[code], ISSUE_LABEL[c[code]] || null, c[code], c[code] === 2));
  }
  if (c.fraud > 0) out.push(reason('fraud', 'Fraude et corruption', c.fraud, FRAUD_LABEL[c.fraud] || null, 2 * c.fraud, true));
  if (c.synergies > 0) out.push(reason('synergies', 'Synergies de programme', c.synergies, 'Plusieurs activités dans la commune', c.synergies, false));
  if (c.caseload > 0) out.push(reason('caseload', 'Taille (bénéficiaires)', c.beneficiaryNumber ?? c.caseload, 'Plus de 200 bénéficiaires', c.caseload, false));
  if (c.newPartner > 0) out.push(reason('newPartner', 'Partenaire', c.newPartner, 'Nouveau partenaire', c.newPartner, false));
  if (c.experienced > 0) out.push(reason('experiencedPartner', 'Expérience du partenaire', c.experienced, EXPERIENCE_LABEL[c.experienced] || null, c.experienced, false));
  return out.sort((a, b) => (Number(b.urgent) - Number(a.urgent)) || (b.points - a.points));
}

/**
 * Que faire : actions courtes et factuelles tirées des raisons et de l'état de
 * la visite, chacune avec le mois concerné (null si aucun mois ne s'applique).
 */
function recommendedActions(c) {
  const out = [];
  const month = c.targetMonth;
  const nextVisit = c.due ? month : (c.nextPlannedMonth || c.nextDueMonth || null);
  if (c.forbidden) out.push({ code: 'remote', label: 'Zone interdite : suivi à distance uniquement', month });
  if (c.fraud > 0) out.push({ code: 'fraud', label: 'Signaler et planifier une vérification ciblée', month });
  if (c.securityStrict && !c.forbidden) {
    out.push({ code: 'security', label: "Vérifier les conditions de sécurité et l'autorisation d'accès avant de planifier", month });
  }
  const issues = ISSUE_CRITERIA.filter(([k]) => c[k] > 0).map(([k]) => k);
  if (issues.length) {
    out.push({ code: 'issues', label: 'Vérifier le problème signalé (processus / rapport / CFM) lors de la prochaine visite', refs: issues, month: c.forbidden ? null : nextVisit });
  }
  if (c.forbidden) return out;
  if (c.latePlannedMonth && c.due) {
    out.push({ code: 'latePlanned', label: "Visite prévue non réalisée : la marquer « réalisée » si elle a eu lieu, sinon la replanifier", month: c.latePlannedMonth });
  }
  if (c.due && c.nextPlannedMonth === month) out.push({ code: 'doPlannedVisit', label: 'Réaliser la visite déjà prévue ce mois, puis la marquer « réalisée »', month });
  else if (c.due) out.push({ code: 'planVisit', label: 'Planifier une visite ce mois', month });
  else out.push({ code: 'notDue', label: 'Aucune visite requise ce mois — prochain suivi dû', month: c.nextDueMonth });
  return out;
}

/**
 * @param {object} site   critères ci-dessus + lastVisitMonth (dernière visite RÉALISÉE ou collecte
 *                        réelle, jamais une visite seulement planifiée) ; facultatifs pour les
 *                        actions : nextPlannedMonth / latePlannedMonth (rbmMath.plannedVisits)
 * @param {object} opts   { targetMonth:'YYYY-MM', mmrInterval:number }
 */
function scoreSite(site = {}, { targetMonth, mmrInterval } = {}) {
  const n = (v) => Math.max(0, Number(v) || 0);
  const secRaw = n(site.security);
  const forbidden = secRaw >= 99;
  const security = secRaw >= 2 ? 2 : secRaw; // 0 aucune, 1 modérée, 2 = stricte (3) ou interdite (99)
  const synergies = Math.min(1, n(site.synergies));
  const hasNumber = site.beneficiaryNumber != null && site.beneficiaryNumber !== '';
  const caseload = hasNumber ? (Number(site.beneficiaryNumber) > 200 ? 1 : 0) : Math.min(1, n(site.beneficiaryOver200));
  const newPartner = Math.min(1, n(site.newPartner));
  const experienced = Math.min(2, n(site.experiencedPartner));
  const issP = Math.min(2, n(site.issuesProcess));
  const issR = Math.min(2, n(site.issuesPartnerReport));
  const issC = Math.min(2, n(site.issuesCFM));
  const fraud = Math.min(2, n(site.fraud));

  // Drapeaux urgents : tout problème « urgent » (=2), fraude suspectée ou
  // avérée, restriction stricte ou zone interdite ⇒ attention immédiate.
  const urgentFlags = issP === 2 || issR === 2 || issC === 2 || fraud >= 1 || security === 2;

  // Points de risque cumulés (vue d'ensemble).
  const riskPoints = security + synergies + caseload + newPartner + experienced + issP + issR + issC + 2 * fraud;

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

  // PRIORITÉ : combine le score et le retard (une branche = une justification).
  const priorityBasis = priorityBasisOf({ urgentFlags, finalScore, overdue });
  const priority = PRIORITY_OF_BASIS[priorityBasis];

  // « À suivre ce mois » : en retard (ou jamais visité), modulé par la priorité.
  const due = overdue;

  const target = toMonth(targetMonth) || currentMonth();
  const lastVisitMonth = toMonth(site.lastVisitMonth);
  const consequence = {
    finalScore, finalLabel: FINAL_LABEL[finalScore], basis: urgentFlags ? 'urgent' : 'points', riskPoints,
    priority, priorityLabel: PRIORITY_LABEL[priority], priorityBasis,
    frequencyMonths: interval,
    targetMonth: target, lastVisitMonth, monthsSinceVisit: since, neverVisited, overdue, due,
    nextDueMonth: lastVisitMonth && interval != null ? addMonths(lastVisitMonth, interval) : null,
    nextPlannedMonth: toMonth(site.nextPlannedMonth), latePlannedMonth: toMonth(site.latePlannedMonth),
  };
  const criteria = {
    security, securityValue: normalizeSecurity(secRaw), securityStrict: security === 2, forbidden,
    synergies, caseload, beneficiaryNumber: hasNumber ? Number(site.beneficiaryNumber) : null,
    newPartner, experienced, issuesProcess: issP, issuesPartnerReport: issR, issuesCFM: issC, fraud,
  };

  return {
    finalScore,
    finalLabel: FINAL_LABEL[finalScore],
    priority,
    priorityLabel: PRIORITY_LABEL[priority],
    riskPoints,
    urgentFlags,
    forbidden,
    monthsSinceVisit: since,
    neverVisited,
    overdue,
    due,
    reasons: riskReasons(criteria),
    consequence,
    actions: recommendedActions({ ...criteria, ...consequence }),
  };
}

/**
 * Sécurité vers l'échelle du classeur (0, 1, 3, 99). L'ancienne valeur MEMS
 * 2 (« élevée ») et toute valeur intermédiaire deviennent 3 (stricte) ; ≥ 99
 * = zone interdite. Une seule règle pour les imports, le seed et l'API.
 */
function normalizeSecurity(v) {
  const n = Math.max(0, Math.round(Number(v) || 0));
  if (n >= 99) return 99;
  if (n >= 2) return 3;
  return n;
}

module.exports = {
  scoreSite, monthsSinceVisit, normalizeSecurity, FINAL_LABEL, PRIORITY_LABEL,
  SECURITY_LABEL, ISSUE_LABEL, FRAUD_LABEL, EXPERIENCE_LABEL,
};
