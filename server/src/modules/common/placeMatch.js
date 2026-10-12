/**
 * Rapprochement des LIEUX et des BUREAUX — moteur PUR, partagé, testé (aucun
 * accès à la base). Un nom de lieu venu d'un import (Kobo, Master Data, plan de
 * suivi, PDD…) est rapproché du découpage du pays (Paramétrage › Localités) :
 *
 *   1. pcode exact (colonne pcode, ou valeur qui en a la forme)      → « code »
 *   2. nom normalisé identique dans le parent                         → « exact » / « normalise »
 *   3. alias appris (dans le parent, puis sur tout le niveau)         → « alias »
 *   4. parent inconnu mais nom normalisé UNIQUE sur le niveau         → « unique_niveau »
 *   5. proche (similarité ≥ 0,90, mêmes jetons discriminants)         → « a_valider » (jamais appliqué seul)
 *   6. plusieurs candidats aux étapes 2-4                             → « ambigu »
 *   7. rien                                                           → « introuvable »
 *
 * Les statuts 1 à 4 s'appliquent automatiquement ; 5 à 7 vont dans la file
 * « À rapprocher ». La valeur brute est toujours conservée par l'appelant.
 */

// ---- Normalisation ------------------------------------------------------------------
// Les articles qui suivent (« de », « d' ») sont retirés ensuite : « CR d'Ampanihy » → « ampanihy ».
const PREFIXES = ['commune urbaine', 'commune rurale', 'commune', 'cu', 'cr', 'district', 'region',
  'fokontany', 'fkt', 'ville'];
const ARTICLES = new Set(['de', 'd', 'du', 'des', 'la', 'le', 'l']);
const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
/** Synonymes préréglés pour Madagascar (points cardinaux : le français ramené au malgache). */
const MDG_SYNONYMS = { sud: 'atsimo', nord: 'avaratra', ouest: 'andrefana', est: 'atsinanana' };
const CARDINALS = new Set(['atsimo', 'avaratra', 'andrefana', 'atsinanana', 'sud', 'nord', 'ouest', 'est']);
const LONG_CARDINALS = [...CARDINALS].filter((c) => c.length >= 5);

/**
 * Clé de comparaison d'un libellé de lieu, identique des deux côtés.
 * @returns {{ key: string, guards: string }}  guards = nombres et points cardinaux (triés)
 */
function normPlace(label, { synonyms = MDG_SYNONYMS } = {}) {
  let s = String(label == null ? '' : label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/['’`\-_./\\,;:()]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const p of PREFIXES) {
    if (s.startsWith(`${p} `) && s.length > p.length + 1) { s = s.slice(p.length + 1); break; }
  }
  let tokens = s.split(' ').filter(Boolean);
  while (tokens.length > 1 && ARTICLES.has(tokens[0])) tokens = tokens.slice(1);
  tokens = tokens.map((t) => ROMAN[t] || synonyms[t] || t);
  const key = tokens.join(' ');
  const guards = tokens.map(guardOf).filter(Boolean).sort().join(' ');
  return { key, guards };
}

/**
 * Jeton discriminant : un nombre, ou un point cardinal — y compris mal orthographié
 * (« antsinanana » compte comme « atsinanana »), sinon une faute de frappe sur le
 * point cardinal empêcherait toute proposition.
 */
function guardOf(token) {
  if (/^\d+$/.test(token) || CARDINALS.has(token)) return token;
  if (token.length < 5) return null;
  for (const c of LONG_CARDINALS) if (similarity(token, c) >= FUZZY_MIN) return c;
  return null;
}

/** Une valeur a-t-elle la forme d'un pcode (MG51507090) ? */
const looksLikePcode = (s) => /^[A-Z]{2,3}\d{1,12}$/.test(String(s == null ? '' : s).trim().toUpperCase());

/** Similarité de Jaro-Winkler (0..1). */
function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false); const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j += 1) {
      if (!bm[j] && a[i] === b[j]) { am[i] = true; bm[j] = true; matches += 1; break; }
    }
  }
  if (!matches) return 0;
  let t = 0; let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!am[i]) continue;
    while (!bm[k]) k += 1;
    if (a[i] !== b[k]) t += 1;
    k += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}
const FUZZY_MIN = 0.9;

/** Distance d'édition (Levenshtein), deux lignes de mémoire. */
function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Similarité 0..1 = max(Jaro-Winkler, 1 − édition/longueur). Jaro-Winkler rate
 * les lettres insérées (« antsinanana » / « atsinanana » : 0,85) que la distance
 * d'édition voit à une lettre près (0,91).
 */
function similarity(a, b) {
  const jw = jaroWinkler(a, b);
  if (jw >= FUZZY_MIN) return jw;
  const max = Math.max(a.length, b.length);
  if (!max || Math.abs(a.length - b.length) > max * (1 - FUZZY_MIN)) return jw; // l'édition ne peut atteindre le seuil
  return Math.max(jw, 1 - levenshtein(a, b) / max);
}

// ---- Index du découpage -----------------------------------------------------------
/** Chemin « A > B > C » comparé niveau par niveau après normalisation. */
function pathKeyOf(path) { return String(path || '').split('>').map((seg) => normPlace(seg).key).join(' > '); }

/**
 * @param {object} p
 * @param {Array<{id, depth, name, pcode?, parentId?}>} p.areas   unités du découpage (admin_areas)
 * @param {Array<{depth, parentKey, aliasKey, targetPcode?, targetId?}>} [p.aliases] alias appris
 *        (parentKey = pcode du parent, sinon sa clé normalisée ; '' = tout le niveau)
 */
function buildPlaceIndex({ areas = [], aliases = [], synonyms = MDG_SYNONYMS } = {}) {
  const byId = new Map(); const byPcode = new Map();
  const inParent = new Map(); // `${depth}|${parentId||''}` → Map(key → area[])
  const inLevel = new Map();  // `${depth}` → Map(key → area[])
  const push = (map, k, key, a) => {
    if (!map.has(k)) map.set(k, new Map());
    const m = map.get(k); if (!m.has(key)) m.set(key, []); m.get(key).push(a);
  };
  for (const raw of areas) {
    const a = { ...raw, norm: normPlace(raw.name, { synonyms }) };
    byId.set(a.id, a);
    if (a.pcode) byPcode.set(String(a.pcode).trim().toUpperCase(), a);
    push(inParent, `${a.depth}|${a.parentId || ''}`, a.norm.key, a);
    push(inLevel, `${a.depth}`, a.norm.key, a);
  }
  const aliasMap = new Map();
  for (const al of aliases) aliasMap.set(`${al.depth || 0}|${al.parentKey || ''}|${al.aliasKey}`, al);
  // Chemin normalisé → unité (repli d'un alias dont l'unité a été recréée au réimport).
  const byPath = new Map();
  for (const a of byId.values()) if (a.path) byPath.set(pathKeyOf(a.path), a);
  return { byId, byPcode, byPath, inParent, inLevel, aliasMap, synonyms };
}

/** Clé d'un parent pour les alias : son pcode, sinon sa clé normalisée. */
const parentKeyOf = (area) => (area ? (area.pcode ? String(area.pcode).toUpperCase() : area.norm.key) : '');

const result = (status, area = null, candidates = []) => ({ status, area, candidates });

/** `area` est-elle `ancestor` ou l'un de ses descendants ? */
function isUnder(index, area, ancestor) {
  for (let a = area; a; a = a.parentId ? index.byId.get(a.parentId) : null) if (a.id === ancestor.id) return true;
  return false;
}

/**
 * Résout UN niveau.
 * @param {{ depth:number, label?:string, pcode?:string, parent?:object|null, within?:object|null }} q
 *        parent = unité résolue du niveau juste au-dessus ; within = ancêtre plus haut
 *        (quand le niveau intermédiaire n'a pas pu être résolu) qui borne la recherche.
 */
function resolvePlace(index, { depth, label, pcode, parent = null, within = null }) {
  const allowed = (a) => !within || isUnder(index, a, within);
  // 1. pcode (colonne dédiée, ou libellé qui en a la forme)
  for (const c of [pcode, label]) {
    if (c && looksLikePcode(c)) {
      const a = index.byPcode.get(String(c).trim().toUpperCase());
      if (a && (!depth || a.depth === depth)) return result('code', a);
    }
  }
  if (label == null || String(label).trim() === '') return result('vide');
  const { key, guards } = normPlace(label, { synonyms: index.synonyms });
  if (!key) return result('vide');
  // 2. nom normalisé dans le parent (sans parent : parmi les unités racines, ex. les régions)
  const pool = index.inParent.get(`${depth}|${parent ? parent.id : ''}`) || null;
  const inP = ((pool && pool.get(key)) || []).filter(allowed);
  if (inP.length === 1) return result(inP[0].name === String(label).trim() ? 'exact' : 'normalise', inP[0]);
  if (inP.length > 1) return result('ambigu', null, inP.map((a) => ({ area: a, score: 1 })));
  // 3. alias appris : dans le parent, puis sur tout le niveau
  for (const pk of [parent ? parentKeyOf(parent) : null, '']) {
    if (pk === null) continue;
    const al = index.aliasMap.get(`${depth}|${pk}|${key}`);
    if (!al) continue;
    const target = (al.targetPcode && index.byPcode.get(String(al.targetPcode).toUpperCase()))
      || (al.targetId && index.byId.get(al.targetId))
      || (al.targetPath && index.byPath && index.byPath.get(pathKeyOf(al.targetPath)));
    if (target && allowed(target) && (!parent || isUnder(index, target, parent))) return result('alias', target);
  }
  // 4. parent inconnu : nom normalisé unique sur le niveau (sous l'ancêtre connu)
  const level = index.inLevel.get(`${depth}`) || new Map();
  if (!parent) {
    const lv = (level.get(key) || []).filter(allowed);
    if (lv.length === 1) return result('unique_niveau', lv[0]);
    if (lv.length > 1) return result('ambigu', null, lv.map((a) => ({ area: a, score: 1 })));
  }
  // 5. proches (dans le parent, sinon sur le niveau), jetons discriminants identiques
  const scope = parent ? [...(pool || new Map()).values()].flat() : [...level.values()].flat().filter(allowed);
  const near = scope
    .filter((a) => a.norm.guards === guards)
    .map((a) => ({ area: a, score: Math.round(similarity(key, a.norm.key) * 1000) / 1000 }))
    .filter((c) => c.score >= FUZZY_MIN)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
  if (near.length) return result('a_valider', null, near);
  // 5 bis. graphie TRONQUÉE (« Betioky » → « Betioky Atsimo ») : proposition à valider,
  // jamais appliquée ; un nombre différent n'est jamais proposé (« Toliara 1 » ≠ « Toliara 2 »).
  const truncated = scope
    .filter((a) => a.norm.key.startsWith(`${key} `) && !/\d/.test(a.norm.key.slice(key.length)))
    .map((a) => ({ area: a, score: Math.round(similarity(key, a.norm.key) * 1000) / 1000, partial: true }))
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
  if (truncated.length) return result('a_valider', null, truncated);
  return result('introuvable');
}

// « deduit » : niveau approché (a_valider) confirmé par un niveau plus fin résolu
// dont la lignée passe par l'un des candidats — deux indices indépendants.
const AUTO = new Set(['code', 'exact', 'normalise', 'alias', 'unique_niveau', 'deduit']);
/** Statut appliqué automatiquement (sinon : file « À rapprocher »). */
const isAutomatic = (status) => AUTO.has(status);

/**
 * Résout un chemin région → district → commune → fokontany, chaque niveau dans
 * son parent résolu ; si un niveau échoue, le suivant est cherché sous le
 * dernier ancêtre résolu. Un niveau fin résolu remonte sa lignée (pcodes).
 * @param {{ adm1?, adm2?, adm3?, adm4?, pcodes?: {adm1?,adm2?,adm3?,adm4?} }} q
 * @returns {{ levels: Array<{depth,label,status,area,candidates}>, finest: object|null, pcodes: object, status: string }}
 *          status = 'resolu' | 'vide' | statut du premier niveau en attente ;
 *          finest = unité la plus fine résolue (utilisable même si un niveau au-dessus reste à valider).
 */
function resolvePath(index, q = {}) {
  const levels = []; let anchor = null;
  for (let depth = 1; depth <= 4; depth += 1) {
    const label = q[`adm${depth}`]; const pcode = q.pcodes && q.pcodes[`adm${depth}`];
    if ((label == null || String(label).trim() === '') && !pcode) { levels.push({ depth, label: label ?? null, ...result('vide') }); continue; }
    // Niveau absent du découpage (ex. découpage à 2 niveaux, commune fournie) : ni résolu ni « à rapprocher ».
    if (!index.inLevel.has(`${depth}`)) { levels.push({ depth, label, ...result('hors_niveau') }); continue; }
    const parent = anchor && anchor.depth === depth - 1 ? anchor : null;
    const r = resolvePlace(index, { depth, label, pcode, parent, within: parent ? null : anchor });
    levels.push({ depth, label, ...r });
    if (r.area && isAutomatic(r.status)) anchor = r.area;
  }
  const finest = anchor;
  const pcodes = {}; const lineage = new Map();
  for (let a = finest; a; a = a.parentId ? index.byId.get(a.parentId) : null) {
    pcodes[`adm${a.depth}`] = a.pcode || null; lineage.set(a.depth, a);
  }
  for (const l of levels) {
    const anc = lineage.get(l.depth);
    if (l.status === 'a_valider' && anc && l.candidates.some((c) => c.area.id === anc.id)) {
      l.status = 'deduit'; l.area = anc;
    }
  }
  const given = levels.filter((l) => l.status !== 'vide' && l.status !== 'hors_niveau');
  const pending = given.find((l) => !isAutomatic(l.status));
  return { levels, finest, pcodes, status: pending ? pending.status : (given.length ? 'resolu' : 'vide') };
}

// ---- Chemins (« Région > District > … ») ------------------------------------------
/** Chemin comparé segment par segment après normalisation. */
const pathKey = pathKeyOf;

/**
 * Références (zones de contrat, d'avenant…) dont l'unité a disparu : retrouvées
 * par chemin normalisé, seulement si la correspondance est UNIQUE.
 * @param {Array<{ref, path}>} items
 * @param {Array<{id, path}>} areas
 * @returns {Map<ref, areaId>}
 */
function relinkByPath(items, areas) {
  const byKey = new Map();
  for (const a of areas) {
    const k = pathKey(a.path);
    byKey.set(k, byKey.has(k) ? null : a.id); // null = ambigu
  }
  const out = new Map();
  for (const it of items) {
    const id = byKey.get(pathKey(it.path));
    if (id) out.set(it.ref, id);
  }
  return out;
}

// ---- Bureaux ----------------------------------------------------------------------
// Noms de bureaux : les noms français usuels des villes sont fréquents dans les
// étiquettes des exports (« Tulear » = Bureau Toliara). Réservé aux bureaux : dans
// le découpage, « Tuléar » reste une graphie à valider (Toliara I ou II ?).
const OFFICE_SYNONYMS = {
  tulear: 'toliara', majunga: 'mahajanga', tamatave: 'toamasina', diego: 'antsiranana',
  taolagnaro: 'fort dauphin', tolagnaro: 'fort dauphin', taolanaro: 'fort dauphin',
};
const officeNorm = (s) => normPlace(s, { synonyms: OFFICE_SYNONYMS }).key;
/**
 * Résolveur de bureau par libellé (« RBJ Madagascar, Ampanihy Sub Office » →
 * Bureau Ampanihy) : code ou nom exact normalisé, sinon nom « cœur » (sans
 * « bureau / sous-bureau / antenne ») contenu dans le libellé ; le plus long gagne.
 * @param {Array<{id, code, name, active?}>} offices
 * @param {{ includeInactive?: boolean }} [opts]  vrai pour relire des PARAMÈTRES (dérogations MMR
 *        d'un bureau fermé) ; jamais pour rattacher des données nouvelles.
 * @returns {(label: string) => object|null}
 */
function officeResolver(offices, { includeInactive = false } = {}) {
  const list = includeInactive ? offices : offices.filter((o) => o.active !== false);
  const exact = new Map();
  for (const o of list) { exact.set(officeNorm(o.code), o); exact.set(officeNorm(o.name), o); }
  const cores = list.map((o) => [officeNorm(o.name).replace(/^(bureau|sous bureau|antenne)\s+/, ''), o])
    .filter(([core]) => core.length >= 3).sort((a, b) => b[0].length - a[0].length);
  return (label) => {
    const n = officeNorm(label);
    if (!n) return null;
    if (exact.has(n)) return exact.get(n);
    const hit = cores.find(([core]) => (` ${n} `).includes(` ${core} `));
    return hit ? hit[1] : null;
  };
}

/**
 * Bureau d'une ligne importée : libellé (code, nom, nom « cœur ») d'abord, sinon
 * la commune résolue cherchée dans les périmètres, du bureau le plus spécifique
 * (périmètre le plus petit) au plus général. Plusieurs bureaux de même niveau →
 * « ambigu » (file). Bureaux actifs uniquement.
 * @param {Array<{id, code, name, active?, communes?: string[]}>} offices  communes = pcodes du périmètre
 */
function buildOfficeIndex(offices) {
  const active = offices.filter((o) => o.active !== false);
  const byCommune = new Map();
  for (const o of active) {
    for (const pc of o.communes || []) {
      const k = String(pc).trim().toUpperCase();
      if (!byCommune.has(k)) byCommune.set(k, []);
      byCommune.get(k).push(o);
    }
  }
  return { byLabel: officeResolver(active), byCommune };
}

function resolveOffice(officeIndex, { label, commune } = {}) {
  const byLabel = label ? officeIndex.byLabel(label) : null;
  if (byLabel) return { status: 'libelle', office: byLabel, candidates: [] };
  const list = commune ? officeIndex.byCommune.get(String(commune).trim().toUpperCase()) || [] : [];
  if (!list.length) return { status: label ? 'introuvable' : 'vide', office: null, candidates: [] };
  const size = (o) => (o.communes || []).length;
  const smallest = Math.min(...list.map(size));
  const best = list.filter((o) => size(o) === smallest);
  if (best.length === 1) return { status: 'perimetre', office: best[0], candidates: [] };
  return { status: 'ambigu', office: null, candidates: best };
}

/**
 * Regroupe les non-résolus pour la file « À rapprocher » : une entrée par
 * (niveau, parent, graphie), avec le nombre d'occurrences.
 * @param {Array<{ depth, parent?, label, status, candidates }>} items
 */
function groupUnmatched(items, { synonyms = MDG_SYNONYMS } = {}) {
  const out = new Map();
  for (const it of items) {
    if (isAutomatic(it.status) || it.status === 'vide' || it.status === 'hors_niveau') continue;
    const rawKey = normPlace(it.label, { synonyms }).key;
    const parentKey = it.parent ? parentKeyOf(it.parent) : '';
    const k = `${it.depth}|${parentKey}|${rawKey}`;
    if (!out.has(k)) {
      out.set(k, { kind: 'zone', depth: it.depth, parentKey, parentLabel: it.parent ? it.parent.name : null, rawKey, rawLabel: String(it.label).trim(), count: 0, status: it.status,
        candidates: (it.candidates || []).map((c) => ({ pcode: c.area.pcode || null, name: c.area.name, id: c.area.id, score: c.score })) });
    }
    out.get(k).count += it.count || 1;
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

module.exports = {
  normPlace, looksLikePcode, jaroWinkler, levenshtein, similarity, buildPlaceIndex, resolvePlace, resolvePath, isAutomatic, parentKeyOf,
  pathKey, relinkByPath, officeResolver, buildOfficeIndex, resolveOffice, groupUnmatched, MDG_SYNONYMS, FUZZY_MIN,
};
