/**
 * Indicateurs de suivi de processus — fonctions PURES de l'interface (liste
 * des résultats, éditeur, explication du calcul). Aucun accès au DOM ni à
 * l'API : testées depuis server/test/indicatorView.test.js.
 */

export const AGGS = ['percent_yes', 'percent_value', 'mean', 'sum', 'count'];

// Classes d'indicateur : la même règle partout (serveur monitoringMath.classify),
// même vocabulaire que les tableaux de bord. Couleur + icône + libellé (StatusBadge).
export const INDICATOR_STATUS = {
  exc: { label: 'Excellent', tone: 'green', icon: 'check', fill: 'var(--green)' },
  sat: { label: 'Satisfaisant', tone: 'blue', icon: 'clock', fill: 'var(--blue-600)' },
  imp: { label: 'À améliorer', tone: 'orange', icon: 'warn', fill: 'var(--orange)' },
  urg: { label: 'Action urgente', tone: 'red', icon: 'x', fill: 'var(--red)' },
  na: { label: 'Non évalué', tone: undefined, icon: 'na', fill: 'var(--text-faint)' },
};
export const isPctAgg = (agg) => agg === 'percent_yes' || agg === 'percent_value';

// Libellés des valeurs d'une option éclatée (« X.1 ») fixés par le serveur
// (variableCatalog.OPTION_CHOICES) : seuls ceux-là se traduisent — les libellés
// de choix du formulaire sont des données, affichées telles quelles.
const OPTION_VALUE_LABELS = new Set(['sélectionné', 'non sélectionné']);
/** Libellé d'une valeur de choix à afficher (traduit seulement s'il vient de l'application). */
export const choiceText = (label, tr) => (label && OPTION_VALUE_LABELS.has(label) ? tr(label) : label);

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const finite = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * Réalisé face à la cible, pour la colonne « Réalisé / Cible » et le détail :
 *   - % : la valeur, et la cible en % (repère sur la barre 0–100) — jamais la
 *     valeur répétée sous une autre forme ;
 *   - moyenne / somme / nombre avec cible : la valeur, la cible, et une barre
 *     « part de la cible atteinte » ;
 *   - sans cible : la valeur seule (pas de barre pour un nombre).
 * @param {{ value, target, agg }} ind
 * @param {(n:number) => string} [fmt] formatage d'un nombre (langue de l'interface)
 * @returns {{ has: boolean, text?: string, targetText?: string|null, rate?: number|null, targetRate?: number|null }}
 */
export function progress(ind, fmt = (n) => String(n)) {
  if (!ind || ind.value == null || !Number.isFinite(Number(ind.value))) return { has: false };
  const value = Number(ind.value);
  const target = finite(ind.target);
  if (isPctAgg(ind.agg)) {
    return {
      has: true,
      text: `${fmt(value)} %`,
      targetText: target != null ? `${fmt(target)} %` : null,
      rate: clamp01(value / 100),
      targetRate: target != null ? clamp01(target / 100) : null,
    };
  }
  if (target != null && target > 0) {
    return { has: true, text: fmt(value), targetText: fmt(target), rate: clamp01(value / target), targetRate: null };
  }
  return { has: true, text: fmt(value), targetText: target != null ? fmt(target) : null, rate: null, targetRate: null };
}

/** « 1|2 » → ['1', '2'] (valeurs comptées). */
export function splitValues(s) {
  return s == null ? [] : String(s).split('|').map((x) => x.trim()).filter(Boolean);
}
/** ['1', '2'] → « 1|2 », ou null si vide. */
export function joinValues(list) {
  const out = [...new Set((list || []).map((x) => String(x).trim()).filter(Boolean))];
  return out.length ? out.join('|') : null;
}

/** Brouillon éditable d'un indicateur (textes et listes, tels que les champs du formulaire les tiennent). */
export function toDraft(ind) {
  const i = ind || {};
  return {
    code: i.code || '',
    label: i.label || '',
    module: i.module || '',
    sourceField: i.sourceField || '',
    agg: AGGS.includes(i.agg) ? i.agg : 'percent_yes',
    positive: splitValues(i.positiveValue),
    naValues: [...(i.naValues || [])].map(String),
    target: i.target == null ? '' : String(i.target),
    direction: i.direction === 'lower_better' ? 'lower_better' : 'higher_better',
    scored: i.scored !== false,
    active: i.active !== false,
  };
}

/** Définition à enregistrer (création) à partir du brouillon. */
export function draftBody(d) {
  return {
    code: d.code.trim(),
    label: d.label.trim(),
    module: d.module.trim() || null,
    sourceField: d.sourceField.trim(),
    agg: d.agg,
    // Valeurs comptées : seulement pour les méthodes en % (ignorées par une moyenne, une somme, un nombre).
    positiveValue: isPctAgg(d.agg) ? joinValues(d.positive) : null,
    naValues: [...new Set(d.naValues.map((x) => String(x).trim()).filter(Boolean))],
    target: finite(d.target),
    direction: d.direction,
    scored: d.scored,
    active: d.active,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Modification PARTIELLE : seules les clés changées par rapport à l'original
 * (l'API n'écrit que les clés envoyées — rien d'autre n'est touché). Une
 * valeur comptée ignorée par la méthode n'est pas effacée si l'utilisateur n'y
 * a pas touché.
 */
export function draftPatch(originalDraft, d) {
  const a = draftBody(originalDraft);
  const b = draftBody(d);
  if (!isPctAgg(d.agg) && same(originalDraft.positive, d.positive)) b.positiveValue = a.positiveValue;
  const out = {};
  for (const k of Object.keys(b)) if (!same(a[k], b[k])) out[k] = b[k];
  return out;
}

/**
 * Contrôles de saisie (mêmes règles que le serveur) : message par champ.
 * @returns {Record<string,string>} vide si tout va bien
 */
export function draftErrors(d) {
  const e = {};
  if (!d.label.trim()) e.label = 'Requis.';
  if (!d.code.trim()) e.code = 'Requis.';
  if (!d.sourceField.trim()) e.sourceField = 'Choisissez la variable source.';
  if (d.agg === 'percent_value' && !joinValues(d.positive)) e.positive = 'Précisez la valeur comptée.';
  if (String(d.target).trim() !== '' && finite(d.target) == null) e.target = 'Saisissez un nombre.';
  const na = new Set(d.naValues.map((x) => String(x).trim().toLowerCase()));
  if (isPctAgg(d.agg) && d.positive.some((p) => na.has(String(p).trim().toLowerCase()))) e.naValues = 'Une valeur comptée ne peut pas être hors base.';
  return e;
}

/** Corps de l'aperçu « Comment c'est calculé » : la définition en cours + la période. */
export function previewBody(d, period) {
  const b = draftBody(d);
  return {
    sourceField: b.sourceField,
    agg: b.agg,
    positiveValue: b.positiveValue,
    naValues: b.naValues,
    target: b.target,
    direction: b.direction,
    ...(period ? { month: period } : {}),
  };
}

/**
 * Segments de la barre « d'où vient la base » : soumissions examinées, réparties
 * en réponses comptées (positives / négatives pour un %, numériques / ignorées
 * sinon), hors base, vides et sans la variable. Les segments vides sont omis.
 * @returns {Array<{ key: string, n: number, pct: number }>}
 */
export function explainSegments(x) {
  if (!x || !x.total) return [];
  const pct = isPctAgg(x.agg) || !['mean', 'sum', 'count'].includes(x.agg);
  const parts = pct
    ? [['positive', x.numerator || 0], ['negative', (x.denominator || 0) - (x.numerator || 0)]]
    : [['counted', x.agg === 'count' ? x.answered : x.base], ['ignored', x.ignored || 0]];
  parts.push(['na', x.naCount || 0], ['blank', x.blank || 0], ['absent', x.absent || 0]);
  return parts.filter(([, n]) => n > 0).map(([key, n]) => ({ key, n, pct: Math.round((n / x.total) * 1000) / 10 }));
}

/**
 * Règle de classement appliquée (classifyDetail du serveur), pour la phrase
 * d'explication : quelle règle, quel seuil franchi.
 * @returns {{ key: string, vars: object }}
 *   key ∈ no_data | no_target | target_met | target_gap | bands
 */
export function classificationRule(c, direction) {
  if (!c || c.basis === 'none') return { key: c && c.reason === 'no_target' ? 'no_target' : 'no_data', vars: {} };
  if (c.basis === 'target') {
    if (c.achieved) return { key: 'target_met', vars: { target: c.target } };
    return { key: 'target_gap', vars: { target: c.target, gap: c.gapPct, sat: c.thresholds.sat, imp: c.thresholds.imp } };
  }
  const th = c.thresholds;
  const band = c.rating === 'exc' ? `≥ ${th.exc}` : c.rating === 'sat' ? `≥ ${th.sat}` : c.rating === 'imp' ? `≥ ${th.imp}` : `< ${th.imp}`;
  return { key: 'bands', vars: { oriented: c.oriented, band, lower: direction === 'lower_better' } };
}
