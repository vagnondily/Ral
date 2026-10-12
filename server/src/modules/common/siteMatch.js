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
 *   5. nom proche ou contenu (dans la zone), ou nom identique unique
 *      hors de toute zone connue                                     → « a_valider »
 *   6. plusieurs sites possibles                                     → « ambigu »
 *   7. rien                                                          → « introuvable »
 * Quand le formulaire est rattaché à une activité, seuls les sites de cette
 * activité sont candidats (s'il y en a dans la zone).
 */
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

/** Restreint aux sites de l'activité du formulaire, s'il y en a parmi les candidats. */
function forActivity(list, activity) {
  if (!activity || !list.length) return list;
  const a = lower(activity);
  const hit = list.filter((s) => lower(s.activity) === a);
  return hit.length ? hit : list;
}

const result = (status, site = null, candidates = [], extra = {}) => ({ status, site, candidates, ...extra });
const one = (list, status) => (list.length === 1 ? result(status, list[0]) : result('ambigu', null, list.map((s) => ({ site: s, score: 1 }))));

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
  const activity = q.activity || null;
  const commune = q.adm3 ? String(q.adm3).toUpperCase() : null;
  const district = q.adm2 ? String(q.adm2).toUpperCase() : null;

  // 1. Code ou ID RBM ; puis un code déjà relié à la main (école, point de distribution).
  const byCode = forActivity(index.byCode.get(raw.toUpperCase()) || [], activity);
  if (byCode.length) return one(byCode, 'code');
  const keyQ = queueKeyOf(q);
  const learned = index.aliases.get(`${keyQ.parentKey}|${keyQ.rawKey}`);
  if (learned) return result('alias', learned);

  // 2. Pcode de fokontany (avec ou sans n° de site).
  if (looksLikePcode(raw)) {
    const direct = forActivity(index.byAdm4.get(raw.toUpperCase()) || [], activity);
    if (direct.length) return one(direct, 'lieu');
    const area = areaFromPcode(raw, q.areaOf);
    if (area && area.depth >= 4) {
      const inArea = forActivity(index.byAdm4.get(String(area.pcode).toUpperCase()) || [], activity);
      if (inArea.length === 1) return result('lieu', inArea[0], [], { area });
      const parent = area.parentPcode ? String(area.parentPcode).toUpperCase() : commune;
      const pool = forActivity(index.byAdm3.get(parent) || [], activity);
      const key = siteKey(area.name);
      const exact = pool.filter((s) => s.key === key);
      if (exact.length) return { ...one(exact, 'lieu'), area };
      const containing = pool.filter((s) => ` ${s.key} `.includes(` ${key} `));
      if (containing.length === 1) return result('deduit', containing[0], [], { area });
      const cands = containing.length ? containing.map((s) => ({ site: s, score: FUZZY_MIN })) : rank(pool, key);
      return result(containing.length > 1 ? 'ambigu' : 'introuvable', null, cands, { area });
    }
    if (!q.label) return result('introuvable', null, [], { area: area || null });
  }

  // 3-5. Nom (libellé du choix s'il existe, sinon la valeur saisie).
  const label = q.label && String(q.label).trim() ? String(q.label).trim() : raw;
  const key = siteKey(label);
  if (!key) return result('introuvable');
  const alias = index.aliases.get(`${commune || ''}|${key}`) || index.aliases.get(`${district || ''}|${key}`) || index.aliases.get(`|${key}`);
  if (alias) return result('alias', alias);

  const zone = commune && index.byAdm3.has(commune) ? 'commune' : district && index.byAdm2.has(district) ? 'district' : null;
  const pool = forActivity(zone === 'commune' ? index.byAdm3.get(commune) : zone === 'district' ? index.byAdm2.get(district) : index.all, activity);
  const exact = pool.filter((s) => s.key === key);
  if (exact.length === 1) return zone ? result('nom', exact[0]) : result('a_valider', null, [{ site: exact[0], score: 1 }]);
  if (exact.length > 1) return result('ambigu', null, exact.map((s) => ({ site: s, score: 1 })));
  // Hors de toute zone connue, un nom seulement PROCHE n'est pas proposé : sur tout le
  // pays, « Behara I » ressemble à « Bezaha I » sans rien à voir (bruit pour l'utilisateur).
  if (!zone) return result('introuvable');
  const cands = rank(pool, key);
  const sure = cands.filter((c) => c.score >= FUZZY_MIN);
  if (sure.length) return result(sure.length === 1 ? 'a_valider' : 'ambigu', null, cands);
  return result('introuvable', null, cands);
}

const isCode = (v) => looksLikePcode(v) || /^\d{3,}$/.test(v);

/**
 * Clé d'une valeur non reconnue, pour la file « À rapprocher » et la graphie
 * apprise (mêmes clés des deux côtés) : un CODE (école, pcode) vaut pour tout
 * le pays ; un NOM vaut dans sa commune (sinon son district).
 * @returns {{ parentKey: string, rawKey: string, rawLabel: string }}
 */
function queueKeyOf({ value, label, adm2, adm3 }) {
  const raw = String(value == null ? '' : value).trim();
  const lab = label && String(label).trim() && String(label).trim() !== raw ? String(label).trim() : null;
  if (lab || isCode(raw)) return { parentKey: '', rawKey: `code:${raw.toUpperCase()}`, rawLabel: lab ? `${lab} (${raw})` : raw };
  return { parentKey: String(adm3 || adm2 || '').toUpperCase(), rawKey: siteKey(raw), rawLabel: raw };
}

const isAutomaticSite = (status) => AUTO.has(status);

module.exports = { siteKey, buildSiteIndex, resolveSite, queueKeyOf, isAutomaticSite, SITE_PREFIXES };
