/**
 * Proposition du modèle d'indicateurs d'une fiche (retours n° 66 et 85) — logique
 * PURE, sans I/O, testée (test/indicatorProposals.test.js).
 *
 * Problème réglé : une fiche avec 191 ou 1 159 soumissions n'avait aucun
 * indicateur noté, parce que rien ne choisissait son modèle ni ne le proposait.
 * Ce module est appelé par la carte du modèle (monitoring.repository.formTemplate)
 * et par la création des indicateurs (applyTemplate) — la MÊME règle pour la case
 * cochée d'office et pour « Créer les N indicateurs proposés » :
 *
 *  1. CHOISIT le modèle d'après les variables de la fiche : pour chaque modèle,
 *     la part de ses éléments dont une variable existe dans la fiche avec un type
 *     compatible (« couverture ») ; le plus couvert l'emporte. Deux modèles à
 *     moins de TIE_MARGIN sont départagés par `formHints` (mots du code et du nom
 *     de la fiche) ; sinon le choix reste à l'utilisateur (« ambigu »).
 *  2. LIE chaque élément par le nom (indicatorTemplates.suggestBindings), puis
 *     CONTRÔLE le type de la variable (une moyenne veut un nombre, un % une
 *     question à choix unique ou une option — jamais le parent d'un choix
 *     multiple, dont la valeur « 1 3 » ne vaut pas « 1 ») et la liste : chaque
 *     valeur comptée doit exister ; un code hors base absent de la liste, ou
 *     libellé « Autre », est retiré — « Autre » (999…) est une RÉPONSE : dans la
 *     base, comptée non positive (règle du retour 81).
 *  3. PRÉCOCHE seulement ce qui est sûr : variable trouvée par son nom, sans
 *     défaut, hors sous-table et hors base biaisée (avertissement `base`). Une
 *     sous-table (groupe répété, que l'import ne lit pas encore : seule la 1re
 *     feuille) est reconnue par l'avertissement `groupe` du modèle — vérifié
 *     contre les 5 formulaires réels — ou par `field.repeat` quand le catalogue
 *     de la fiche le fournira (import des sous-tables).
 *  4. SIGNALE un indicateur déjà créé dont la définition diffère du modèle
 *     actuel (templateDrift) : « à mettre à jour », jamais réécrit seul.
 */
const {
  CATALOG, nameKey, templateForActivity, templateByKey, suggestBindings,
} = require('./indicatorTemplates');

/** Couverture d'un modèle « reconnu » (60 % de ses éléments) : la carte le dit sans réserve. */
const STRONG_MIN = 0.6;
/** En dessous, aucun modèle n'est proposé : la carte invite à en choisir un. */
const SHOW_MIN = 0.3;
/** Deux modèles plus proches que ceci (5 points) sont départagés par formHints. */
const TIE_MARGIN = 0.05;

const PERCENT_AGGS = new Set(['percent_yes', 'percent_value']);
const NUMERIC_AGGS = new Set(['mean', 'sum']);
// Types XLSForm compatibles avec une méthode. Un type inconnu (colonne des seules données,
// variable SPSS « numeric » / « string ») n'est pas contrôlé : il ne bloque rien.
const PERCENT_TYPES = new Set(['select_one', 'option', 'calculate', 'integer', 'select_one_from_file', 'range']);
const NUMERIC_TYPES = new Set(['integer', 'decimal', 'calculate', 'range']);
const UNCHECKED_TYPES = new Set(['', 'numeric', 'string']);
const OTHER_LABEL = /^\s*(autres?|other)\b/i;

const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Défaut de type de la variable pour la méthode (null = compatible ou type inconnu). */
function typeIssue(agg, type) {
  const t = String(type == null ? '' : type).trim().toLowerCase();
  if (UNCHECKED_TYPES.has(t) || agg === 'count') return null;
  if (NUMERIC_AGGS.has(agg)) return NUMERIC_TYPES.has(t) ? null : 'type';
  if (PERCENT_AGGS.has(agg)) return PERCENT_TYPES.has(t) ? null : 'type';
  return null;
}

/**
 * Présence des variables par nom (« X/k » = « X.k ») : variables de la fiche et,
 * pour chaque question à choix multiples, ses options (une option existe dans
 * le formulaire même avant toute donnée importée).
 */
function presenceIndex(fields) {
  const idx = new Map();
  for (const f of fields || []) {
    if (!f || !f.name) continue;
    const k = nameKey(f.name);
    if (!idx.has(k)) idx.set(k, { type: f.type || null, virtual: false });
    if (/^select_multiple\b/i.test(String(f.type || ''))) {
      for (const c of f.choices || []) {
        const ok = nameKey(`${f.name}/${c.value}`);
        if (!idx.has(ok)) idx.set(ok, { type: 'option', virtual: true });
      }
    }
  }
  return idx;
}

/** Variable d'un élément trouvée dans la fiche (réelle ou option du formulaire), ou null. */
function presentVariable(item, idx) {
  for (const v of item.variables || []) {
    const hit = idx.get(nameKey(v));
    if (hit) return hit;
  }
  return null;
}

/** Couverture d'un modèle : éléments dont une variable existe dans la fiche avec un type compatible. */
function templateCoverage(template, idx) {
  let found = 0;
  for (const item of template.items || []) {
    const hit = presentVariable(item, idx);
    if (hit && !typeIssue(item.agg, hit.type)) found += 1;
  }
  const total = (template.items || []).length;
  return { found, total, coverage: total ? found / total : 0 };
}

/** Mots du code et du nom de la fiche (sans accents, en majuscules). */
function formTokens(form = {}) {
  return new Set(fold(`${form.code || ''} ${form.label || ''}`).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
}

/** Nombre d'indices du modèle (formHints) présents dans le code ou le nom de la fiche. */
function hintScore(template, tokens) {
  let n = 0;
  for (const h of template.formHints || []) {
    const parts = fold(h).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (parts.length && parts.every((p) => tokens.has(p))) n += 1;
  }
  return n;
}

/**
 * Modèle proposé pour une fiche d'après ses variables.
 * @param {{ fields: Array<{name,type?,choices?}>, form?: {code?, label?}, catalog?: object }} input
 * @returns {{ best: null|{key,label,mmrCategory,found,total,coverage,hints}, ranking: object[],
 *   ambiguous: boolean, strong: boolean }}
 *   strong = modèle reconnu (couverture ≥ STRONG_MIN, non ambigu).
 */
function proposeTemplate({ fields, form = {}, catalog = CATALOG } = {}) {
  const idx = presenceIndex(fields);
  const tokens = formTokens(form);
  const ranking = (catalog.activities || []).map((t) => ({
    key: t.key, label: t.label, mmrCategory: t.mmrCategory, ...templateCoverage(t, idx), hints: hintScore(t, tokens),
  })).sort((a, b) => b.coverage - a.coverage || b.hints - a.hints || a.key.localeCompare(b.key));
  const top = ranking[0];
  if (!top || top.coverage < SHOW_MIN) return { best: null, ranking, ambiguous: false, strong: false };
  // Modèles proches du premier : départagés par les indices du nom (formHints), sinon ambigus.
  const close = ranking.filter((r) => top.coverage - r.coverage <= TIE_MARGIN + 1e-9);
  let best = top;
  let ambiguous = false;
  if (close.length > 1) {
    const maxHints = Math.max(...close.map((r) => r.hints));
    const withMax = close.filter((r) => r.hints === maxHints);
    if (maxHints > 0 && withMax.length === 1) best = withMax[0];
    else ambiguous = true;
  }
  return { best, ranking, ambiguous, strong: !ambiguous && best.coverage >= STRONG_MIN };
}

/**
 * Modèle à montrer pour une fiche : celui demandé (`requested`), sinon celui de
 * son activité, sinon le modèle proposé. Un modèle demandé autre que celui de
 * l'activité rattachée est refusé : on change l'activité, pas le modèle.
 * @returns {{ template: object|null, source: 'chosen'|'activity'|'proposal'|null, error?: 'unknown_template'|'activity_template' }}
 */
function effectiveTemplate({ activityCategory, requested = null, proposal = null, catalog = CATALOG } = {}) {
  const activityTpl = templateForActivity(activityCategory, catalog);
  if (requested) {
    const t = templateByKey(requested, catalog);
    if (!t) return { template: null, source: null, error: 'unknown_template' };
    if (activityTpl && activityTpl.key !== t.key) return { template: null, source: null, error: 'activity_template' };
    return { template: t, source: activityTpl ? 'activity' : 'chosen' };
  }
  if (activityTpl) return { template: activityTpl, source: 'activity' };
  if (proposal && proposal.best) return { template: templateByKey(proposal.best.key, catalog), source: 'proposal' };
  return { template: null, source: null };
}

/**
 * Contrôles d'un élément lié à une variable de la fiche.
 * @returns {{ code, field, positiveValue, naValues, naDropped, confidence, issues: string[], subtable, pendingData, preselect }}
 *   issues : 'type' (type incompatible), 'positive' (valeur comptée absente de la liste) ;
 *   pendingData : seule une option du formulaire existe, sa colonne arrivera avec les données.
 */
function bindItem(item, suggestion, field, idx) {
  const issues = [];
  const warnings = item.warnings || [];
  let positiveValue = suggestion ? suggestion.positiveValue : (item.positiveValue == null ? null : String(item.positiveValue));
  let naValues = [...(item.naValues || [])].map(String);
  const naDropped = [];
  if (field) {
    const ti = typeIssue(item.agg, field.type);
    if (ti) issues.push(ti);
    const choices = field.choices || [];
    if (choices.length && PERCENT_AGGS.has(item.agg)) {
      const labelOf = new Map(choices.map((c) => [String(c.value), String(c.label == null ? '' : c.label)]));
      // « % = valeur » : la valeur du MODÈLE doit exister telle quelle (une échelle ne se remplace pas par le « Oui »
      // de la liste) ; « % de oui » : la valeur retenue (celle du modèle ou le « Oui » de la liste, positiveFor).
      const source = item.agg === 'percent_value' ? item.positiveValue : positiveValue;
      const wanted = String(source == null ? '' : source).split('|').filter(Boolean);
      if ((item.agg === 'percent_value' && !wanted.length) || wanted.some((v) => !labelOf.has(v))) issues.push('positive');
      naValues = naValues.filter((v) => {
        // Hors base = un code de CETTE liste qui n'est pas « Autre » (« Autre » est une réponse).
        const keep = labelOf.has(v) && !OTHER_LABEL.test(labelOf.get(v));
        if (!keep) naDropped.push(v);
        return keep;
      });
    }
  } else {
    positiveValue = item.positiveValue == null ? null : String(item.positiveValue);
  }
  const subtable = warnings.includes('groupe') || Boolean(field && field.repeat);
  const pendingData = !field && Boolean(idx && presentVariable(item, idx));
  const confidence = suggestion ? suggestion.confidence : null;
  const preselect = Boolean(field) && (confidence === 'sure' || confidence === 'probable')
    && issues.length === 0 && !subtable && !warnings.includes('base');
  return {
    code: item.code, field: field ? field.name : null, positiveValue, naValues, naDropped,
    confidence, issues, subtable, pendingData, preselect,
  };
}

/** Liaison de tous les éléments d'un modèle aux variables d'une fiche. */
function bindTemplate(template, fields) {
  const suggestions = suggestBindings(template, fields);
  const byName = new Map((fields || []).filter((f) => f && f.name).map((f) => [f.name, f]));
  const idx = presenceIndex(fields);
  return (template.items || []).map((item, i) => bindItem(item, suggestions[i], byName.get(suggestions[i].field) || null, idx));
}

/**
 * Éléments à créer d'un clic (« Créer les N indicateurs proposés ») : les
 * éléments précochés, ni déjà créés (même template_code) ni bloqués par un code
 * déjà pris. Même règle que la case cochée d'office dans la carte.
 * @param {object[]} bindings  bindTemplate
 * @param {{ done?: Set<string>, taken?: Set<string> }} existing
 */
function proposedSelection(bindings, { done = new Set(), taken = new Set() } = {}) {
  return (bindings || []).filter((b) => b.preselect && !done.has(b.code) && !taken.has(b.code))
    .map((b) => ({ code: b.code, sourceField: b.field, positiveValue: b.positiveValue }));
}

/** Comptes affichés par la carte et par les états vides. */
function bindingSummary(bindings, { done = new Set(), taken = new Set() } = {}) {
  const s = { total: 0, proposed: 0, existing: 0, taken: 0, subtable: 0, pendingData: 0, toCheck: 0, missing: 0 };
  for (const b of bindings || []) {
    s.total += 1;
    if (done.has(b.code)) { s.existing += 1; continue; }
    if (taken.has(b.code)) { s.taken += 1; continue; }
    if (b.preselect) s.proposed += 1;
    else if (b.subtable) s.subtable += 1;
    else if (b.pendingData) s.pendingData += 1;
    else if (!b.field) s.missing += 1;
    else s.toCheck += 1;
  }
  return s;
}

const valueSet = (v) => String(v == null ? '' : v).split('|').map((x) => x.trim()).filter(Boolean).sort().join('|');
const listSet = (l) => [...new Set((l || []).map(String))].sort().join('|');

/**
 * Écart entre un indicateur DÉJÀ créé depuis le modèle et la définition actuelle
 * de son élément (les modèles ont été corrigés le 14/10 : MIARO_NO_DELAY lisait
 * risk_delay, GD_WH_PALLETS l'empilage…). Rien n'est réécrit : l'écran le signale
 * et propose `patch`, envoyé par l'utilisateur via PATCH /indicators/:id (mêmes
 * contrôles qu'une modification à la main). Le libellé n'est signalé que s'il est
 * encore l'ANCIEN libellé du modèle (`formerly`) — un libellé renommé par
 * l'utilisateur ne l'est jamais. Une cible saisie par l'utilisateur non plus.
 * @param {object} item  élément du modèle
 * @param {object|null} binding  bindItem : variable proposée pour CETTE fiche
 * @param {{ label, sourceField, agg, positiveValue, naValues, target, direction }} ind  indicateur enregistré
 * @returns {null | { kind: 'definition'|'label', former: boolean, changes: Array<{ key, from, to }>, patch: object }}
 *   former : l'indicateur porte encore la définition d'avant la correction ;
 *   un changement de variable sans variable du modèle dans la fiche a `to: null` (pas dans `patch`).
 */
function templateDrift(item, binding, ind) {
  const changes = [];
  const patch = {};
  const change = (key, from, to, inPatch = true) => {
    changes.push({ key, from: from == null ? null : from, to: to == null ? null : to });
    if (inPatch) patch[key] = to == null ? null : to;
  };
  const known = new Set((item.variables || []).map(nameKey));
  if (!known.has(nameKey(ind.sourceField))) {
    const usable = binding && binding.field && !(binding.issues || []).length ? binding.field : null;
    change('sourceField', ind.sourceField, usable, Boolean(usable));
  }
  if (ind.agg !== item.agg) change('agg', ind.agg, item.agg);
  const percent = PERCENT_AGGS.has(item.agg);
  const wantedPositive = percent ? ((binding && binding.field ? binding.positiveValue : item.positiveValue) || null) : null;
  if (valueSet(ind.positiveValue) !== valueSet(wantedPositive)) change('positiveValue', ind.positiveValue || null, wantedPositive);
  const wantedNa = binding && binding.field ? binding.naValues : (item.naValues || []);
  if (listSet(ind.naValues) !== listSet(wantedNa)) change('naValues', ind.naValues || [], wantedNa);
  if (item.target != null && ind.target == null) change('target', null, Number(item.target));
  if (item.direction && ind.direction && ind.direction !== item.direction) change('direction', ind.direction, item.direction);
  const formerly = item.formerly || [];
  if (ind.label !== item.label && formerly.some((f) => f.label === ind.label)) change('label', ind.label, item.label);
  if (!changes.length) return null;
  const former = formerly.some((f) => (f.variables || []).some((v) => nameKey(v) === nameKey(ind.sourceField))
    && f.agg === ind.agg && valueSet(f.positiveValue) === valueSet(ind.positiveValue));
  // « % = valeur » sans valeur comptée serait refusé : la valeur suit toujours la méthode.
  if (patch.agg && PERCENT_AGGS.has(patch.agg) && !('positiveValue' in patch) && !ind.positiveValue) patch.positiveValue = item.positiveValue || null;
  return { kind: changes.some((c) => c.key !== 'label') ? 'definition' : 'label', former, changes, patch };
}

module.exports = {
  STRONG_MIN, SHOW_MIN, TIE_MARGIN,
  typeIssue, presenceIndex, templateCoverage, formTokens, hintScore,
  proposeTemplate, effectiveTemplate, bindItem, bindTemplate, proposedSelection, bindingSummary, templateDrift,
};
