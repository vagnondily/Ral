/**
 * Bureaux d'un compte (= un pays) : hiérarchie, périmètres et bureau CALCULÉ des sites —
 * logique PURE, sans I/O, testée (test/officeTree.test.js).
 *
 * Chaîne complète : Siège › Bureau régional › Bureau pays › Bureau de zone › Sous-bureau › Antenne.
 * Le Siège et les bureaux régionaux sont des unités AU-DESSUS des comptes (docs/SPEC_MULTIPAYS.md,
 * option A) : dans un compte n'existent que les quatre derniers niveaux. Un niveau peut manquer :
 * le parent d'un bureau est d'un niveau STRICTEMENT supérieur (une antenne peut dépendre
 * directement du bureau pays). Cette règle rend tout cycle impossible.
 *
 * Jumeaux en base (filet de sécurité, mêmes règles) :
 *  - migration 102 : type, rang, parent de rang supérieur, enfants de rang inférieur, un seul
 *    bureau pays, périmètre national réservé au bureau pays ;
 *  - migration 103 : `mems_site_offices(tenant)` = `officeForCommune` en SQL (bureau calculé de
 *    chaque site), test de parité test/officeForCommuneParity.test.js.
 */

/** Types d'un bureau dans un compte, du plus général au plus précis. */
const OFFICE_TYPES = ['country', 'area', 'sub', 'antenna'];
/** Rang : plus petit = plus général. */
const RANK = Object.freeze({ country: 1, area: 2, sub: 3, antenna: 4 });
/** Chaîne complète, unités multi-pays comprises (affichage seulement). */
const ORG_CHAIN = ['hq', 'regional', 'country', 'area', 'sub', 'antenna'];
const TYPE_LABEL = Object.freeze({
  hq: 'Siège', regional: 'Bureau régional', country: 'Bureau pays', area: 'Bureau de zone', sub: 'Sous-bureau', antenna: 'Antenne',
});

const isOfficeType = (t) => Object.prototype.hasOwnProperty.call(RANK, t);
const rankOf = (t) => (isOfficeType(t) ? RANK[t] : null);
/** Un bureau de type `parentType` peut-il être le parent d'un bureau de type `childType` ? */
const canParent = (parentType, childType) => isOfficeType(parentType) && isOfficeType(childType) && RANK[parentType] < RANK[childType];

/**
 * Index des bureaux : par id et enfants par parent. Un parent inconnu, ou le bureau lui-même,
 * compte comme « pas de parent » (racine) : aucun bureau n'est jamais égaré.
 * @param {Array<{id:string, parentId?:string|null}>} offices
 */
function indexOffices(offices) {
  const byId = new Map();
  for (const o of offices || []) byId.set(o.id, o);
  const children = new Map();
  for (const o of offices || []) {
    const p = o.parentId && o.parentId !== o.id && byId.has(o.parentId) ? o.parentId : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(o);
  }
  return { byId, children };
}

/**
 * Le bureau et TOUS ses descendants (« bureau avec ses antennes », à tout niveau) : c'est le
 * périmètre d'un filtre par bureau, partout. Insensible aux cycles.
 * @returns {Set<string>}
 */
function descendantIds(offices, id, index = indexOffices(offices)) {
  const out = new Set();
  if (!id || !index.byId.has(id)) return out;
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    if (out.has(cur)) continue;
    out.add(cur);
    for (const k of index.children.get(cur) || []) stack.push(k.id);
  }
  return out;
}

/**
 * Lignée d'un bureau, de la racine au bureau lui-même ([] si inconnu). Un cycle (données
 * anciennes) arrête la remontée.
 */
function lineage(offices, id, index = indexOffices(offices)) {
  const out = [];
  const seen = new Set();
  let cur = index.byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId && cur.parentId !== cur.id ? index.byId.get(cur.parentId) : null;
  }
  return out;
}

/**
 * Bureaux dans l'ordre de l'ARBRE (bureau, puis ses enfants, puis leurs enfants…) avec
 * `depth` et `hasChildren`. Racines et frères triés par `compare` (par défaut : du plus
 * général au plus précis, puis par nom). Un parent absent ou un cycle n'égare aucun bureau.
 */
function treeOrder(offices, { compare = byRankThenName } = {}) {
  const list = offices || [];
  const index = indexOffices(list);
  const out = [];
  const seen = new Set();
  const walk = (o, depth) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    const kids = (index.children.get(o.id) || []).filter((k) => !seen.has(k.id)).sort(compare);
    out.push({ ...o, depth, hasChildren: kids.length > 0 });
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of [...(index.children.get(null) || [])].sort(compare)) walk(r, 0);
  for (const o of [...list].sort(compare)) if (!seen.has(o.id)) walk(o, 0); // cycle : racine
  return out;
}

function byRankThenName(a, b) {
  return ((rankOf(a.type) || 9) - (rankOf(b.type) || 9))
    || String(a.name || '').localeCompare(String(b.name || ''), 'fr')
    || String(a.id).localeCompare(String(b.id));
}

/**
 * Parents possibles d'un bureau : de rang strictement supérieur, ni lui-même ni l'un de ses
 * descendants, actifs (le parent actuel reste proposé même inactif). Ordre de l'arbre.
 * @param {object[]} offices  { id, type, parentId, active, name }
 * @param {{ id?:string|null, type:string, parentId?:string|null }} draft
 */
function validParents(offices, draft) {
  const index = indexOffices(offices);
  const below = draft.id ? descendantIds(offices, draft.id, index) : new Set();
  return treeOrder(offices).filter((o) => o.id !== draft.id && !below.has(o.id)
    && canParent(o.type, draft.type) && (o.active !== false || o.id === draft.parentId));
}

/**
 * Contrôles d'un bureau avant écriture (les mêmes refus que la base, avec un message clair).
 * @param {object[]} offices  bureaux EXISTANTS du compte { id, code, name, type, parentId, national, active }
 * @param {{ id?:string|null, type:string, parentId?:string|null, national?:boolean }} draft  état voulu
 * @returns {Array<{ code:string, message:string }>}  vide si tout va bien
 */
function checkOffice(offices, draft) {
  const errors = [];
  const index = indexOffices(offices);
  const { id = null, type, parentId = null, national = false } = draft;
  if (!isOfficeType(type)) {
    errors.push({ code: 'type_invalid', message: 'Type de bureau inconnu (bureau pays, de zone, sous-bureau ou antenne).' });
    return errors;
  }
  if (national && type !== 'country') {
    errors.push({ code: 'national_not_country', message: 'Seul le bureau pays peut avoir un périmètre national.' });
  }
  if (type === 'country' && (offices || []).some((o) => o.type === 'country' && o.id !== id)) {
    errors.push({ code: 'country_unique', message: 'Ce compte a déjà un bureau pays : un seul bureau pays par pays.' });
  }
  if (parentId) {
    const parent = index.byId.get(parentId);
    if (parentId === id) errors.push({ code: 'parent_self', message: 'Un bureau ne peut pas être son propre parent.' });
    else if (!parent) errors.push({ code: 'parent_unknown', message: 'Bureau parent inconnu (ou hors de ce compte).' });
    else if (!canParent(parent.type, type)) {
      errors.push({
        code: 'parent_rank',
        message: type === 'country'
          ? 'Le bureau pays est le plus haut niveau du compte : il n\'a pas de parent.'
          : `« ${parent.name} » (${TYPE_LABEL[parent.type] || '?'}) n'est pas d'un niveau supérieur à « ${TYPE_LABEL[type]} » : choisissez un parent plus général.`,
      });
    } else if (id && descendantIds(offices, id, index).has(parentId)) {
      errors.push({ code: 'cycle', message: 'Ce parent dépend déjà de ce bureau (boucle).' });
    }
  }
  if (id) {
    const tooHigh = (index.children.get(id) || []).filter((k) => !canParent(type, k.type));
    if (tooHigh.length) {
      errors.push({
        code: 'children_rank',
        message: `Un(e) « ${TYPE_LABEL[type]} » ne peut pas avoir ces bureaux sous lui : ${tooHigh.map((k) => `« ${k.name} » (${TYPE_LABEL[k.type] || '?'})`).join(', ')}. Changez d'abord leur parent ou leur type.`,
      });
    }
  }
  return errors;
}

// ---- Périmètres et bureau calculé ---------------------------------------------------------
/**
 * Clé de nom, comme `lower(btrim(x))` en base (espaces de bord seulement, casse ignorée) :
 * le jumeau SQL compare exactement ainsi.
 */
const nameKey = (s) => String(s == null ? '' : s).replace(/^ +| +$/g, '').toLowerCase();

/**
 * Une ligne de périmetre contient-elle le lieu ?
 *  - 'area' : même unité commune du découpage (reconnue des deux côtés) ;
 *  - 'name' : même nom de commune et, si la ligne porte un district, même district ;
 *  - null   : non.
 * @param {{ areaId?:string|null, district?:string|null, commune:string }} row
 * @param {{ areaId?:string|null, district?:string|null, commune?:string|null }} place
 */
function rowContains(row, place) {
  if (row.areaId && place.areaId && row.areaId === place.areaId) return 'area';
  const c = nameKey(place.commune);
  if (!c || nameKey(row.commune) !== c) return null;
  const d = nameKey(row.district);
  return !d || d === nameKey(place.district) ? 'name' : null;
}

const VIA_ORDER = { area: 0, name: 1, national: 2 };
/** Comparaison binaire (comme COLLATE "C" en base) : jamais dépendante de la langue. */
const binCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Bureau CALCULÉ d'un lieu (d'un site) — la règle unique :
 *   le bureau ACTIF le plus précis dont le périmètre contient la commune du lieu —
 *   Antenne, puis Sous-bureau, Bureau de zone, Bureau pays. À rang égal : celui qui reconnaît
 *   la commune par le découpage (même unité) avant celui qui la reconnaît par son nom, puis le
 *   plus petit code. Un bureau pays à périmètre NATIONAL contient tout le pays : il est le
 *   recours quand aucun autre bureau ne contient la commune.
 * @param {Array<{id, code, type, active, national}>} offices
 * @param {Array<{officeId, areaId?, district?, commune}>} perimeters  lignes de périmètre
 * @param {{ areaId?:string|null, district?:string|null, commune?:string|null }} place
 *        areaId = unité COMMUNE du lieu dans le découpage (null si non reconnue)
 * @returns {{ officeId:string|null, how:'perimetre'|'national'|null, via:'area'|'name'|'national'|null, ties:string[] }}
 *          ties = autres bureaux du même rang qui contiennent aussi la commune (chevauchement)
 */
function officeForCommune(offices, perimeters, place) {
  const active = new Map((offices || []).filter((o) => o.active !== false && isOfficeType(o.type)).map((o) => [o.id, o]));
  const best = new Map(); // officeId → via
  const keep = (id, via) => { const prev = best.get(id); if (!prev || VIA_ORDER[via] < VIA_ORDER[prev]) best.set(id, via); };
  for (const row of perimeters || []) {
    if (!active.has(row.officeId)) continue;
    const via = rowContains(row, place || {});
    if (via) keep(row.officeId, via);
  }
  for (const o of active.values()) if (o.national && o.type === 'country') keep(o.id, 'national');
  if (!best.size) return { officeId: null, how: null, via: null, ties: [] };
  const ranked = [...best.entries()].map(([id, via]) => ({ o: active.get(id), via }))
    .sort((a, b) => (RANK[b.o.type] - RANK[a.o.type]) || (VIA_ORDER[a.via] - VIA_ORDER[b.via]) || binCmp(String(a.o.code), String(b.o.code)) || binCmp(a.o.id, b.o.id));
  const top = ranked[0];
  return {
    officeId: top.o.id,
    how: top.via === 'national' ? 'national' : 'perimetre',
    via: top.via,
    ties: ranked.slice(1).filter((x) => RANK[x.o.type] === RANK[top.o.type] && x.via !== 'national').map((x) => x.o.id),
  };
}

/**
 * Lignes du périmètre d'un enfant HORS du périmètre de son parent (un parent national contient
 * tout). Même règle de contenance que le bureau calculé.
 * @returns {object[]} lignes de l'enfant non contenues
 */
function outsideParent(childRows, parentRows, { parentNational = false } = {}) {
  if (parentNational) return [];
  return (childRows || []).filter((row) => !(parentRows || []).some((p) => rowContains(p, row) || rowContains(row, p)));
}

/**
 * Type d'un bureau d'avant la hiérarchie (migration 102, même règle en SQL) : bureau national →
 * bureau pays ; racine → bureau de zone ; enfant sans enfant (« antenne de … ») → antenne ;
 * enfant qui a des enfants → bureau de zone sous le bureau pays, sinon sous-bureau.
 * @param {Array<{id, parentId, national}>} offices
 * @returns {Map<string, string>} id → type
 */
function legacyTypes(offices) {
  const index = indexOffices(offices);
  const out = new Map();
  for (const o of offices || []) {
    const parent = o.parentId && o.parentId !== o.id ? index.byId.get(o.parentId) : null;
    const hasKids = (index.children.get(o.id) || []).length > 0;
    let type;
    if (o.national) type = 'country';
    else if (!parent) type = 'area';
    else if (!hasKids) type = 'antenna';
    else type = parent.national ? 'area' : 'sub';
    out.set(o.id, type);
  }
  return out;
}

module.exports = {
  OFFICE_TYPES, RANK, ORG_CHAIN, TYPE_LABEL,
  isOfficeType, rankOf, canParent, indexOffices, descendantIds, lineage, treeOrder, validParents, checkOffice,
  nameKey, rowContains, officeForCommune, outsideParent, legacyTypes,
};
