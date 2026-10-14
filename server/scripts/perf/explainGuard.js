/**
 * Garde EXPLAIN du banc de période (lot 1b) — logique PURE, testée
 * (test/explainGuard.test.js), appliquée à la sortie de
 * `EXPLAIN (ANALYZE, FORMAT JSON)` rejouée sous RLS (rôle mems2_app).
 *
 * La garde porte sur le TRAVAIL, pas sur le type de nœud (critique de la spéc. 1b) :
 * une série de 12 mois relue 3 000 fois est inoffensive, un CTE de 19 370 zones
 * relu pour chaque soumission ne l'est pas.
 *
 *  1. Gros ensemble relu en boucle : le côté INTERNE d'un « Nested Loop » relit, à
 *     chaque boucle, plus de `minInnerRows` lignes et au total plus de `maxInnerRead`
 *     lignes (lignes × boucles, filtrées comprises) sur un parcours de table (Seq /
 *     Index / Index Only / Bitmap Heap Scan), un « CTE Scan », un « Materialize » ou un
 *     « Function Scan ». Un petit ensemble (une dizaine de bureaux) relu pour chaque
 *     ligne reste une jointure linéaire : il n'est pas signalé par cette règle.
 *     Même règle pour une sous-requête corrélée (« SubPlan ») : relancée pour chaque
 *     ligne, elle relit son ensemble à chaque fois.
 *  2. Parcours répété : un parcours de table lancé plus de `maxLoops` fois avec plus
 *     de `maxRowsPerLoop` lignes lues par boucle (sous-requête corrélée, LATERAL).
 *  Exemption : un « Function Scan » qui rend au plus `smallFunctionRows` lignes par
 *  boucle (generate_series des mois d'une période de 60 mois au plus).
 */

const TABLE_SCANS = new Set(['Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan']);
const REREAD_NODES = new Set([...TABLE_SCANS, 'CTE Scan', 'Materialize', 'Function Scan']);

const DEFAULTS = { maxInnerRead: 200_000, minInnerRows: 100, maxLoops: 1000, maxRowsPerLoop: 10, smallFunctionRows: 60 };

/** Lignes lues par boucle : rendues + écartées par les filtres. */
function rowsPerLoop(node) {
  return (node['Actual Rows'] || 0) + (node['Rows Removed by Filter'] || 0)
    + (node['Rows Removed by Index Recheck'] || 0) + (node['Rows Removed by Join Filter'] || 0);
}
const loopsOf = (node) => Math.max(1, node['Actual Loops'] || 1);
const nameOf = (node) => {
  const target = node['Relation Name'] || node['CTE Name'] || node['Function Name'] || '';
  return target ? `${node['Node Type']} on ${target}` : node['Node Type'];
};

/** Travail (lignes lues × boucles) des nœuds relus d'un sous-arbre, et le plus grand nombre de lignes relues par boucle. */
function rereadWork(node, opts) {
  let work = 0;
  let perLoop = 0;
  const visit = (n) => {
    if (REREAD_NODES.has(n['Node Type'])) {
      const per = rowsPerLoop(n);
      const exempt = n['Node Type'] === 'Function Scan' && per <= opts.smallFunctionRows;
      if (!exempt) { work += per * loopsOf(n); perLoop = Math.max(perLoop, per); }
    }
    for (const c of n.Plans || []) visit(c);
  };
  visit(node);
  return { work, perLoop };
}

/**
 * Problèmes d'un plan (tableau vide = plan sain).
 * @param {object|object[]} explainJson sortie de EXPLAIN (FORMAT JSON) : [{ Plan }] ou { Plan } ou le nœud
 */
function planIssues(explainJson, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const root = Array.isArray(explainJson) ? explainJson[0] : explainJson;
  const plan = root && root.Plan ? root.Plan : root;
  const issues = [];
  const visit = (n, path) => {
    const here = [...path, nameOf(n)];
    if (n['Node Type'] === 'Nested Loop') {
      const inner = (n.Plans || []).find((c) => c['Parent Relationship'] === 'Inner') || (n.Plans || [])[1];
      if (inner) {
        const { work, perLoop } = rereadWork(inner, opts);
        if (work > opts.maxInnerRead && perLoop > opts.minInnerRows) {
          issues.push({ rule: 'nested_loop_inner', work, loops: loopsOf(inner), path: here.join(' > '),
            message: `Boucle imbriquée : le côté interne (${nameOf(inner)}) lit ${work} lignes au total (> ${opts.maxInnerRead}).` });
        }
      }
    }
    if (n['Parent Relationship'] === 'SubPlan' && loopsOf(n) > 1) {
      const { work, perLoop } = rereadWork(n, opts);
      if (work > opts.maxInnerRead && perLoop > opts.minInnerRows) {
        issues.push({ rule: 'subplan_reread', work, loops: loopsOf(n), path: here.join(' > '),
          message: `Sous-requête corrélée (${nameOf(n)}) relancée ${loopsOf(n)} fois : ${work} lignes lues au total (> ${opts.maxInnerRead}).` });
      }
    }
    if (TABLE_SCANS.has(n['Node Type'])) {
      const loops = loopsOf(n);
      const per = rowsPerLoop(n);
      if (loops > opts.maxLoops && per > opts.maxRowsPerLoop) {
        issues.push({ rule: 'repeated_scan', work: per * loops, loops, path: here.join(' > '),
          message: `Parcours répété : ${nameOf(n)} lancé ${loops} fois, ${Math.round(per)} lignes par boucle.` });
      }
    }
    for (const c of n.Plans || []) visit(c, here);
  };
  if (plan) visit(plan, []);
  return issues;
}

module.exports = { planIssues, rereadWork, DEFAULTS };
