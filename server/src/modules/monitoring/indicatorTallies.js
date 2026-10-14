const {
  tallyIndicator, mergeTallies, resultFromTally, indicatorMeta, keyIndex, namesFor, explainFromTally,
} = require('./monitoringMath');
const { computeCalcFields } = require('./calcFields');

/**
 * Décomptes d'indicateurs ADDITIFS (lot 7a, C1) — logique PURE, sans I/O,
 * testée (test/indicatorTallies.test.js).
 *
 * Le dépôt lit les soumissions d'une fiche page par page (curseur, réponses
 * utiles seulement) et, pour chaque page et chaque groupe (bureau, mois…), fait
 * le décompte de chaque indicateur avec LA boucle du calcul
 * (monitoringMath.tallyIndicator) ; les décomptes se réunissent (mergeTallies)
 * sans relire les données. Valeur, base, classe et explication sont celles du
 * calcul d'un seul tenant (computeAll), au bit près — mémoire bornée à une page.
 *
 * Pourquoi pas un histogramme « variable × valeur » en SQL (conception initiale) :
 * mesuré sous RLS sur 18 000 soumissions × 60 indicateurs, jsonb_each + GROUP BY
 * coûte ~1 µs par réponse et par variable (2,4 s par fiche) contre 0,8 s pour la
 * lecture des seules réponses utiles + décompte JS (journal du lot 7a).
 */

/** Vrai si un indicateur lit un champ calculé (nom comparé sans la casse, comme indicatorKeys). */
function readsCalc(indicators, defs) {
  if (!defs || !defs.length) return false;
  const calc = new Set(defs.map((d) => String(d.name).toLowerCase()));
  return (indicators || []).some((i) => i.sourceField != null && calc.has(String(i.sourceField).toLowerCase()));
}

/**
 * Décomptes des indicateurs sur un lot de soumissions (une page, un groupe) — même
 * résolution que computeAll : champs calculés fusionnés, nom exact puis variantes de
 * casse (namesFor). Les champs calculés ne sont évalués que si un indicateur en lit un :
 * sinon aucun nom d'indicateur ne peut les désigner.
 * @param {object[]} indicators
 * @param {{data:object}[]} rows
 * @param {object[]} [defs] champs calculés de la fiche (ordre)
 * @returns {object[]} un décompte par indicateur (même ordre)
 */
function talliesOf(indicators, rows, defs = []) {
  const subs = readsCalc(indicators, defs)
    ? rows.map((r) => ({ data: { ...(r.data || {}), ...computeCalcFields(defs, r.data || {}) } }))
    : rows;
  const idx = keyIndex(subs);
  return (indicators || []).map((ind) => tallyIndicator(ind, subs, namesFor(ind.sourceField, idx)));
}

/** Réunion, indicateur par indicateur, de listes de décomptes (même liste d'indicateurs). */
function mergeAll(lists, n) {
  return Array.from({ length: n }, (_, i) => mergeTallies(lists.map((l) => l && l[i])));
}

/** Résultats (forme de computeAll) depuis les décomptes. */
function resultsFromTallies(indicators, tallies) {
  return (indicators || []).map((ind, i) => ({ ...indicatorMeta(ind), ...resultFromTally(ind, tallies[i] || mergeTallies([])) }));
}

/** Explication (« Comment c'est calculé ») d'un indicateur depuis son décompte. */
const explainOf = (indicator, tally, opts) => explainFromTally(indicator, tally || mergeTallies([]), opts);

module.exports = { readsCalc, talliesOf, mergeAll, resultsFromTallies, explainOf };
