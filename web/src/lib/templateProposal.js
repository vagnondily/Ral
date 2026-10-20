/**
 * Carte du modèle d'indicateurs d'une fiche (retours 66 et 85) — fonctions PURES
 * de l'interface, sans DOM ni API, testées depuis server/test/templateProposalView.test.js.
 *
 * La RÈGLE (quel modèle, quelle variable, ce qui est coché d'office, ce qui a
 * changé depuis la création) est au serveur : server/src/modules/monitoring/
 * indicatorProposals.js. Ici seulement :
 *  - les mots affichés pour chaque code renvoyé (jamais un code nu à l'écran :
 *    un code inconnu prend un libellé générique) ;
 *  - l'état des cases, avec UNE fonction (rowSelectable) pour la case, le compte
 *    du bouton et l'envoi : on envoie exactement ce que la carte montre coché.
 * Phrases françaises traduites par tr() à l'affichage.
 */
import { formatInt } from './format.js';
import { indicatorErrorText } from './indicatorView.js';

/** Méthodes de calcul (mêmes mots que l'éditeur d'indicateur). */
export const AGG_LABEL = { percent_yes: '% de « oui »', percent_value: '% = valeur', mean: 'Moyenne', sum: 'Somme', count: 'Nombre' };

/** Qualité de la variable proposée (indicatorTemplates.suggestBindings) : couleur + icône + libellé. */
export const CONFIDENCE = {
  sure: { label: 'Trouvée', tone: 'green', icon: 'check' },
  probable: { label: 'Probable', tone: 'blue', icon: 'link' },
  a_verifier: { label: 'À vérifier', tone: 'orange', icon: 'warn' },
};
export const NO_CONFIDENCE = { label: 'Sans variable', tone: null, icon: 'none' };

/**
 * Avertissements des éléments du modèle (indicatorTemplates.json `warnings`).
 *  - sens : le sens « plus haut = mieux » n'est pas évident pour cette question ;
 *  - groupe : question d'un groupe répété, que l'import ne lit pas encore ;
 *  - base : % calculé sur toutes les visites (question obligatoire) ;
 *  - ratio : moyenne d'une part, affichée × 100.
 */
export const WARNING_LABEL = {
  sens: 'Sens à confirmer : un taux plus élevé n\'est pas forcément meilleur',
  groupe: 'Question d\'un sous-tableau : pas encore importée',
  base: 'Base : toutes les visites (question obligatoire)',
  ratio: 'Moyenne × 100',
};
const WARNING_FALLBACK = 'Avertissement du modèle : à vérifier';

/** Défauts de la variable proposée (indicatorProposals.bindItem `issues`). */
export const ISSUE_LABEL = {
  type: 'Type de la variable incompatible avec la méthode',
  positive: 'Valeur comptée absente de la liste de choix',
};
const ISSUE_FALLBACK = 'Variable à vérifier';

export const warningLabel = (code) => WARNING_LABEL[code] || WARNING_FALLBACK;
export const issueLabel = (code) => ISSUE_LABEL[code] || ISSUE_FALLBACK;

/** Types XLSForm en mots (message d'une variable refusée). Un type inconnu reste tel que le formulaire le nomme. */
export const TYPE_LABEL = {
  select_one: 'choix unique',
  select_multiple: 'choix multiples',
  option: 'option d\'un choix multiple',
  integer: 'nombre entier',
  decimal: 'nombre décimal',
  calculate: 'calcul',
  range: 'échelle',
  text: 'texte',
  date: 'date',
  datetime: 'date et heure',
  geopoint: 'point GPS',
  note: 'note',
};
/** Type d'une variable en mots, traduit ; un type que l'interface ne connaît pas reste tel que le formulaire le nomme. */
export function typeText(type, tr) {
  const t = String(type == null ? '' : type).trim();
  const base = t.toLowerCase().split(/\s+/)[0];
  if (TYPE_LABEL[base]) return tr(TYPE_LABEL[base]);
  return t || tr('type inconnu');
}

/** Ce qui diffère entre un indicateur créé et le modèle actuel (indicatorProposals.templateDrift). */
export const DRIFT_KEY_LABEL = {
  sourceField: 'variable',
  agg: 'méthode',
  positiveValue: 'valeur comptée',
  naValues: 'réponses hors base',
  target: 'cible',
  direction: 'sens',
  label: 'libellé',
};
export const driftKeyLabel = (key) => DRIFT_KEY_LABEL[key] || 'définition';

/** Valeur lisible d'un élément de l'écart (méthode, sens, liste de codes, vide). */
export function driftValue(key, value, tr) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (key === 'agg') return AGG_LABEL[value] ? tr(AGG_LABEL[value]) : String(value);
  if (key === 'direction') return tr(value === 'lower_better' ? 'plus bas = mieux' : 'plus haut = mieux');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Liaison sûre : variable du modèle trouvée par son NOM (jamais un libellé ressemblant « à vérifier »). */
const SURE_CONFIDENCE = new Set(['sure', 'probable']);

/**
 * État d'un indicateur déjà créé qui diffère du modèle (serveur indicatorProposals.templateDrift).
 *  - corrections : il garde une valeur d'AVANT une correction du modèle — « à mettre à jour »,
 *    compté, envoyé par « Mettre à jour » et « Tout mettre à jour » (`patch`) ;
 *  - differences : autre valeur que le modèle, le plus souvent une modification faite dans la
 *    fiche — pour information, jamais comptée ni envoyée en lot ; seulement l'action de SA ligne
 *    (« Appliquer le modèle », `fullPatch`) ;
 *  - blocked : rien d'un clic, la raison est dite (variable du modèle absente, incompatible, ou
 *    seulement ressemblante). Par prudence, une variable proposée qui n'a pas été trouvée par son
 *    nom (« à vérifier ») bloque aussi, même si le serveur l'envoyait.
 * @returns {null|{ kind, former, corrections, differences, changes, blocked, updatable, applicable, patch, fullPatch }}
 */
export function driftState(item) {
  const drift = item && item.existing && item.existing.drift;
  if (!drift) return null;
  const changes = (drift.changes || []).map((c) => ({ ...c, origin: c.origin === 'difference' ? 'difference' : 'correction' }));
  const corrections = changes.filter((c) => c.origin === 'correction');
  const differences = changes.filter((c) => c.origin === 'difference');
  const patch = drift.patch || {};
  const fullPatch = drift.fullPatch || patch;
  let blocked = drift.blocked || null;
  const confidence = item.suggestion ? item.suggestion.confidence : null;
  if (!blocked && ('sourceField' in patch || 'sourceField' in fullPatch) && !SURE_CONFIDENCE.has(confidence)) {
    blocked = { reason: 'unverified', field: patch.sourceField || fullPatch.sourceField || null, issues: [], pendingData: false };
  }
  if (!blocked && changes.some((c) => c.key === 'sourceField' && c.to == null)) {
    blocked = { reason: 'missing', field: (item.variables || [])[0] || null, issues: [], pendingData: Boolean(item.suggestion && item.suggestion.pendingData) };
  }
  const kind = drift.kind || (corrections.some((c) => c.key !== 'label') ? 'definition' : corrections.length ? 'label' : 'difference');
  return {
    kind, former: corrections.length > 0, corrections, differences, changes, blocked,
    updatable: !blocked && corrections.length > 0 && Object.keys(patch).length > 0,
    applicable: !blocked && differences.length > 0 && Object.keys(fullPatch).length > 0,
    patch: blocked ? {} : patch,
    fullPatch: blocked ? {} : fullPatch,
  };
}

/** Pourquoi une mise à jour n'est pas proposée d'un clic (C21 : absente ≠ incompatible ≠ seulement ressemblante). */
export function blockedText(blocked, tr) {
  if (!blocked) return null;
  const v = blocked.field || '—';
  if (blocked.reason === 'incompatible') {
    const why = (blocked.issues || []).map((x) => tr(issueLabel(x))).join(' ; ') || tr(ISSUE_FALLBACK);
    return tr('La variable du modèle « {v} » est dans cette fiche mais ne convient pas ({why}) : l\'import des données n\'y changera rien. Modifiez l\'indicateur à la main (liste des indicateurs).', { v, why });
  }
  if (blocked.reason === 'unverified') {
    return tr('« {v} » ressemble à la question du modèle mais n\'a pas été trouvée par son nom : rien n\'est changé d\'un clic. Choisissez la variable à la main (liste des indicateurs).', { v });
  }
  if (blocked.pendingData) {
    return tr('La variable du modèle « {v} » n\'est pas encore dans les données de cette fiche : la mise à jour sera proposée après leur import. D\'ici là, modifiez l\'indicateur à la main si besoin (liste des indicateurs).', { v });
  }
  return tr('La variable du modèle « {v} » n\'existe pas dans cette fiche : modifiez l\'indicateur à la main (liste des indicateurs).', { v });
}

/** Cible d'un changement de variable bloqué, en mots (jamais « pas encore » pour une variable présente mais incompatible). */
export function blockedTargetText(blocked, tr) {
  const v = (blocked && blocked.field) || '—';
  if (!blocked) return v;
  if (blocked.reason === 'incompatible') return tr('{v} (incompatible)', { v });
  if (blocked.reason === 'unverified') return tr('{v} (à vérifier)', { v });
  return blocked.pendingData ? tr('{v} (pas encore dans les données)', { v }) : tr('{v} (absente de cette fiche)', { v });
}

/** Part des éléments d'un modèle trouvés dans la fiche, en pourcentage entier (0–100). */
export function coveragePct(ratio) {
  return formatInt(Math.round((Number(ratio) || 0) * 100));
}

// ---- Variable choisie : type et liste contrôlés pour la variable ACTUELLE de la ligne (C19) ----------
// Jumeaux du serveur (indicatorProposals.typeIssue / bindItem) — verrouillés par
// server/test/templateProposalView.test.js sur les 5 formulaires réels : jamais deux règles.
const PERCENT_AGGS = new Set(['percent_yes', 'percent_value']);
const NUMERIC_AGGS = new Set(['mean', 'sum']);
const PERCENT_TYPES = new Set(['select_one', 'option', 'calculate', 'integer', 'select_one_from_file', 'range']);
const NUMERIC_TYPES = new Set(['integer', 'decimal', 'calculate', 'range']);
const UNCHECKED_TYPES = new Set(['', 'numeric', 'string']);
const splitValues = (v) => String(v == null ? '' : v).split('|').map((x) => x.trim()).filter(Boolean);

/** Défaut de type de la variable pour la méthode (même règle que le serveur), sinon null. */
export function typeIssue(agg, type) {
  const t = String(type == null ? '' : type).trim().toLowerCase();
  if (UNCHECKED_TYPES.has(t) || agg === 'count') return null;
  if (NUMERIC_AGGS.has(agg)) return NUMERIC_TYPES.has(t) ? null : 'type';
  if (PERCENT_AGGS.has(agg)) return PERCENT_TYPES.has(t) ? null : 'type';
  return null;
}

/**
 * Défauts de la ligne pour SA variable et SA valeur comptée actuelles : 'type' (type incompatible),
 * 'positive' (valeur comptée absente de la liste, ou « % = valeur » sans valeur alors que la liste est connue).
 */
export function fieldIssues(item, field, positive) {
  if (!item || !field) return [];
  const out = [];
  if (typeIssue(item.agg, field.type)) out.push('type');
  const choices = field.choices || [];
  if (choices.length && PERCENT_AGGS.has(item.agg)) {
    const values = new Set(choices.map((c) => String(c.value)));
    const wanted = splitValues(positive);
    if ((item.agg === 'percent_value' && !wanted.length) || wanted.some((v) => !values.has(v))) out.push('positive');
  }
  return out;
}

/**
 * Valeur comptée quand la variable de la ligne change : la valeur actuelle si la nouvelle liste la
 * contient, sinon celle du modèle si elle y est, sinon (« % de oui » seulement) le « Oui » de la
 * liste, sinon rien (à choisir) — jamais la valeur de l'ANCIENNE variable envoyée en silence.
 * Sans liste connue (variable inconnue, colonne des seules données) : la valeur actuelle reste.
 */
export function positiveForField(item, field, current) {
  const cur = String(current ?? '').trim();
  if (!item || !PERCENT_AGGS.has(item.agg)) return cur;
  const choices = (field && field.choices) || [];
  if (!choices.length) return cur;
  const values = new Set(choices.map((c) => String(c.value)));
  const fits = (v) => splitValues(v).length > 0 && splitValues(v).every((x) => values.has(x));
  if (fits(cur)) return cur;
  const wanted = item.positiveValue == null ? '' : String(item.positiveValue);
  if (fits(wanted)) return wanted;
  if (item.agg === 'percent_yes') {
    const yes = choices.find((c) => /^(oui|yes)$/i.test(String(c.label || '').trim()));
    if (yes) return String(yes.value);
  }
  return '';
}

// ---- Cases, catégories, filtres ---------------------------------------------------------------------

/** Cases de départ : SEULEMENT la précoche du serveur (jamais une sous-table, jamais un type incompatible). */
export function initialRows(items) {
  const rows = {};
  for (const it of items || []) {
    const s = it.suggestion || {};
    rows[it.code] = {
      on: Boolean(s.preselect) && !it.existing && !it.taken,
      field: (it.existing && it.existing.sourceField) || s.field || '',
      positive: (it.existing ? it.existing.positiveValue : s.positiveValue) ?? '',
    };
  }
  return rows;
}

/**
 * Rechargement de la carte qui ne suit PAS « Créer » (indicateur modifié ailleurs, mise à jour
 * d'un indicateur, C18) : les cases et variables saisies sont gardées pour les éléments encore à
 * créer ; seuls les nouveaux éléments, et ceux devenus créés ou à code pris, repartent de la précoche.
 */
export function mergeRows(prev, items) {
  const init = initialRows(items);
  if (!prev) return init;
  const rows = {};
  for (const it of items || []) {
    const p = prev[it.code];
    rows[it.code] = p && !it.existing && !it.taken ? p : init[it.code];
  }
  return rows;
}

/**
 * Catégorie d'un élément pour les badges et les filtres — UNE catégorie par élément, les badges se
 * somment donc au total (C22) : sous-tableau, sinon qualité de la variable trouvée, sinon option
 * attendue avec les données, sinon sans variable.
 * @returns {'subtable'|'sure'|'probable'|'a_verifier'|'pending'|'none'}
 */
export function rowCategory(item) {
  const s = (item && item.suggestion) || {};
  if (s.subtable) return 'subtable';
  if (s.confidence && CONFIDENCE[s.confidence]) return s.confidence;
  if (s.pendingData) return 'pending';
  return 'none';
}

/** Comptes de la carte : catégories (somme = total), créés, et écarts au modèle par origine. */
export function cardCounts(items) {
  const c = { total: 0, sure: 0, probable: 0, a_verifier: 0, subtable: 0, pending: 0, none: 0, existing: 0, taken: 0, corrections: 0, differences: 0, updatable: 0 };
  for (const it of items || []) {
    c.total += 1;
    c[rowCategory(it)] += 1;
    if (it.existing) c.existing += 1;
    if (it.taken) c.taken += 1;
    const ds = driftState(it);
    if (ds && ds.corrections.length) c.corrections += 1;
    else if (ds) c.differences += 1;
    if (ds && ds.updatable) c.updatable += 1;
  }
  return c;
}

/** Filtres de la carte : « Tous » et « À vérifier » toujours ; les autres seulement quand ils ont des lignes. */
export function availableFilters(counts) {
  const out = ['all', 'check', 'missing'];
  if (counts.pending > 0) out.push('pending');
  if (counts.corrections > 0) out.push('update');
  if (counts.differences > 0) out.push('diff');
  return out;
}
/** Filtre actif devenu sans objet (ex. plus rien « à mettre à jour », C24) : retour à « Tous ». */
export const effectiveFilter = (filter, available) => (available.includes(filter) ? filter : 'all');

/**
 * Lignes d'un filtre, décidées sur l'état CHARGÉ (données du serveur, refus affichés) — jamais sur
 * la saisie en cours : une ligne ne disparaît pas pendant qu'on y tape sa variable (C17).
 * @returns {Set<string>} codes des éléments du filtre
 */
export function filterMembers(items, filter, { rowErrors = {}, driftErrors = {} } = {}) {
  const out = new Set();
  for (const it of items || []) {
    const s = it.suggestion || {};
    const cat = rowCategory(it);
    const ds = driftState(it);
    let ok = true;
    if (filter === 'check') {
      ok = cat === 'a_verifier' || (!it.existing && (s.issues || []).length > 0)
        || (it.warnings || []).some((w) => w === 'sens' || w === 'base') || Boolean(rowErrors[it.code]) || Boolean(driftErrors[it.code]);
    } else if (filter === 'missing') ok = cat === 'none';
    else if (filter === 'pending') ok = cat === 'pending';
    else if (filter === 'update') ok = Boolean(ds && ds.corrections.length);
    else if (filter === 'diff') ok = Boolean(ds && !ds.corrections.length);
    if (ok) out.add(it.code);
  }
  return out;
}

/**
 * Une ligne peut-elle être cochée ? La même réponse pour la case, le compte du bouton
 * « Créer N indicateur(s) » et l'envoi — contrôlée sur la variable ACTUELLE de la ligne.
 * @param {Map<string, {name,type?,choices?}>} fieldsByName  variables de la fiche
 * @returns {{ ok: boolean, reason: null|'locked'|'no_field'|'unknown_field'|'type'|'positive_required'|'positive_not_in_list' }}
 */
export function rowSelectable(item, row, fieldsByName) {
  if (!item || item.existing || item.taken) return { ok: false, reason: 'locked' };
  const name = row && row.field ? String(row.field) : '';
  if (!name) return { ok: false, reason: 'no_field' };
  const field = fieldsByName.get(name);
  if (!field) return { ok: false, reason: 'unknown_field' };
  if (typeIssue(item.agg, field.type)) return { ok: false, reason: 'type' };
  const positive = String(row.positive ?? '').trim();
  // « % = valeur » sans valeur comptée serait refusé (indicatorRules) ; un « % de oui » sur une variable à
  // liste sans valeur comptée ne compterait rien (serveur : positive_missing) — à choisir d'abord.
  if (!positive && (item.agg === 'percent_value' || (item.agg === 'percent_yes' && (field.choices || []).length))) {
    return { ok: false, reason: 'positive_required' };
  }
  if (fieldIssues(item, field, positive).includes('positive')) return { ok: false, reason: 'positive_not_in_list' };
  return { ok: true, reason: null };
}

export const isChecked = (item, row, fieldsByName) => Boolean(row && row.on) && rowSelectable(item, row, fieldsByName).ok;

/** Ce qui est envoyé à « Créer » : exactement les lignes cochées à l'écran. */
export function checkedPayload(items, rows, fieldsByName) {
  return (items || []).filter((it) => isChecked(it, rows[it.code], fieldsByName)).map((it) => {
    const r = rows[it.code];
    const positive = String(r.positive ?? '').trim();
    return { code: it.code, sourceField: r.field, positiveValue: positive === '' ? null : positive };
  });
}

/**
 * Refus de « Créer » qui nomme un élément (400 de applyTemplate : type_mismatch,
 * positive_not_in_list, positive_missing, positive_required, positive_is_na, unknown_variable) :
 * { code, item, field, type, agg, value } pour l'afficher sur SA ligne, sinon null.
 */
export function itemError(err) {
  const d = err && err.details;
  if (!d || typeof d !== 'object' || !d.item) return null;
  return { code: d.code || null, item: String(d.item), field: d.field || null, type: d.type || null, agg: d.agg || null, value: d.value ?? null };
}

/**
 * Refus du serveur en mots, dans la langue de l'écran (C20) : ceux du modèle d'indicateurs, puis
 * ceux de l'éditeur (indicatorView.indicatorErrorText : variable inconnue, code pris, « % = valeur »
 * sans valeur, valeur aussi hors base…), sinon le message reçu.
 * @param {{ sourceField?, template? }} [ctx]
 */
export function templateErrorText(err, tr, ctx = {}) {
  if (!err) return null;
  const d = (err.details && typeof err.details === 'object') ? err.details : {};
  switch (d.code) {
    case 'type_mismatch':
      return tr('La variable « {field} » ({type}) ne convient pas à la méthode de cet indicateur ({agg}) : choisissez une autre variable.', {
        field: d.field || ctx.sourceField || '—', type: typeText(d.type, tr), agg: AGG_LABEL[d.agg] ? tr(AGG_LABEL[d.agg]) : (d.agg || '—'),
      });
    case 'positive_not_in_list':
      return tr('La valeur comptée « {value} » n\'est pas dans la liste de la variable « {field} » : choisissez une valeur de sa liste.', { value: d.value ?? '', field: d.field || ctx.sourceField || '—' });
    case 'positive_missing':
      return tr('Choisissez la valeur comptée dans la liste de la variable « {field} ».', { field: d.field || ctx.sourceField || '—' });
    case 'activity_template':
      return tr('Cette fiche est rattachée à « {activity} » : son modèle est « {template} ». Changez l\'activité pour utiliser un autre modèle.', { activity: d.activity || '—', template: d.template || '—' });
    case 'unknown_template':
      return tr('Modèle d\'indicateurs inconnu : « {key} ».', { key: ctx.template || '—' });
    case 'no_template':
      return tr('Aucun modèle d\'indicateurs pour cette fiche : son activité n\'en a pas et ses variables ne correspondent à aucun modèle. Créez les indicateurs un par un (« Nouvel indicateur »).');
    default:
      return indicatorErrorText(err, tr, { sourceField: ctx.sourceField });
  }
}

// ---- États vides -------------------------------------------------------------------------------------

/**
 * Phrase de l'état vide de la Configuration (C25) : « Partez du modèle… » seulement quand la carte
 * du modèle MONTRE un modèle (au-dessus ou au-dessous) ; sinon null (créer un par un).
 */
export function configEmptyKey({ templateShown, above }) {
  if (!templateShown) return null;
  return above
    ? 'Partez du modèle d\'indicateurs ci-dessus : il propose les indicateurs de cette fiche d\'après ses variables. Vérifiez les variables cochées, puis « Créer ».'
    : 'Partez du modèle d\'indicateurs ci-dessous : il propose les indicateurs de cette fiche d\'après ses variables. Vérifiez les variables cochées, puis « Créer ».';
}

/**
 * État de « Créer les N indicateurs proposés » (Résultats sans indicateur, C26) : un chargement
 * échoué n'est JAMAIS dit « aucun modèle ne correspond ».
 * @returns {'loading'|'failed'|'none'|'ambiguous'|'ready'}
 */
export function proposalCtaState(data) {
  if (data === undefined) return 'loading';
  if (!data || data.failed) return 'failed';
  const n = (data.summary && data.summary.proposed) || 0;
  if (!data.template || n === 0) return 'none';
  if (data.source === 'proposal' && data.proposal && data.proposal.ambiguous) return 'ambiguous';
  return 'ready';
}
