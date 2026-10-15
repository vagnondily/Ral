/**
 * Tri des listes (DataList) — module pur, testé (server/test/webDataList.test.js).
 *
 * Même ordre qu'avant (nombres comparés entre eux, sinon texte comparé selon la langue,
 * tri stable), mais plus rapide sur des milliers de lignes :
 *  - un seul Intl.Collator (identique à String.prototype.localeCompare sans arguments,
 *    qui en recrée un à chaque comparaison) ;
 *  - la clé de tri de chaque ligne est calculée UNE fois (et non à chaque comparaison).
 */
const collator = new Intl.Collator();

/** Comparaison de deux clés de tri : nombres entre eux, sinon textes (vide = ''). */
export function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a ?? ''), String(b ?? ''));
}

/**
 * Lignes triées par `sortVal(row)`, croissant ('asc') ou décroissant ; à égalité (ou clé
 * non comparable), l'ordre d'origine est gardé dans les deux sens. Ne modifie pas `rows`.
 */
export function sortRows(rows, sortVal, dir = 'asc') {
  const keyed = rows.map((r, i) => [sortVal(r), i, r]);
  keyed.sort((x, y) => {
    const c = compareValues(x[0], y[0]);
    return (dir === 'asc' ? c : -c) || x[1] - y[1];
  });
  return keyed.map((x) => x[2]);
}
