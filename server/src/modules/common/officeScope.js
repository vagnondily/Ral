/**
 * Périmètre d'un bureau — PUR, testé (test/officeScope.test.js). La même règle que les tableaux de
 * bord (common/siteActivitySql.officeTreeSql, récursif) et le RBM : un bureau couvre ses sites ET
 * ceux de TOUTES ses antennes, à n'importe quel niveau (Bureau › Antenne › Sous-antenne) ; le bureau
 * national (« pays ») couvre tout le registre. Un cycle de parenté ne boucle jamais.
 *
 * `offices` : [{ id, parentId, national?, name? }]
 */

/**
 * @returns {Set<string>|null} bureaux du périmètre (le bureau et tout son sous-arbre), ou null
 *   quand il n'y a pas de filtre (aucun bureau choisi, ou bureau national).
 */
function officeScopeIds(offices = [], officeId = null) {
  if (!officeId) return null;
  const list = offices || [];
  const root = list.find((o) => o && o.id === officeId);
  if (root && root.national) return null;
  const children = new Map();
  for (const o of list) {
    if (!o || !o.parentId || o.parentId === o.id) continue;
    if (!children.has(o.parentId)) children.set(o.parentId, []);
    children.get(o.parentId).push(o.id);
  }
  const ids = new Set([officeId]);
  const stack = [officeId];
  while (stack.length) {
    for (const c of children.get(stack.pop()) || []) {
      if (!ids.has(c)) { ids.add(c); stack.push(c); }
    }
  }
  return ids;
}

/**
 * Bureau « racine » d'un site pour le suivi INTERNE : le bureau de plus haut niveau au-dessus de son
 * bureau ou de son antenne (jamais le bureau national) — c'est son équipe qui suit les sites de ses
 * antennes. Null sans bureau.
 * @returns {{ id: string, name: string|null }|null}
 */
function rootOfficeOf(offices = [], officeId = null) {
  if (!officeId) return null;
  const byId = new Map((offices || []).filter(Boolean).map((o) => [o.id, o]));
  let cur = byId.get(officeId);
  if (!cur) return { id: officeId, name: null };
  const seen = new Set([cur.id]);
  for (;;) {
    const p = cur.parentId ? byId.get(cur.parentId) : null;
    if (!p || p.national || seen.has(p.id)) break;
    seen.add(p.id);
    cur = p;
  }
  return { id: cur.id, name: cur.name || null };
}

module.exports = { officeScopeIds, rootOfficeOf };
