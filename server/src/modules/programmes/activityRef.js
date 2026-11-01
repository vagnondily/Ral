/**
 * Référentiel des ACTIVITÉS DE PROGRAMME (suivi de processus) — règles PURES, testées, sans I/O
 * (migration 105). Le dépôt lit les lignes ; ce module décide.
 *
 * - Résolution d'un texte libre (sites.activity, MMR, fiche, visite, PDD, import…) : sa clé
 *   normalisée (activityKey) désigne une activité par un ALIAS (libellé officiel, code, ancien
 *   libellé, graphie reliée à la main). Jumelle de la lecture SQL (programmeActivitySql) : seul
 *   l'alias compte, « À classer » n'est jamais désigné.
 * - Une saisie inconnue est REFUSÉE avec des propositions (« vouliez-vous dire … ? »), jamais créée.
 * - « Utilisé par » : comptes par module, nommés comme la politique de suppression (retour 56).
 * - Fusion, renommage, conversion en sous-activité : contrôles avant toute écriture.
 */
const { activityKey, aliasKeyOf, cleanLabel } = require('./activityKey');
const { similarity } = require('../common/placeMatch');

// ---- « Utilisé par » ---------------------------------------------------------------
/** Libellés (singulier, pluriel) par module, dans l'ordre d'affichage. L'écran traduit les mêmes clés. */
const USAGE_LABELS = Object.freeze({
  sites: ['site', 'sites'],
  mmr: ['exigence MMR', 'exigences MMR'],
  forms: ['fiche de suivi', 'fiches de suivi'],
  visits: ['visite de terrain', 'visites de terrain'],
  pdd: ['ligne du PDD', 'lignes du PDD'],
  subActivities: ['sous-activité', 'sous-activités'],
  contracts: ['contrat', 'contrats'],
  budgetLines: ['ligne de budget FLA', 'lignes de budget FLA'],
  postes: ['poste de facture ou de plan', 'postes de facture ou de plan'],
});

/**
 * Comptes non nuls, dans l'ordre de USAGE_LABELS : [{ key, count, label }].
 * @param {Record<string, number>} counts
 */
function usageSummary(counts = {}) {
  const out = [];
  for (const [key, [one, many]] of Object.entries(USAGE_LABELS)) {
    const n = Math.max(0, Math.trunc(Number(counts?.[key]) || 0));
    if (n > 0) out.push({ key, count: n, label: n === 1 ? one : many });
  }
  return out;
}

/** « 12 sites, 3 exigences MMR » (chaîne vide si rien). */
function usageText(list = []) {
  return list.map((l) => `${l.count} ${l.label}`).join(', ');
}

/** Une donnée au moins désigne-t-elle cet élément ? */
const isUsed = (counts = {}) => usageSummary(counts).length > 0;

// ---- Résolution ---------------------------------------------------------------------
/**
 * Index de résolution (bornés : quelques dizaines d'activités).
 * @param {object} p
 * @param {Array<{id, code, label, shortLabel?, active?, bucket?}>} p.activities
 * @param {Array<{aliasKey: string, programmeActivityId: string}>} p.aliases
 * @param {Array<{code: string, label?: string, programmeActivityId: string}>} [p.subActivities]
 */
function buildResolver({ activities = [], aliases = [], subActivities = [] } = {}) {
  const byId = new Map(activities.filter((a) => !a.bucket).map((a) => [a.id, a]));
  const byKey = new Map();
  for (const al of aliases) {
    const a = byId.get(al.programmeActivityId);
    if (a && !byKey.has(al.aliasKey)) byKey.set(al.aliasKey, a);
  }
  const subByKey = new Map();
  for (const s of subActivities) {
    const k = aliasKeyOf(s.code);
    if (k && !subByKey.has(k)) subByKey.set(k, s);
  }
  /** Activité désignée par un texte, ou null (texte vide, inconnu, ou « À classer »). */
  const resolve = (text) => {
    const k = aliasKeyOf(text);
    return k ? byKey.get(k) || null : null;
  };
  /** Sous-activité (Activity_tag) désignée par un code, ou null. */
  const resolveSub = (code) => {
    const k = aliasKeyOf(code);
    return k ? subByKey.get(k) || null : null;
  };
  /** Libellé officiel si le texte est reconnu ; sinon le texte nettoyé (ou null s'il est vide). */
  const canonical = (text) => {
    const a = resolve(text);
    return a ? a.label : (cleanLabel(text) || null);
  };
  return { resolve, resolveSub, canonical, byId, activities: [...byId.values()] };
}

/**
 * Propositions pour un texte inconnu : libellés officiels les plus proches (libellé, libellé
 * court, code), et l'activité d'une sous-activité dont c'est le code (« SMP » → « School meal
 * activities »). Jamais appliquées : seulement montrées.
 * @returns {string[]} libellés officiels, du plus proche au moins proche
 */
function suggestActivities(text, resolver, { max = 3, min = 0.75 } = {}) {
  const k = activityKey(text);
  if (!k) return [];
  const scores = new Map();
  const bump = (a, s) => { if (a && s > (scores.get(a.id)?.s ?? 0)) scores.set(a.id, { a, s }); };
  const sub = resolver.resolveSub(text);
  if (sub) bump(resolver.byId.get(sub.programmeActivityId), 2);
  for (const a of resolver.activities) {
    for (const cand of [a.label, a.shortLabel, a.code]) {
      const ck = activityKey(cand);
      if (!ck) continue;
      let s = similarity(k, ck);
      if (k.length >= 3 && (ck.startsWith(k) || ck.includes(k))) s = Math.max(s, 0.8);
      bump(a, s);
    }
  }
  return [...scores.values()]
    .filter((x) => x.s >= min)
    // Plus proche d'abord ; à égalité, active avant désactivée, puis ordre alphabétique.
    .sort((x, y) => (y.s - x.s) || (Number(x.a.active === false) - Number(y.a.active === false)) || x.a.label.localeCompare(y.a.label, 'fr'))
    .slice(0, max)
    .map((x) => x.a.label);
}

/**
 * Message du refus d'une activité inconnue (400), même phrase partout (saisie et import).
 * « Activité inconnue « X » — vouliez-vous dire « Y » ? Créez-la dans Paramétrage › Activités. »
 */
function unknownActivityMessage(text, suggestions = []) {
  const shown = cleanLabel(text).slice(0, 80);
  const hint = suggestions.length ? ` — vouliez-vous dire ${suggestions.map((s) => `« ${s} »`).join(' ou ')} ?` : '.';
  return `Activité inconnue « ${shown} »${hint} Créez-la dans Paramétrage › Activités.`;
}

/** Détails joints au refus (lus par l'écran pour la phrase traduite). */
const unknownActivityDetails = (text, suggestions = []) => ({ code: 'unknown_activity', value: cleanLabel(text).slice(0, 160), suggestions });

/**
 * Sous-activité incompatible avec l'activité choisie (site : Activity_tag d'une autre activité).
 */
function subActivityMismatchMessage(code, activityLabel, ownerLabel) {
  return `La sous-activité « ${code} » appartient à « ${ownerLabel} », pas à « ${activityLabel} ». Choisissez l'une de ses sous-activités, ou rangez-la dans Paramétrage › Activités.`;
}

// ---- Renommage, code, fusion ---------------------------------------------------------
/**
 * Contrôle d'un nouveau libellé ou d'un nouveau code : la clé ne doit désigner AUCUNE autre
 * activité (alias compris : un ancien libellé reste à son activité).
 * @param {string} text         libellé ou code proposé
 * @param {string|null} ownerId activité à laquelle la clé est déjà rattachée (null si libre)
 * @param {string} selfId       activité modifiée (null à la création)
 * @returns {{ ok: true, key: string } | { ok: false, reason: 'empty' | 'taken', ownerId?: string }}
 */
function checkKeyFree(text, ownerId, selfId = null) {
  const key = aliasKeyOf(text);
  if (!key) return { ok: false, reason: 'empty' };
  if (ownerId && ownerId !== selfId) return { ok: false, reason: 'taken', ownerId };
  return { ok: true, key };
}

/**
 * Fusion de `source` dans `target` (les alias de la source suivent, ses sous-activités aussi,
 * la source disparaît). Refusée : même activité, « À classer » des deux côtés, cible inconnue,
 * ou exigences MMR des deux activités pour une même portée (plan général ou bureau) — la fusion
 * rendrait deux exigences pour une seule activité.
 * @param {object} p
 * @param {{id, bucket?}|null} p.source
 * @param {{id, bucket?, active?}|null} p.target
 * @param {Array<{programmeActivityId: string, fieldOfficeId: string|null}>} [p.mmr] exigences MMR résolues des deux activités
 * @returns {{ ok: true } | { ok: false, reason: 'missing'|'same'|'bucket'|'inactive_target'|'mmr_conflict', scopes?: Array<string|null> }}
 */
function checkMerge({ source, target, mmr = [] }) {
  if (!source || !target) return { ok: false, reason: 'missing' };
  if (source.id === target.id) return { ok: false, reason: 'same' };
  if (source.bucket || target.bucket) return { ok: false, reason: 'bucket' };
  if (target.active === false) return { ok: false, reason: 'inactive_target' };
  const scopes = (who) => new Set(mmr.filter((r) => r.programmeActivityId === who).map((r) => r.fieldOfficeId || null));
  const fromSource = scopes(source.id); const fromTarget = scopes(target.id);
  const clash = [...fromSource].filter((s) => fromTarget.has(s));
  if (clash.length) return { ok: false, reason: 'mmr_conflict', scopes: clash };
  return { ok: true };
}

/** Informations de la cible complétées par celles de la source quand elles manquent (rien n'est écrasé). */
function mergeInfo(target, source) {
  const pick = (k) => (target[k] != null && String(target[k]).trim() !== '' ? target[k] : (source[k] ?? null));
  return { shortLabel: pick('shortLabel'), description: pick('description') };
}

/** Message d'un refus de fusion. */
function mergeRefusalMessage(check, { sourceLabel = '', targetLabel = '', officeName = (id) => id } = {}) {
  switch (check.reason) {
    case 'same': return 'Choisissez une autre activité que celle à fusionner.';
    case 'bucket': return '« À classer » ne se fusionne pas : rangez plutôt ses sous-activités sous une activité.';
    case 'inactive_target': return `« ${targetLabel} » est désactivée : réactivez-la avant d'y fusionner « ${sourceLabel} ».`;
    case 'mmr_conflict': {
      const where = check.scopes.map((s) => (s ? officeName(s) : 'plan général')).join(', ');
      return `« ${sourceLabel} » et « ${targetLabel} » ont chacune une exigence MMR (${where}) : supprimez l'une des deux dans Paramétrage › Paramètres MMR, puis fusionnez.`;
    }
    default: return 'Activité introuvable.';
  }
}

module.exports = {
  USAGE_LABELS, usageSummary, usageText, isUsed,
  buildResolver, suggestActivities, unknownActivityMessage, unknownActivityDetails, subActivityMismatchMessage,
  checkKeyFree, checkMerge, mergeInfo, mergeRefusalMessage,
};
