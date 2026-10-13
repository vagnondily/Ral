// Axes des graphiques — logique PURE (sans DOM), testée depuis le serveur
// (server/test/webCharts.test.js, comme webSafety.test.js) : le front n'a pas
// encore de suite de tests propre, et un axe illisible est vite revenu.

/**
 * Index des points qui portent une étiquette d'axe : ANCRÉS SUR LE DERNIER
 * point (le mois choisi est toujours étiqueté), puis un tous les `step` en
 * remontant ; jamais plus de `maxTicks` étiquettes. Deux étiquettes voisines
 * sont donc toujours séparées de `step` points — avec maxTicks calculé sur la
 * largeur réelle (TrendChart), elles ne se chevauchent jamais.
 * @param {number} n nombre de points
 * @param {number} maxTicks étiquettes au plus (≥ 1)
 * @returns {number[]} index croissants
 */
export function tickIndexes(n, maxTicks) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (count === 0) return [];
  const max = Math.max(1, Math.floor(Number(maxTicks) || 1));
  const step = Math.max(1, Math.ceil(count / max));
  const out = [];
  for (let i = count - 1; i >= 0; i -= step) out.push(i);
  return out.reverse();
}

/** Pas « rond » (1, 2, 2,5, 5 × 10^k) ≥ v ; jamais sous 1 pour des comptages entiers. */
export function niceStep(v, { integer = true } = {}) {
  const x = Number(v) || 0;
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const step = nice * p;
  return integer ? Math.max(1, Math.ceil(step)) : step;
}

/**
 * Échelle de l'axe des valeurs : `intervals` graduations régulières de 0 à un
 * maximum « rond » ≥ la plus grande valeur (137 → 0, 50, 100, 150).
 * `fixedMax` impose le maximum (ex. 100 pour un indice sur 100).
 * @returns {{ max:number, ticks:number[] }}
 */
export function yScale(maxValue, { intervals = 3, fixedMax = null, integer = true } = {}) {
  const k = Math.max(1, Math.floor(intervals));
  if (fixedMax != null && fixedMax > 0) {
    return { max: fixedMax, ticks: Array.from({ length: k + 1 }, (_, i) => (fixedMax * i) / k) };
  }
  const step = niceStep((Number(maxValue) || 0) / k, { integer });
  return { max: step * k, ticks: Array.from({ length: k + 1 }, (_, i) => step * i) };
}
