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
 *   fréquence ajustée (CO adjusted) = fréquence × ratio
 *   intervalle ajusté (CO adjusted) = max(durée ÷ fréquence ajustée, 1)
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
  // « CO adjusted » du classeur : ce que la capacité permet réellement.
  //   fréquence ajustée  = fréquence × (faisable ÷ ciblé)
  //   intervalle ajusté  = max(durée ÷ fréquence ajustée, 1)
  // Calculés sur les valeurs exactes (comme Excel), arrondis à l'affichage seulement.
  const adjFreqExact = coverageRatio != null ? (dur / (dur / risk)) * (feas / (sites / (dur / risk))) : null;
  const adjustedFrequency = adjFreqExact != null ? round2(adjFreqExact) : null;
  const adjustedInterval = adjFreqExact > 0 ? round2(Math.max(dur / adjFreqExact, 1)) : null;

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
    adjustedFrequency,
    adjustedInterval,
    // Couverture suffisante si la capacité atteint la cible.
    feasibleMeetsTarget: coverageRatio == null ? null : coverageRatio >= 1,
  };
}


// Champs SAISIS d'un paramètre MMR (le reste est dérivé par deriveMmr).
const MMR_INPUT_FIELDS = ['operationDuration', 'numberOfSites', 'riskLevel', 'feasible', 'personsToDeploy', 'visitsPerDay', 'workingDays', 'note'];

/**
 * Vue d'un périmètre : plan général (officeId nul) ou bureau. Pour un bureau,
 * chaque catégorie du plan général est HÉRITÉE sauf si une dérogation existe ;
 * une dérogation sans catégorie générale correspondante apparaît aussi.
 * @param {Array<object>} rows  lignes stockées ({ id, fieldOfficeId|null, activityCategory, …saisies })
 * @param {string|null} officeId
 * @returns {Array<{ activityCategory, general, override, effective, inherited }>}
 *   `effective` = valeurs saisies retenues + champs dérivés (deriveMmr).
 */
function resolvePlan(rows = [], officeId = null) {
  const general = new Map(); const overrides = new Map();
  for (const r of rows) {
    if (!r.fieldOfficeId) general.set(r.activityCategory, r);
    else if (officeId && r.fieldOfficeId === officeId) overrides.set(r.activityCategory, r);
  }
  const cats = [...new Set([...general.keys(), ...overrides.keys()])].sort((a, b) => a.localeCompare(b, 'fr'));
  return cats.map((c) => {
    const g = general.get(c) || null;
    const o = officeId ? overrides.get(c) || null : null;
    const src = o || g;
    const input = Object.fromEntries(MMR_INPUT_FIELDS.map((k) => [k, src[k] ?? null]));
    return { activityCategory: c, general: g, override: o, inherited: Boolean(officeId && !o), effective: { ...input, ...deriveMmr(input) } };
  });
}

/**
 * Totaux d'un plan résolu : sites, cible mensuelle, capacité et couverture
 * globale (capacité ÷ cible, sur les seules lignes qui ont une capacité).
 */
function summarizePlan(plan = []) {
  let sites = 0; let targeted = 0; let feasible = 0; let targetedWithCap = 0;
  for (const { effective: e } of plan) {
    sites += e.numberOfSites || 0;
    targeted += e.targetedPerMonth || 0;
    if (e.feasible != null) { feasible += e.feasible; targetedWithCap += e.targetedPerMonth || 0; }
  }
  return {
    categories: plan.length,
    overrides: plan.filter((p) => p.override).length,
    sites,
    targetedPerMonth: round2(targeted),
    feasible: round2(feasible),
    coverageRatio: targetedWithCap > 0 ? round2(feasible / targetedWithCap) : null,
  };
}

/**
 * Sites du référentiel par catégorie pour un périmètre. `registry` = lignes
 * agrégées en SQL { activity, officeId, parentId, n } ; un site rattaché à une
 * antenne compte aussi pour son bureau parent. officeId nul = tous les sites.
 * @returns {Map<string, number>}
 */
function registryCounts(registry = [], officeId = null) {
  const out = new Map();
  for (const r of registry) {
    if (!r.activity) continue;
    if (officeId && r.officeId !== officeId && r.parentId !== officeId) continue;
    out.set(r.activity, (out.get(r.activity) || 0) + Number(r.n || 0));
  }
  return out;
}

module.exports = { deriveMmr, round2, resolvePlan, summarizePlan, registryCounts, MMR_INPUT_FIELDS };
