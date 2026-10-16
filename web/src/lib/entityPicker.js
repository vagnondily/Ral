/**
 * Liste de choix d'un objet métier (prestataire TPM, contrat, site, bureau…) — logique pure, testée
 * (server/test/webEntityPicker.test.js). Le composant `EntityPicker` remplace la liste déroulante du
 * navigateur quand la liste est longue : recherche sans accents ni casse (libellé, précision, mots-clés),
 * groupes dans l'ordre demandé, ligne de précision sous le libellé (« n° FLA · partenaire », période…).
 *
 * Une option : { value, label, sub?, group?, keywords?, disabled? } ; `value` est une chaîne.
 */

/** Texte comparable : sans accents, minuscules, espaces réduits. */
export function normText(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Options qui contiennent TOUS les mots de la recherche (dans le libellé, la précision ou les mots-clés). */
export function filterOptions(options, query) {
  const words = normText(query).split(' ').filter(Boolean);
  if (!words.length) return options || [];
  return (options || []).filter((o) => {
    const hay = normText([o.label, o.sub, ...(Array.isArray(o.keywords) ? o.keywords : [o.keywords])].filter(Boolean).join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Groupes d'options, dans l'ordre de `order` puis dans l'ordre d'apparition ; les options sans groupe
 * viennent en premier, sous un groupe sans titre. L'ordre des options d'un groupe est conservé.
 * @returns {{ group: string, items: object[] }[]}
 */
export function groupOptions(options, order = []) {
  const map = new Map();
  for (const o of options || []) {
    const g = o.group || '';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(o);
  }
  const rank = (g) => (g === '' ? -1 : (order.indexOf(g) === -1 ? order.length : order.indexOf(g)));
  return [...map.entries()]
    .map(([group, items], i) => ({ group, items, i }))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.i - b.i)
    .map(({ group, items }) => ({ group, items }));
}

/**
 * Au plus `limit` options affichées (les premières, dans l'ordre des groupes) ; le reste est compté
 * — jamais tronqué en silence : l'écran dit « N autres : affinez la recherche ».
 * @returns {{ groups: { group: string, items: object[] }[], hidden: number }}
 */
export function limitGroups(groups, limit) {
  if (!(limit > 0)) return { groups: groups || [], hidden: 0 };
  let left = limit; let hidden = 0;
  const out = [];
  for (const g of groups || []) {
    const shown = g.items.slice(0, Math.max(0, left));
    hidden += g.items.length - shown.length;
    left -= shown.length;
    if (shown.length) out.push({ group: g.group, items: shown });
  }
  return { groups: out, hidden };
}

/** Options choisissables, à plat, dans l'ordre d'affichage (pour la navigation au clavier). */
export function flatOptions(groups) {
  return (groups || []).flatMap((g) => g.items).filter((o) => !o.disabled);
}

/**
 * Prochaine option active au clavier : ↓ / ↑ bouclent, Début / Fin vont aux extrémités.
 * @param {number} index  option active (-1 = aucune)
 * @param {number} count  nombre d'options choisissables
 */
export function moveActive(index, count, key) {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return index < 0 || index >= count - 1 ? 0 : index + 1;
  if (key === 'ArrowUp') return index <= 0 ? count - 1 : index - 1;
  return Math.min(Math.max(index, -1), count - 1);
}

/** La recherche n'apparaît que lorsqu'elle aide : plus de `threshold` options. */
export const SEARCH_THRESHOLD = 7;
export const showSearch = (options, threshold = SEARCH_THRESHOLD) => (options || []).length > threshold;
