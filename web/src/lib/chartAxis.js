// Axes des graphiques — logique PURE (sans DOM), testée depuis le serveur
// (server/test/webCharts.test.js, comme webSafety.test.js) : le front n'a pas
// encore de suite de tests propre, et un axe illisible est vite revenu.

/**
 * Emprise horizontale d'une étiquette de largeur `w` placée au point `x`,
 * dans une zone [0, width] : centrée, sauf près d'un bord où elle s'aligne
 * sur ce bord (« start » à gauche, « end » à droite) pour ne pas en sortir.
 * @returns {{ anchor:'start'|'middle'|'end', left:number, right:number }}
 */
export function labelBox(x, w, width) {
  const half = (Number(w) || 0) / 2;
  if (x - half < 0) return { anchor: 'start', left: x, right: x + 2 * half };
  if (x + half > width) return { anchor: 'end', left: x - 2 * half, right: x };
  return { anchor: 'middle', left: x - half, right: x + half };
}

/**
 * Étiquettes d'axe SANS CHEVAUCHEMENT, sur les largeurs réelles (mesurées) :
 *  1. les étiquettes `forced` (par priorité : le mois choisi, le dernier mois)
 *     sont toujours montrées — sauf une forcée qui toucherait une forcée de
 *     priorité plus haute ;
 *  2. les autres suivent un pas régulier ancré sur le dernier point ; un pas
 *     est valable si, une fois retirées celles qui touchent une étiquette forcée
 *     (ses voisines à moins d'une largeur d'étiquette), deux étiquettes montrées
 *     sont toujours séparées d'au moins `gap` pixels. Parmi les pas valables :
 *     le plus d'étiquettes, puis le moins d'étiquettes retirées (pas régulier
 *     jusqu'au bout), puis le plus petit pas.
 * Une étiquette alignée sur un bord (« end » pour le dernier mois) s'étend de
 * toute sa largeur vers l'intérieur : c'est elle que l'ancien calcul (une place
 * fixe par étiquette) laissait chevaucher sa voisine.
 * @param {number[]} xs position de chaque point (px, croissantes)
 * @param {number[]} widths largeur de l'étiquette de chaque point (px)
 * @param {{ width:number, forced?:number[], gap?:number }} opts
 * @returns {{ index:number, anchor:'start'|'middle'|'end', left:number, right:number }[]} par index croissant
 */
export function pickTicks(xs, widths, { width, forced = [], gap = 8 } = {}) {
  const n = Array.isArray(xs) ? xs.length : 0;
  if (n === 0) return [];
  const W = Number.isFinite(width) ? width : Math.max(...xs);
  const boxes = xs.map((x, i) => ({ index: i, ...labelBox(x, widths[i], W) }));
  const clash = (a, b) => (a.left <= b.left ? a.right + gap > b.left : b.right + gap > a.left);
  const kept = [];
  for (const i of forced) {
    if (!Number.isInteger(i) || i < 0 || i >= n || kept.some((k) => k.index === i)) continue;
    if (!kept.some((k) => clash(k, boxes[i]))) kept.push(boxes[i]);
  }
  const fixed = new Set(kept.map((k) => k.index));
  let best = null;
  // Au pas n, seul le dernier point est candidat : il y a toujours un pas valable.
  for (let step = 1; step <= n; step += 1) {
    const set = [...kept];
    let dropped = 0;
    for (let i = n - 1; i >= 0; i -= step) {
      if (fixed.has(i)) continue;
      if (kept.some((k) => clash(k, boxes[i]))) dropped += 1;
      else set.push(boxes[i]);
    }
    set.sort((a, b) => a.left - b.left);
    if (!set.every((b, j) => j === 0 || !clash(set[j - 1], b))) continue;
    if (!best || set.length > best.set.length || (set.length === best.set.length && dropped < best.dropped)) best = { set, dropped };
  }
  return (best ? best.set : kept).sort((a, b) => a.index - b.index);
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
