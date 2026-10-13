const { checkExpression } = require('./calcFields');

/**
 * Clés utiles des réponses d'une fiche (lot 1b, C5) — logique PURE, testée
 * (test/indicatorKeys.test.js) : les seules variables que le calcul des
 * indicateurs lit. Le dépôt retire du JSONB des soumissions les clés CONNUES
 * inutiles (`data - clés::text[]`, un seul appel par ligne) au lieu de charger
 * chaque réponse entière en mémoire — fiche GD : 1,95 Mo → 285 ko sur un mois ;
 * banc : 14,5 Mo → 3,9 Mo par fiche et par an.
 *
 * Pourquoi retirer plutôt que garder : garder les seules clés utiles exige de
 * dérouler chaque réponse (jsonb_each, ~100 lignes par soumission) — mesuré 4 fois
 * plus lent que la lecture complète ; retirer une liste de clés est une fonction C
 * par ligne. Une clé absente de la liste (jamais vue) reste dans le JSON : seule la
 * mémoire en pâtit, jamais le résultat (une clé utile n'est JAMAIS retirée).
 *
 * Même règle que l'aperçu « Comment c'est calculé » :
 *  - la variable source (`sourceField`) de chaque indicateur, en minuscules — le
 *    calcul essaie le nom exact puis ses variantes de casse (namesFor), toutes
 *    couvertes par la comparaison en minuscules ;
 *  - si une source est un champ calculé : les variables lues par TOUS les champs
 *    calculés de la fiche (un champ calculé peut en lire un autre — chaîne couverte).
 */

/** Variables lues par les champs calculés d'une fiche, en minuscules. */
function calcReferences(defs) {
  const refs = new Set();
  for (const d of defs || []) {
    const list = d.kind === 'recode' ? [d.sourceField] : checkExpression(d.expression).references;
    for (const r of list) if (r) refs.add(String(r).toLowerCase());
  }
  return refs;
}

/**
 * Clés (minuscules) à lire pour calculer `indicators` (déjà filtrés : actifs).
 * @param {{sourceField:string}[]} indicators
 * @param {{name:string, kind?:string, expression?:string, sourceField?:string}[]} calcDefs
 * @returns {string[]} clés triées, sans doublon
 */
function indicatorKeys(indicators, calcDefs = []) {
  const keys = new Set();
  const calcNames = new Set((calcDefs || []).map((d) => String(d.name).toLowerCase()));
  let needsCalc = false;
  for (const ind of indicators || []) {
    if (ind.sourceField == null || ind.sourceField === '') continue;
    const k = String(ind.sourceField).toLowerCase();
    keys.add(k);
    if (calcNames.has(k)) needsCalc = true;
  }
  if (needsCalc) for (const r of calcReferences(calcDefs)) keys.add(r);
  return [...keys].sort();
}

/**
 * Clés à RETIRER des réponses : les clés connues de la fiche (catalogue, échantillon des
 * réponses) dont la forme en minuscules n'est pas une clé utile. Une clé utile, quelle que
 * soit sa casse, n'est jamais retirée.
 * @param {string[]} universe clés connues (graphies exactes)
 * @param {string[]} useful clés utiles en minuscules (indicatorKeys)
 */
function unusedKeys(universe, useful) {
  const keep = new Set((useful || []).map((k) => String(k).toLowerCase()));
  return [...new Set(universe || [])].filter((k) => k != null && !keep.has(String(k).toLowerCase())).sort();
}

/** Fragment SQL : le JSONB `data` de l'alias privé des clés de `paramRef` (« $3 », text[]). */
const dataWithout = (alias, paramRef) => `(${alias}.data - ${paramRef}::text[])`;

module.exports = { indicatorKeys, calcReferences, unusedKeys, dataWithout };
