/**
 * Rapprochement d'un SITE déclaré dans un formulaire reçu (POIName, DPName,
 * ADMIN5Name_DP, école…) avec le référentiel des sites (RBM / plan de suivi) —
 * moteur PUR, testé, sans accès à la base. Même principe que placeMatch :
 * on propose, on n'applique seul que ce qui est sûr, la valeur brute reste.
 *
 * Ce que portent les exports réels (12/10/2026) :
 *   - un code de site du référentiel (code ou ID RBM « L123 ») ;
 *   - le pcode du fokontany du point de distribution (GD : MG52518010011), ou
 *     ce pcode suivi d'un numéro (MIARO : MG52516130033053) ;
 *   - un code d'école avec son nom dans l'export (cantines : 613100021 = « Maheny ») ;
 *   - un nom saisi (Nutrition « Vohipotsy_Iv », Résilience « MANIRY CENTRE »).
 *
 * Ordre de résolution (les 5 premiers statuts s'appliquent automatiquement) :
 *   1. code ou ID RBM du site                                        → « code »
 *   2. pcode : site du fokontany (adm4), ou site qui porte le nom
 *      du fokontany dans sa commune                                  → « lieu »
 *      un seul site de la commune dont le nom contient le fokontany  → « deduit »
 *   3. graphie apprise (validée une fois)                            → « alias »
 *   4. nom identique (normalisé) parmi les sites de la commune, ou
 *      du district quand la commune est inconnue                     → « nom »
 *   5. nom proche ou contenu (dans la zone), ou nom identique hors
 *      de toute zone connue                                          → « a_valider »
 *   6. plusieurs sites possibles                                     → « ambigu »
 *   7. rien                                                          → « introuvable » ; rien de lisible → « vide »
 * Garde-fous : « lieu », « deduit » et « nom » ne s'appliquent seuls que si la
 * fiche a une activité et que le site en relève (sinon proposition) ; jamais
 * entre numéros différents (I ≠ II) ; une graphie apprise sans zone ne
 * s'applique pas là où la commune est connue.
 */
const crypto = require('crypto');
const { normPlace, looksLikePcode, similarity, FUZZY_MIN } = require('./placeMatch');

const AUTO = new Set(['code', 'lieu', 'deduit', 'alias', 'nom']);
// Préfixes de type d'établissement, sans valeur pour reconnaître le site.
const SITE_PREFIXES = ['ecole primaire publique', 'ecole communautaire', 'ecole', 'epp', 'ceg', 'csb2', 'csb1', 'csb',
  'point de distribution', 'site', 'dp'];
const CANDIDATE_MIN = 0.75;

const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();

/** Clé de comparaison d'un nom de site (accents, casse, préfixes « EPP », « Site »… retirés). */
function siteKey(label) {
  let { key } = normPlace(label);
  for (const p of SITE_PREFIXES) {
    if (key.startsWith(`${p} `) && key.length > p.length + 1) { key = key.slice(p.length + 1); break; }
  }
  return key;
}
const guardsOf = (key) => key.split(' ').filter((t) => /^\d+$/.test(t)).sort().join(' ');

/**
 * @param {Array<{id, name, code?, locationId?, activity?, adm2Pcode?, adm3Pcode?, adm4Pcode?}>} sites
 * @param {{ aliases?: Array<{parentKey, aliasKey, targetId}> }} opts
 */
function buildSiteIndex(sites, { aliases = [] } = {}) {
  const push = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  const byCode = new Map(); const byAdm4 = new Map(); const byAdm3 = new Map(); const byAdm2 = new Map();
  const byId = new Map(); const all = [];
  for (const s of sites || []) {
    const site = { ...s, key: siteKey(s.name) };
    all.push(site); byId.set(site.id, site);
    push(byCode, s.code && String(s.code).trim().toUpperCase(), site);
    if (s.locationId && String(s.locationId).trim().toUpperCase() !== String(s.code || '').trim().toUpperCase()) {
      push(byCode, String(s.locationId).trim().toUpperCase(), site);
    }
    push(byAdm4, s.adm4Pcode && String(s.adm4Pcode).toUpperCase(), site);
    push(byAdm3, s.adm3Pcode && String(s.adm3Pcode).toUpperCase(), site);
    push(byAdm2, s.adm2Pcode && String(s.adm2Pcode).toUpperCase(), site);
  }
  const aliasMap = new Map();
  for (const a of aliases) if (byId.has(a.targetId)) aliasMap.set(`${a.parentKey || ''}|${a.aliasKey}`, byId.get(a.targetId));
  return { byCode, byAdm4, byAdm3, byAdm2, byId, all, aliases: aliasMap };
}

/**
 * Sites de l'activité du formulaire (ou sans activité renseignée). `sure` dit si
 * l'on peut appliquer seul : seulement quand la fiche a une activité ET que les
 * candidats en relèvent. Sans activité de fiche, ou si seuls des sites d'une
 * AUTRE activité correspondent (une distribution GD et l'école du même
 * fokontany), le résultat n'est qu'une proposition.
 */
function byActivity(list, activity) {
  if (!list.length || !activity) return { list, sure: false };
  const a = lower(activity);
  const hit = list.filter((s) => !s.activity || lower(s.activity) === a);
  return hit.length ? { list: hit, sure: true } : { list, sure: false };
}

const result = (status, site = null, candidates = [], extra = {}) => ({ status, site, candidates, ...extra });
/** Un seul site sûr → statut automatique ; un seul mais pas sûr → proposé ; plusieurs → ambigu. */
function decide(list, status, sure, extra = {}) {
  if (list.length === 1) return sure ? result(status, list[0], [], extra) : result('a_valider', null, [{ site: list[0], score: 1 }], extra);
  return result('ambigu', null, list.map((s) => ({ site: s, score: 1 })), extra);
}
const fromRanked = (cands, extra = {}) => {
  const sure = cands.filter((c) => c.score >= FUZZY_MIN);
  return result(sure.length > 1 ? 'ambigu' : sure.length === 1 ? 'a_valider' : 'introuvable', null, cands, extra);
};

/** Candidats proches d'une clé, du plus proche au moins proche (pour la file et le sélecteur). */
function rank(pool, key, limit = 5) {
  const g = guardsOf(key);
  return pool
    .map((s) => {
      const contains = s.key && key && (` ${s.key} `.includes(` ${key} `) || ` ${key} `.includes(` ${s.key} `));
      const score = Math.max(similarity(s.key, key), contains ? FUZZY_MIN : 0);
      return { site: s, score: guardsOf(s.key) === g ? score : Math.min(score, CANDIDATE_MIN - 0.01) };
    })
    .filter((c) => c.score >= CANDIDATE_MIN)
    .sort((a, b) => b.score - a.score || a.site.name.localeCompare(b.site.name))
    .slice(0, limit);
}

/** Unité administrative la plus fine reconnue dans un pcode (préfixes de plus en plus courts : MIARO ajoute un n° au fokontany). */
function areaFromPcode(value, areaOf) {
  if (!areaOf) return null;
  const v = String(value).trim().toUpperCase();
  for (let n = v.length; n >= 4; n -= 1) {
    const a = areaOf(v.slice(0, n));
    if (a) return a;
  }
  return null;
}

/**
 * @param {ReturnType<typeof buildSiteIndex>} index
 * @param {{ value: any, label?: string, adm2?: string, adm3?: string, activity?: string,
 *           areaOf?: (pcode: string) => ({ pcode, name, depth, parentPcode } | null) }} q
 *   value = valeur brute ; label = son libellé (liste de choix) s'il est connu ;
 *   adm2/adm3 = pcodes du district et de la commune de la soumission.
 */
function resolveSite(index, q) {
  const raw = q.value == null ? '' : String(q.value).trim();
  if (!raw) return result('vide');
  const RAW = raw.toUpperCase();
  const activity = q.activity || null;
  const commune = q.adm3 ? String(q.adm3).toUpperCase() : null;
  const district = q.adm2 ? String(q.adm2).toUpperCase() : null;

  // 1. Code ou ID RBM du site : identité explicite, appliquée même hors activité si elle est unique.
  const byCode = index.byCode.get(RAW) || [];
  if (byCode.length) {
    const { list } = byActivity(byCode, activity);
    return list.length === 1 ? result('code', list[0]) : decide(list, 'code', false);
  }
  // Code national (pcode, code d'école) relié une fois à la main : reconnu partout.
  if (isNationalCode(raw)) {
    const learned = index.aliases.get(`|${boundKey(`code:${RAW}`)}`);
    if (learned) return result('alias', learned);
  }

  // 2. Pcode de fokontany (avec ou sans n° de site, MIARO).
  if (looksLikePcode(raw)) {
    const direct = byActivity(index.byAdm4.get(RAW) || [], activity);
    if (direct.list.length) return decide(direct.list, 'lieu', direct.sure);
    const area = areaFromPcode(raw, q.areaOf);
    if (area && area.depth >= 4) {
      const fkt = String(area.pcode).toUpperCase();
      const inArea = byActivity(index.byAdm4.get(fkt) || [], activity);
      if (inArea.list.length) return decide(inArea.list, 'lieu', inArea.sure, { area });
      const parent = area.parentPcode ? String(area.parentPcode).toUpperCase() : commune;
      const { list: pool, sure } = byActivity(index.byAdm3.get(parent) || [], activity);
      const key = siteKey(area.name);
      const g = guardsOf(key);
      // Même nom ou nom qui le contient, MAIS mêmes numéros (Beavake ≠ BEAVAKE I) et pas un site d'un autre fokontany.
      const ok = (s) => guardsOf(s.key) === g && (!s.adm4Pcode || String(s.adm4Pcode).toUpperCase() === fkt);
      const exact = pool.filter((s) => s.key === key && ok(s));
      if (exact.length) return decide(exact, 'lieu', sure, { area });
      const containing = pool.filter((s) => ` ${s.key} `.includes(` ${key} `) && ok(s));
      if (containing.length === 1) return decide(containing, 'deduit', sure, { area });
      if (containing.length > 1) return result('ambigu', null, containing.map((s) => ({ site: s, score: FUZZY_MIN })), { area });
      return fromRanked(rank(pool, key), { area });
    }
    if (!q.label) return result('introuvable', null, [], { area: area || null });
  }

  // 3-5. Nom : libellé du choix s'il existe, sinon la valeur saisie ; cherché dans la zone la plus fine connue.
  const label = q.label && String(q.label).trim() ? String(q.label).trim() : raw;
  const key = siteKey(label);
  if (!key) return result('vide'); // « - », « . », « / » : rien de reconnaissable, rien à rapprocher
  const bk = boundKey(key);
  const inPool = (sites) => {
    const { list: pool, sure } = byActivity(sites, activity);
    const exact = pool.filter((s) => s.key === key);
    if (exact.length) return decide(exact, 'nom', sure);
    return fromRanked(rank(pool, key));
  };
  if (commune) {
    const learned = index.aliases.get(`${commune}|${bk}`);
    if (learned) return result('alias', learned);
    if (index.byAdm3.has(commune)) return inPool(index.byAdm3.get(commune));
    // Commune connue mais sans site enregistré : un homonyme du district n'est qu'une proposition.
    const exact = district ? byActivity(index.byAdm2.get(district) || [], activity).list.filter((s) => s.key === key) : [];
    return exact.length ? result(exact.length === 1 ? 'a_valider' : 'ambigu', null, exact.map((s) => ({ site: s, score: 1 }))) : result('introuvable');
  }
  if (district) {
    const learned = index.aliases.get(`${district}|${bk}`);
    if (learned) return result('alias', learned);
    return index.byAdm2.has(district) ? inPool(index.byAdm2.get(district)) : result('introuvable');
  }
  // Aucune zone connue : graphie apprise sans zone, sinon nom identique proposé (jamais appliqué seul).
  const learned = index.aliases.get(`|${bk}`);
  if (learned) return result('alias', learned);
  const exact = byActivity(index.all, activity).list.filter((s) => s.key === key);
  // Hors de toute zone, un nom seulement PROCHE n'est pas proposé : « Behara I » ressemble à « Bezaha I ».
  return exact.length ? result(exact.length === 1 ? 'a_valider' : 'ambigu', null, exact.map((s) => ({ site: s, score: 1 }))) : result('introuvable');
}

// Code valable dans tout le pays : pcode, ou code numérique long (code national d'une école).
// Un petit code de liste (« 3 ») ne l'est pas : il ne vaut que par son libellé, dans sa zone.
const isNationalCode = (v) => looksLikePcode(v) || /^\d{6,}$/.test(String(v));
const MAX_KEY = 200;
/** Clé bornée à la taille de la colonne (200) : au-delà, début + empreinte (deux clés longues restent distinctes). */
function boundKey(k) {
  if (k.length <= MAX_KEY) return k;
  return `${k.slice(0, 180)}#${crypto.createHash('sha1').update(k).digest('hex').slice(0, 16)}`;
}

/**
 * Clé d'une valeur non reconnue, pour la file « À rapprocher » et la graphie
 * apprise (mêmes clés des deux côtés) : un CODE national (pcode, école) vaut
 * pour tout le pays ; un NOM (ou le libellé d'un petit code de liste) vaut dans
 * sa commune, sinon son district. rawKey vide = rien à rapprocher.
 * @returns {{ parentKey: string, rawKey: string, rawLabel: string }}
 */
function queueKeyOf({ value, label, adm2, adm3 }) {
  const raw = String(value == null ? '' : value).trim();
  const lab = label && String(label).trim() && String(label).trim() !== raw ? String(label).trim() : null;
  const rawLabel = (lab ? `${lab} (${raw})` : raw).slice(0, 200);
  if (isNationalCode(raw)) return { parentKey: '', rawKey: boundKey(`code:${raw.toUpperCase()}`), rawLabel };
  const key = siteKey(lab || raw);
  return { parentKey: String(adm3 || adm2 || '').toUpperCase(), rawKey: key ? boundKey(key) : '', rawLabel };
}

const isAutomaticSite = (status) => AUTO.has(status);

module.exports = { siteKey, buildSiteIndex, resolveSite, queueKeyOf, isAutomaticSite, boundKey, SITE_PREFIXES };
