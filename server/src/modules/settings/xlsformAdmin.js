/**
 * Découpage administratif lu dans les LISTES DE CHOIX d'un XLSForm — logique
 * PURE (testée, sans I/O). Les formulaires Kobo du pays portent souvent le
 * référentiel officiel : liste par niveau, `name` = code officiel (pcode),
 * libellé = nom, et une colonne par niveau parent (ex. MIARO : ADM1CODE…
 * ADM4CODE ; GD : first/second/third_level_admin_area_list avec …_c).
 *
 * Reconnaissance sans nom de liste imposé :
 * 1. une liste est candidate si ≥ 90 % de ses `name` ont la forme d'un code ;
 * 2. une colonne d'une liste désigne un parent si ≥ 60 % de ses valeurs sont
 *    des `name` d'une autre liste candidate ;
 * 3. parent direct = la liste référencée la plus profonde ; on garde le plus
 *    long chemin depuis une racine, 4 niveaux au plus (les listes plus fines —
 *    sites, écoles — sont signalées, pas importées).
 * Sortie au format de l'import de découpage : { levels, rows: [{ names, pcodes }], warnings }.
 */
const CODE = /^[A-Z]{2,3}\d{1,14}[A-Z]?$/i;
const META = new Set(['list_name', 'list name', 'name', 'choice_filter_name', 'image', 'media::image', 'order']);
const DEFAULT_LABELS = [['Région', 'Régions'], ['District', 'Districts'], ['Commune', 'Communes'], ['Fokontany', 'Fokontany']];
const MAX_LEVELS = 4;
// Part minimale des valeurs d'une colonne qui sont des codes d'une autre liste pour y voir un parent
// (des unités orphelines ou des codes maison ne doivent pas masquer la hiérarchie).
const PARENT_MIN = 0.6;

const str = (v) => (v == null ? '' : String(v).trim());
const isLabelCol = (c) => /^label(\b|::|$)/i.test(c);

/** Colonne de libellé préférée : français, sinon libellé simple, sinon anglais, sinon le premier. */
function pickLabelColumn(columns) {
  const labels = columns.filter(isLabelCol);
  return labels.find((c) => /fr/i.test(c)) || labels.find((c) => c.toLowerCase() === 'label')
    || labels.find((c) => /en/i.test(c)) || labels[0] || null;
}

/**
 * @param {Array<object>} choiceRows  lignes des feuilles choices puis external_choices ({colonne: valeur})
 * @returns {null | { levels, rows, warnings, lists }}  null si aucune hiérarchie de codes n'est trouvée
 */
function breakdownFromChoices(choiceRows = []) {
  const warnings = [];
  const columns = [...new Set(choiceRows.flatMap((r) => Object.keys(r)))];
  const labelCol = pickLabelColumn(columns);
  const listCol = columns.find((c) => /^list[ _]name$/i.test(c));
  if (!listCol) return null;
  // Listes : la première occurrence d'un code l'emporte (choices avant external_choices).
  const lists = new Map();
  for (const r of choiceRows) {
    const list = str(r[listCol]); const name = str(r.name);
    if (!list || !name) continue;
    if (!lists.has(list)) lists.set(list, new Map());
    const items = lists.get(list);
    const key = name.toUpperCase();
    if (items.has(key)) {
      const prev = items.get(key);
      const label = str(r[labelCol]) || name;
      if (prev.label !== label && !prev.dupWarned) { warnings.push(`Code ${name} (${list}) porte deux noms : « ${prev.label} » retenu, « ${label} » ignoré.`); prev.dupWarned = true; }
      continue;
    }
    items.set(key, { name, label: str(r[labelCol]) || name, row: r });
  }
  const candidates = [...lists.entries()].filter(([, items]) => {
    const names = [...items.values()];
    return names.length >= 1 && names.filter((i) => CODE.test(i.name)).length >= names.length * 0.9;
  });
  if (!candidates.length) return null;
  const candidateNames = new Map(candidates.map(([l, items]) => [l, items]));

  // Colonnes parentes de chaque liste candidate.
  const parentCols = new Map(); // list → [{ col, parent }]
  for (const [list, items] of candidates) {
    const refs = [];
    const cols = columns.filter((c) => c !== listCol && !META.has(c.toLowerCase()) && !isLabelCol(c));
    for (const col of cols) {
      const vals = [...items.values()].map((i) => str(i.row[col]).toUpperCase()).filter(Boolean);
      if (vals.length < items.size * 0.9) continue;
      let best = null;
      for (const [other, otherItems] of candidateNames) {
        if (other === list) continue;
        const share = vals.filter((v) => otherItems.has(v)).length / vals.length;
        if (share >= PARENT_MIN && (!best || share > best.share)) best = { col, parent: other, share };
      }
      if (best) refs.push(best);
    }
    parentCols.set(list, refs);
  }
  const depth = new Map();
  const depthOf = (list, seen = new Set()) => {
    if (depth.has(list)) return depth.get(list);
    if (seen.has(list)) return 0; // cycle : ignoré
    seen.add(list);
    const d = 1 + Math.max(0, ...parentCols.get(list).map((r) => depthOf(r.parent, seen)));
    depth.set(list, d);
    return d;
  };
  for (const [list] of candidates) depthOf(list);

  // Parent direct = la liste référencée la plus profonde ; chaîne = plus long chemin depuis une racine
  // (à longueur égale, les listes les plus fournies).
  const parentOf = new Map(candidates.map(([l]) => {
    const refs = parentCols.get(l);
    const best = refs.reduce((a, r) => (!a || depth.get(r.parent) > depth.get(a.parent) ? r : a), null);
    return [l, best ? best.parent : null];
  }));
  const children = new Map();
  for (const [l, p] of parentOf) if (p) { if (!children.has(p)) children.set(p, []); children.get(p).push(l); }
  const longest = (l) => {
    const subs = (children.get(l) || []).map(longest)
      .sort((a, b) => b.length - a.length || lists.get(b[0]).size - lists.get(a[0]).size);
    return [l, ...(subs[0] || [])];
  };
  let chain = candidates.map(([l]) => l).filter((l) => !parentOf.get(l)).map(longest)
    .sort((a, b) => b.length - a.length || lists.get(b[0]).size - lists.get(a[0]).size)[0] || [];
  if (chain.length > MAX_LEVELS) {
    warnings.push(`Listes plus fines que le ${MAX_LEVELS}ᵉ niveau ignorées : ${chain.slice(MAX_LEVELS).join(', ')} (sites, écoles…).`);
    chain = chain.slice(0, MAX_LEVELS);
  }
  if (chain.length < 2) return null; // une liste de codes isolée n'est pas un découpage

  const parentColOf = (list, parentList) => (parentCols.get(list).find((r) => r.parent === parentList) || {}).col;
  const rows = []; let orphans = 0;
  chain.forEach((list, i) => {
    for (const item of lists.get(list).values()) {
      const names = [item.label]; const pcodes = [item.name];
      let cur = item; let ok = true;
      for (let j = i; j > 0; j -= 1) {
        const pcol = parentColOf(chain[j], chain[j - 1]);
        const parent = lists.get(chain[j - 1]).get(str(cur.row[pcol]).toUpperCase());
        if (!parent) { ok = false; break; }
        names.unshift(parent.label); pcodes.unshift(parent.name);
        cur = parent;
      }
      if (ok) rows.push({ names, pcodes, lat: null, lng: null }); else orphans += 1;
    }
  });
  if (orphans) warnings.push(`${orphans} unité(s) dont le parent est absent de la liste supérieure : ignorée(s).`);
  const levels = chain.map((l, i) => ({ code: `adm${i + 1}`, label: DEFAULT_LABELS[i][0], labelPlural: DEFAULT_LABELS[i][1] }));
  return { levels, rows, warnings, lists: chain.map((l) => ({ list: l, count: lists.get(l).size })) };
}

module.exports = { breakdownFromChoices, pickLabelColumn, CODE };
