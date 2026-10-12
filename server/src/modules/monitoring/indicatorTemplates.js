/**
 * Modèles d'indicateurs par activité (retour n° 12) — logique PURE, testée.
 *
 * Le catalogue (indicatorTemplates.json) reprend les modèles de tableau de bord
 * et de rapport du suivi de processus : pour chaque activité du MMR, ses
 * domaines (D1… du rapport ; modules du seul tableau de bord en complément) et
 * ses indicateurs (méthode, sens, valeur positive, réponses hors base,
 * variables des formulaires réels qui les mesurent).
 *
 * Une fiche rattachée à une activité reçoit le modèle ; il ne reste qu'à
 * vérifier, pour chaque indicateur, la variable du XLSForm proposée ici :
 *   1. variable du modèle trouvée telle quelle dans la fiche  → « sure »
 *   2. autre variable connue pour cet indicateur              → « probable »
 *   3. question de libellé très proche                         → « a_verifier »
 *   4. rien                                                    → pas de proposition
 * Rien n'est créé sans l'accord de l'utilisateur.
 */
const CATALOG = require('./indicatorTemplates.json');
const { normPlace, similarity } = require('../common/placeMatch');

const LABEL_MIN = 0.86;
const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();
// Colonnes éclatées des questions à choix multiples : « Q/4 » (Excel) = « Q.4 » (SPSS).
const nameKey = (s) => lower(s).replace(/[./]/g, '/');
const labelKey = (s) => normPlace(String(s || '').replace(/[?:«»"]/g, ' ')).key;

/** Modèle de l'activité (catégorie du MMR), ou null. */
function templateForActivity(activityCategory, catalog = CATALOG) {
  const a = lower(activityCategory);
  if (!a) return null;
  return catalog.activities.find((t) => lower(t.mmrCategory) === a) || null;
}

/** Libellé de domaine stocké dans `module` : « D1 · Conformité gestion distribution ». */
function moduleLabel(template, code) {
  const d = (template.domains || []).find((x) => x.code === code);
  return d ? `${d.code} · ${d.label}` : code;
}

/**
 * Valeur positive à retenir pour la variable choisie : celle du modèle si la
 * liste de choix la contient (ou sans liste connue), sinon le « Oui » de la liste.
 */
function positiveFor(item, field) {
  const choices = (field && field.choices) || [];
  const wanted = item.positiveValue == null ? null : String(item.positiveValue);
  if (!choices.length || item.agg === 'mean' || item.agg === 'count' || item.agg === 'sum') return wanted;
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

/** Indicateur prêt à enregistrer pour un élément du modèle et la variable choisie. */
function indicatorFromItem(template, item, { sourceField, positiveValue }, sortOrder = 0) {
  return {
    code: item.code,
    label: item.label,
    module: moduleLabel(template, item.domain),
    sourceField,
    agg: item.agg,
    positiveValue: positiveValue == null || positiveValue === '' ? null : String(positiveValue),
    direction: item.direction,
    naValues: item.naValues || [],
    scored: item.scored !== false,
    templateCode: item.code,
    sortOrder,
  };
}

module.exports = { CATALOG, templateForActivity, moduleLabel, suggestBindings, positiveFor, indicatorFromItem };
