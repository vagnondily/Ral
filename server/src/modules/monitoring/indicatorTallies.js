const {
  tallyIndicator, mergeTallies, resultFromTally, indicatorMeta, keyIndex, namesFor, explainFromTally, visitScorer,
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
  return pageFacts(indicators, rows, defs).tallies;
}

const VISIT_CLASSES = ['exc', 'sat', 'imp', 'urg', 'na'];
/** Décompte vide des visites : nombre par classe, somme des scores, visites urgentes gardées. */
const emptyVisits = () => ({ n: 0, scored: 0, sumScore: 0, classes: { exc: 0, sat: 0, imp: 0, urg: 0, na: 0 }, urgent: [] });
const byScore = (a, b) => a.score - b.score || String(a.id || '').localeCompare(String(b.id || ''));

/**
 * Décomptes d'une page de soumissions (un groupe) : un décompte par indicateur et, si
 * `visits`, le score de chaque VISITE (monitoringMath.visitScore) — classes et visites en
 * « Action urgente » (les `keep` plus faibles, avec leur identité `row.meta`).
 */
function pageFacts(indicators, rows, defs = [], { visits = false, keep = 50 } = {}) {
  const subs = readsCalc(indicators, defs)
    ? rows.map((r) => ({ ...r, data: { ...(r.data || {}), ...computeCalcFields(defs, r.data || {}) } }))
    : rows;
  const idx = keyIndex(subs);
  const names = new Map((indicators || []).map((ind) => [ind, namesFor(ind.sourceField, idx)]));
  const tallies = (indicators || []).map((ind) => tallyIndicator(ind, subs, names.get(ind)));
  if (!visits) return { tallies, visits: null };
  const v = emptyVisits();
  const score = visitScorer(indicators);
  const namesOf = (ind) => names.get(ind);
  for (const s of subs) {
    const r = score(s.data, namesOf);
    v.n += 1; v.classes[r.rating] += 1;
    if (r.score != null) { v.scored += 1; v.sumScore += r.score; }
    if (r.rating === 'urg') v.urgent.push({ ...(s.meta || {}), score: r.score, answered: r.answered });
  }
  v.urgent.sort(byScore);
  v.urgent = v.urgent.slice(0, keep);
  return { tallies, visits: v };
}

/** Réunion de décomptes de visites (pages, groupes). */
function mergeVisits(list, keep = 50) {
  const out = emptyVisits();
  for (const v of list || []) {
    if (!v) continue;
    out.n += v.n; out.scored += v.scored; out.sumScore += v.sumScore;
    for (const c of VISIT_CLASSES) out.classes[c] += v.classes[c];
    out.urgent.push(...v.urgent);
  }
  out.urgent.sort(byScore);
  out.urgent = out.urgent.slice(0, keep);
  return out;
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

module.exports = { readsCalc, talliesOf, pageFacts, mergeAll, mergeVisits, emptyVisits, resultsFromTallies, explainOf, VISIT_CLASSES };
