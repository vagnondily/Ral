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
 *     actuel (templateDrift) : « à mettre à jour » quand il garde une valeur
 *     d'avant une correction du modèle, « différent » sinon (modification de
 *     l'utilisateur) ; jamais réécrit seul.
 */
const {
  CATALOG, nameKey, templateForActivity, templateByKey, suggestBindings, positiveFor,
} = require('./indicatorTemplates');
const { definitionIssue } = require('./indicatorRules');

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
/** Liaison sûre : variable trouvée par son NOM parmi celles du modèle (jamais un libellé ressemblant), sans défaut. */
const SURE_CONFIDENCE = new Set(['sure', 'probable']);
// Clés dont la valeur dépend de la liste de la variable : comparées seulement avec une liaison vérifiée.
const VALUE_KEYS = new Set(['positiveValue', 'naValues']);

/**
 * Liaison de l'élément sur la variable `name` : celle de bindTemplate si elle porte sur cette variable,
 * sinon recalculée (bindItem) sur la variable de la fiche du même nom ; null si la fiche ne l'a pas.
 */
function bindingForVariable(item, binding, name, fields) {
  if (!name) return null;
  if (binding && binding.field && nameKey(binding.field) === nameKey(name)) return binding;
  const field = (fields || []).find((f) => f && f.name && nameKey(f.name) === nameKey(name));
  if (!field) return null;
  return bindItem(item, { positiveValue: positiveFor(item, field), confidence: 'sure' }, field, null);
}

/**
 * Écart entre un indicateur DÉJÀ créé depuis le modèle et la définition actuelle
 * de son élément (les modèles ont été corrigés le 14/10 : MIARO_NO_DELAY lisait
 * risk_delay, GD_WH_PALLETS l'empilage…). Rien n'est réécrit : l'écran le signale
 * et propose `patch`, envoyé par l'utilisateur via PATCH /indicators/:id (mêmes
 * contrôles qu'une modification à la main).
 *
 * Chaque écart porte son origine :
 *  - « correction » : l'indicateur a encore la valeur d'AVANT la correction du
 *    modèle (`formerly`) — « à mettre à jour », compté, envoyé par « Tout mettre à jour » ;
 *  - « difference » : autre valeur que le modèle, qui n'est pas une ancienne valeur
 *    du modèle — le plus souvent une modification de l'utilisateur (sens, réponses
 *    hors base, cible effacée…) : affichée pour information, jamais comptée ni
 *    envoyée en lot, seulement par l'action de SA ligne (`fullPatch`).
 * Jamais signalés : une variable choisie par l'utilisateur (ni du modèle ni d'avant
 * la correction), un libellé renommé (seul un ANCIEN libellé du modèle l'est), une
 * cible saisie. Une correction exige que l'indicateur soit encore sur une variable de
 * la définition d'avant (sinon ses valeurs sont celles de l'utilisateur : différences).
 * Cible vide : correction seulement si l'indicateur a été créé par l'ancien chemin
 * (il garde une valeur propre à la définition d'avant) — sinon effacée par l'utilisateur.
 *
 * Variable : seule une variable d'avant la correction est remplacée, et seulement
 * par une variable du modèle trouvée par son NOM, sans défaut (jamais un libellé
 * ressemblant « à vérifier », jamais un type ou une liste incompatible) ; sinon la
 * mise à jour est BLOQUÉE (`blocked`) : rien d'un clic, la raison est dite.
 * Valeur comptée et réponses hors base : comparées avec la liaison VÉRIFIÉE de la
 * variable retenue (sa liste) ; sans elle, une correction de méthode ou de valeur
 * est bloquée (« incompatible » / « missing ») et une simple différence n'est pas
 * signalée (invérifiable).
 * @param {object} item  élément du modèle
 * @param {object|null} binding  bindItem : variable proposée pour CETTE fiche
 * @param {{ label, sourceField, agg, positiveValue, naValues, target, direction }} ind  indicateur enregistré
 * @param {{ fields?: object[] }} [opts]  variables de la fiche (liaison de la variable de l'indicateur)
 * @returns {null | {
 *   kind: 'definition'|'label'|'difference', former: boolean,
 *   changes: Array<{ key, from, to, origin: 'correction'|'difference' }>,
 *   patch: object, fullPatch: object,
 *   blocked: null | { reason: 'missing'|'incompatible'|'unverified', field: string|null, issues: string[], pendingData: boolean } }}
 *   patch = les corrections (vide si bloqué) ; fullPatch = corrections + différences (vide si bloqué).
 */
function templateDrift(item, binding, ind, { fields = null } = {}) {
  const changes = [];
  const add = (key, from, to, origin) => changes.push({ key, from: from == null ? null : from, to: to == null ? null : to, origin });
  const formerly = item.formerly || [];
  const known = new Set((item.variables || []).map(nameKey));
  const formerVars = new Set(formerly.flatMap((f) => (f.variables || []).map(nameKey)));
  const issuesOf = (b) => (b && b.issues) || [];
  let blocked = null;

  // 1. Variable retenue pour l'indicateur.
  let target = ind.sourceField;
  if (!known.has(nameKey(ind.sourceField)) && formerVars.has(nameKey(ind.sourceField))) {
    const field = binding && binding.field;
    const sure = field && known.has(nameKey(field)) && SURE_CONFIDENCE.has(binding.confidence) && !issuesOf(binding).length;
    if (sure) {
      add('sourceField', ind.sourceField, field, 'correction');
      target = field;
    } else {
      add('sourceField', ind.sourceField, null, 'correction');
      target = null;
      if (field && known.has(nameKey(field))) blocked = { reason: 'incompatible', field, issues: issuesOf(binding), pendingData: false };
      else if (field) blocked = { reason: 'unverified', field, issues: [], pendingData: false };
      else blocked = { reason: 'missing', field: (item.variables || [])[0] || null, issues: [], pendingData: Boolean(binding && binding.pendingData) };
    }
  }
  // Variable choisie par l'utilisateur (ni du modèle ni d'avant la correction) : son choix, jamais signalé.

  // 2. Liaison vérifiée de la variable retenue (sa liste) : valeurs comparées seulement avec elle.
  const vb = target ? bindingForVariable(item, binding, target, fields) : null;
  const verified = Boolean(vb) && !issuesOf(vb).length;
  const percent = PERCENT_AGGS.has(item.agg);
  // Une valeur n'est une « correction » que si :
  //  - l'indicateur est sur une variable du MODÈLE — actuelle ou d'une définition d'avant — et non sur
  //    une variable choisie par l'utilisateur (R3 : ses valeurs sont alors SON choix ; T4 : la variable
  //    actuelle compte, l'ancien chemin a pu créer l'indicateur dessus) ;
  //  - ET une AUTRE preuve que l'indicateur précède la correction existe (T1) : l'ancien libellé, une
  //    variable propre à la définition d'avant, ou une autre valeur d'avant de la MÊME définition. Une
  //    seule clé revenue à une valeur d'avant, sur un indicateur créé par le chemin actuel, est une
  //    modification de l'utilisateur (ex. « 2 » retiré des hors base, « Nombre » choisi) : différence.
  //  Le libellé fait preuve à lui seul : le chemin actuel écrit le libellé actuel, jamais l'ancien.
  const sameVar = (f) => known.has(nameKey(ind.sourceField)) || (f.variables || []).some((v) => nameKey(v) === nameKey(ind.sourceField));
  const was = {
    agg: (f) => f.agg === ind.agg && f.agg !== item.agg,
    positiveValue: (f) => valueSet(f.positiveValue) === valueSet(ind.positiveValue) && valueSet(f.positiveValue) !== valueSet(item.positiveValue),
    naValues: (f) => listSet(f.naValues) === listSet(ind.naValues || []) && listSet(f.naValues) !== listSet(item.naValues),
    direction: (f) => Boolean(f.direction) && f.direction === ind.direction && f.direction !== item.direction,
    label: (f) => f.label === ind.label && f.label !== item.label,
    sourceField: (f) => !known.has(nameKey(ind.sourceField)) && (f.variables || []).some((v) => nameKey(v) === nameKey(ind.sourceField)),
  };
  const SELF_EVIDENT = new Set(['label', 'sourceField']);
  /** Preuves que l'indicateur vient de la définition d'avant `f`, en laissant de côté la clé `except`. */
  const evidence = (f, except = null) => Object.keys(was).some((k) => k !== except && was[k](f));
  const origin = (key) => (formerly.some((f) => sameVar(f) && was[key](f) && (SELF_EVIDENT.has(key) || evidence(f, key)))
    ? 'correction' : 'difference');
  // Créé par l'ANCIEN chemin du modèle (qui n'écrivait aucune cible) : l'indicateur garde, sur une variable
  // du modèle, une valeur propre à une définition d'avant (variable, méthode, valeur, hors base, sens ou
  // libellé). Une cible vide est alors une correction ; sinon (créé par le chemin actuel, qui écrit la
  // cible) elle a été effacée par l'utilisateur — une différence, jamais réécrite en lot (R4).
  const createdBefore = formerly.some((f) => f.target == null && sameVar(f) && evidence(f));

  if (ind.agg !== item.agg) add('agg', ind.agg, item.agg, origin('agg'));
  const wantedPositive = percent ? ((verified ? vb.positiveValue : item.positiveValue) || null) : null;
  if (valueSet(ind.positiveValue) !== valueSet(wantedPositive)) add('positiveValue', ind.positiveValue || null, wantedPositive, origin('positiveValue'));
  const wantedNa = verified ? vb.naValues : (item.naValues || []);
  if (listSet(ind.naValues) !== listSet(wantedNa)) add('naValues', ind.naValues || [], wantedNa, origin('naValues'));
  if (item.target != null && ind.target == null) add('target', null, Number(item.target), createdBefore ? 'correction' : 'difference');
  if (item.direction && ind.direction && ind.direction !== item.direction) add('direction', ind.direction, item.direction, origin('direction'));
  // Libellé : seul un ANCIEN libellé du modèle est signalé (un libellé renommé par l'utilisateur ne l'est jamais).
  if (ind.label !== item.label && formerly.some((f) => f.label === ind.label)) add('label', ind.label, item.label, origin('label'));

  if (!verified) {
    // Sans liaison vérifiée : une différence de valeur est invérifiable (non signalée) ; une correction de
    // méthode ou de valeur ne s'applique pas d'un clic (la liste de la variable ne la porte pas).
    const needsList = changes.some((c) => c.origin === 'correction' && (VALUE_KEYS.has(c.key) || (c.key === 'agg' && percent)));
    for (let i = changes.length - 1; i >= 0; i -= 1) if (VALUE_KEYS.has(changes[i].key) && changes[i].origin === 'difference') changes.splice(i, 1);
    if (needsList && !blocked) {
      blocked = vb ? { reason: 'incompatible', field: target, issues: issuesOf(vb), pendingData: false }
        : { reason: 'missing', field: target, issues: [], pendingData: false };
    }
  }
  if (!changes.length) return null;

  const corrections = changes.filter((c) => c.origin === 'correction');
  const toPatch = (list) => {
    const out = {};
    for (const c of list) if (!(c.key === 'sourceField' && c.to == null)) out[c.key] = c.to == null ? null : c.to;
    // « % = valeur » sans valeur comptée serait refusé : la valeur suit toujours la méthode (liaison vérifiée).
    if (out.agg && PERCENT_AGGS.has(out.agg) && !('positiveValue' in out) && !ind.positiveValue && verified) out.positiveValue = vb.positiveValue || null;
    return out;
  };
  const kind = corrections.some((c) => c.key !== 'label') ? 'definition' : corrections.length ? 'label' : 'difference';
  return {
    kind, former: corrections.length > 0, changes, blocked,
    patch: blocked ? {} : toPatch(corrections),
    fullPatch: blocked ? {} : toPatch(changes),
  };
}

const normPatchValue = (key, v) => {
  if (v == null || v === '') return null;
  if (key === 'naValues') return listSet(v);
  if (key === 'positiveValue') return valueSet(v);
  if (key === 'target') return Number(v);
  return String(v);
};
/**
 * Deux modifications identiques (mêmes clés, mêmes valeurs ; listes et valeurs « 1|2 » sans ordre) :
 * la mise à jour depuis le modèle n'écrit que ce que la carte a montré (R6).
 */
function samePatch(a, b) {
  const ka = Object.keys(a || {}).sort();
  const kb = Object.keys(b || {}).sort();
  if (ka.join('|') !== kb.join('|')) return false;
  return ka.every((k) => normPatchValue(k, a[k]) === normPatchValue(k, b[k]));
}

/**
 * Refus d'un élément envoyé à la création (applyTemplate, éléments cochés ou proposés) — même
 * contrôle que la carte et que l'éditeur, un élément nommé, rien d'écrit :
 *  - type de la variable incompatible avec la méthode (type_mismatch) ;
 *  - valeur comptée absente de la liste de la variable (positive_not_in_list) : l'indicateur
 *    calculerait toujours 0 % ;
 *  Un « % de oui » sans valeur comptée reste accepté, comme dans l'éditeur (indicatorRules) : le
 *  calcul compte alors les « oui » usuels (monitoringMath.isYes : 1, oui, yes…).
 *  - définition incohérente (indicatorRules.definitionIssue : « % = valeur » sans valeur,
 *    valeur comptée aussi hors base).
 * @param {object} item  élément du modèle
 * @param {{name, type?, choices?}|null} field  variable choisie
 * @param {{ positiveValue, naValues, target }} def  ce qui serait enregistré
 * @returns {null|{ code: string, message: string, details: object }}
 */
function templateRowIssue(item, field, def) {
  const name = field ? field.name : null;
  const type = field ? field.type : null;
  const head = `« ${item.label} » (${item.code})`;
  if (field && typeIssue(item.agg, type)) {
    return {
      code: 'type_mismatch',
      message: `${head} : la variable « ${name} » (${type}) ne convient pas à la méthode de cet indicateur. Choisissez une autre variable.`,
      details: { code: 'type_mismatch', item: item.code, field: name, type, agg: item.agg },
    };
  }
  const positive = def.positiveValue == null ? '' : String(def.positiveValue).trim();
  const choices = (field && field.choices) || [];
  if (PERCENT_AGGS.has(item.agg) && positive && choices.length) {
    const values = new Set(choices.map((c) => String(c.value)));
    const missing = positive.split('|').map((v) => v.trim()).find((v) => v && !values.has(v));
    if (missing) {
      return {
        code: 'positive_not_in_list',
        message: `${head} : la valeur comptée « ${missing} » n'est pas dans la liste de la variable « ${name} ». Choisissez une valeur de sa liste.`,
        details: { code: 'positive_not_in_list', item: item.code, field: name, value: missing },
      };
    }
  }
  const issue = definitionIssue({ agg: item.agg, positiveValue: def.positiveValue, naValues: def.naValues, target: def.target });
  if (issue) {
    return {
      code: issue.code,
      message: `${head} : ${issue.message}`,
      details: { code: issue.code, item: item.code, field: name, attribute: issue.field, ...(issue.value != null ? { value: issue.value } : {}) },
    };
  }
  return null;
}

module.exports = {
  STRONG_MIN, SHOW_MIN, TIE_MARGIN,
  typeIssue, presenceIndex, templateCoverage, formTokens, hintScore,
  proposeTemplate, effectiveTemplate, bindItem, bindTemplate, proposedSelection, bindingSummary, templateDrift, bindingForVariable, templateRowIssue, samePatch,
};
