/**
 * Modèles d'indicateurs par activité (retours n° 12, 66 et 85) — logique PURE, testée.
 *
 * Le catalogue (indicatorTemplates.json) reprend les modèles de tableau de bord
 * et de rapport du suivi de processus, vérifiés contre les 5 XLSForm réels
 * (docs/ANALYSE_XLSFORM.md, docs/SPEC_INDICATEURS_FICHES.md) : pour chaque
 * activité du MMR, ses domaines (D… / R… notés ; M… et KPI complémentaires),
 * ses indicateurs (méthode, sens, valeur comptée, réponses hors base, cible quand
 * le formulaire en fixe une, variables des formulaires réels qui les mesurent).
 *
 * Une fiche rattachée à une activité reçoit le modèle ; il ne reste qu'à
 * vérifier, pour chaque indicateur, la variable du XLSForm proposée ici :
 *   1. variable du modèle trouvée telle quelle dans la fiche  → « sure »
 *   2. autre variable connue pour cet indicateur              → « probable »
 *   3. question de libellé très proche                         → « a_verifier »
 *   4. rien                                                    → pas de proposition
 * Les contrôles de type et de liste, la sous-table et le choix du modèle d'après
 * les variables de la fiche sont dans indicatorProposals.js. Rien n'est créé
 * sans l'accord de l'utilisateur.
 *
 * Règles du catalogue (tests) : un code d'élément ou le libellé d'un domaine
 * existant ne change JAMAIS (les indicateurs déjà créés gardent leur code et
 * leur domaine : un domaine renommé couperait le profil par module en deux) ;
 * une réponse « Autre » (999…) n'est jamais hors base.
 */
const CATALOG = require('./indicatorTemplates.json');
const { normPlace, similarity } = require('../common/placeMatch');

const LABEL_MIN = 0.86;
const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();
// Colonnes éclatées des questions à choix multiples : « Q/4 » (Excel) = « Q.4 » (SPSS).
const nameKey = (s) => lower(s).replace(/[./]/g, '/');
const labelKey = (s) => normPlace(String(s || '').replace(/[?:«»"]/g, ' ')).key;

/**
 * Clé de comparaison d'une catégorie du MMR : sans accents, casse ni espaces
 * en trop. La MÊME règle sert à la route (rattachement d'une fiche) et au choix
 * du modèle : un libellé « School  meal Activities » trouve son modèle.
 */
function mmrKey(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Catégories du MMR d'un modèle : la principale, puis celles qu'il couvre aussi. */
function templateCategories(template) {
  return [template.mmrCategory, ...(template.alsoFor || [])].filter(Boolean);
}

/** Toutes les clés reconnues pour un modèle (catégories + libellés équivalents, ex. en français). */
function templateKeys(template) {
  return new Set([...templateCategories(template), ...(template.mmrAliases || [])].map(mmrKey));
}

/** Modèle de l'activité (catégorie du MMR, ou un libellé équivalent), ou null. */
function templateForActivity(activityCategory, catalog = CATALOG) {
  const k = mmrKey(activityCategory);
  if (!k) return null;
  return catalog.activities.find((t) => mmrKey(t.mmrCategory) === k)
    || catalog.activities.find((t) => templateKeys(t).has(k))
    || null;
}

/** Modèle par sa clé (« GD », « RES »…), ou null. */
function templateByKey(key, catalog = CATALOG) {
  return catalog.activities.find((t) => t.key === key) || null;
}

/**
 * Catégorie du MMR du compte à laquelle rattacher une fiche pour ce modèle :
 * la principale si le MMR la contient, sinon une catégorie couverte, sinon un
 * libellé équivalent. Renvoie le libellé EXACT du MMR, ou null s'il n'y est pas.
 */
function tenantCategoryFor(template, tenantCategories) {
  const byKey = new Map();
  for (const c of tenantCategories || []) if (c && !byKey.has(mmrKey(c))) byKey.set(mmrKey(c), String(c).trim());
  for (const c of templateCategories(template)) if (byKey.has(mmrKey(c))) return byKey.get(mmrKey(c));
  for (const a of template.mmrAliases || []) if (byKey.has(mmrKey(a))) return byKey.get(mmrKey(a));
  return null;
}

/** Libellé de domaine stocké dans `module` : « D1 · Conformité gestion distribution ». */
function moduleLabel(template, code) {
  const d = (template.domains || []).find((x) => x.code === code);
  return d ? `${d.code} · ${d.label}` : code;
}

/**
 * Valeur positive à retenir pour la variable choisie : celle du modèle si la
 * liste de choix la contient (ou sans liste connue), sinon — pour un « % de oui »
 * seulement — le « Oui » de la liste. Un « % = valeur » garde TOUJOURS la valeur
 * du modèle (« 0 » = « N'a pas payé » ne devient jamais le « Oui » de la liste,
 * qui compterait l'inverse) : absente de la liste, elle est signalée (bindItem,
 * défaut « positive ») et jamais précochée.
 */
function positiveFor(item, field) {
  const choices = (field && field.choices) || [];
  const wanted = item.positiveValue == null ? null : String(item.positiveValue);
  if (!choices.length || item.agg !== 'percent_yes') return wanted;
  const values = new Set(choices.map((c) => String(c.value)));
  if (wanted && wanted.split('|').every((v) => values.has(v))) return wanted;
  const yes = choices.find((c) => /^(oui|yes)$/i.test(String(c.label || '').trim()));
  return yes ? String(yes.value) : wanted;
}

/**
 * Proposition de variable pour chaque indicateur du modèle.
 * @param {object} template  activité du catalogue
 * @param {Array<{name, label?, choices?: Array<{value,label}>}>} fields  variables de la fiche (XLSForm + colonnes des données)
 * @returns {Array<{ code, field: string|null, positiveValue, confidence: 'sure'|'probable'|'a_verifier'|null }>}
 */
function suggestBindings(template, fields) {
  const byName = new Map();
  for (const f of fields || []) if (f && f.name && !byName.has(nameKey(f.name))) byName.set(nameKey(f.name), f);
  const labelled = (fields || []).filter((f) => f && f.label).map((f) => ({ f, key: labelKey(f.label) }));
  return (template.items || []).map((item) => {
    let field = null; let confidence = null;
    (item.variables || []).some((v, i) => {
      const hit = byName.get(nameKey(v));
      if (hit) { field = hit; confidence = i === 0 ? 'sure' : 'probable'; }
      return Boolean(hit);
    });
    if (!field) {
      const k = labelKey(item.label);
      let best = null;
      for (const c of labelled) {
        const s = similarity(c.key, k);
        if (s >= LABEL_MIN && (!best || s > best.s)) best = { f: c.f, s };
      }
      if (best) { field = best.f; confidence = 'a_verifier'; }
    }
    return { code: item.code, field: field ? field.name : null, positiveValue: positiveFor(item, field), confidence };
  });
}

/**
 * Indicateur prêt à enregistrer pour un élément du modèle et la variable choisie.
 * `naValues` : codes hors base retenus pour CETTE liste (indicatorProposals.bindItem), sinon ceux du modèle.
 */
function indicatorFromItem(template, item, { sourceField, positiveValue, naValues }, sortOrder = 0) {
  return {
    code: item.code,
    label: item.label,
    module: moduleLabel(template, item.domain),
    sourceField,
    agg: item.agg,
    positiveValue: positiveValue == null || positiveValue === '' ? null : String(positiveValue),
    direction: item.direction,
    naValues: Array.isArray(naValues) ? naValues : (item.naValues || []),
    target: item.target == null ? null : Number(item.target),
    scored: item.scored !== false,
    templateCode: item.code,
    sortOrder,
  };
}

module.exports = {
  CATALOG, LABEL_MIN, nameKey, labelKey, mmrKey, templateCategories, templateForActivity, templateByKey, tenantCategoryFor,
  moduleLabel, suggestBindings, positiveFor, indicatorFromItem,
};
