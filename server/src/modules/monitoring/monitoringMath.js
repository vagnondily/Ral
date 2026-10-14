/**
 * Suivi de processus — pure computation of indicator values from submissions.
 * No I/O, fully unit-tested. An indicator maps a form field + an aggregation
 * to a single number (and its rating against a target), computed over the
 * submissions that matched the filter (period, site…).
 */

const YES = new Set(['1', 'yes', 'oui', 'true', 'vrai', 'y', 'o']);
const NO = new Set(['0', 'no', 'non', 'false', 'faux', 'n']);

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(',', '.').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Valeurs codées « hors base » d'un indicateur (Sans objet 9999, Ne sait pas 888, N/A 777…). */
const naSet = (naValues) => new Set((naValues || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean));

/**
 * Réponse positive ? 1 / 0, ou null si non répondue ou « hors base » (naValues).
 * `positiveValue` peut lister plusieurs valeurs séparées par « | » (ex. « 1|2 » :
 * « Très sûr » et « Sûr » comptent comme positifs).
 */
function isYes(v, positiveValue, naValues) {
  if (v == null || v === '') return null; // not answered → excluded from the base
  const s = String(v).trim().toLowerCase();
  if (naValues && naSet(naValues).has(s)) return null;
  if (positiveValue != null && positiveValue !== '') {
    const ok = String(positiveValue).split('|').map((x) => x.trim().toLowerCase()).filter(Boolean);
    return ok.includes(s) ? 1 : 0;
  }
  if (YES.has(s)) return 1;
  if (NO.has(s)) return 0;
  return 0; // answered but not a positive value
}

const round1 = (n) => Math.round(n * 10) / 10;
const SCALAR_AGGS = new Set(['count', 'sum', 'mean']);
/** Méthode « en % » (percent_yes / percent_value — et toute méthode inconnue, comme le calcul l'a toujours traitée). */
const isPercentAgg = (agg) => !SCALAR_AGGS.has(agg);
/** Valeurs comptées comme positives (« 1|2 » → ['1', '2']). */
const positiveList = (positiveValue) => (positiveValue == null ? [] : String(positiveValue).split('|').map((x) => x.trim()).filter(Boolean));
const bumpBy = (map, k, w) => map.set(k, (map.get(k) || 0) + w);

/**
 * Décompte d'un indicateur sur des soumissions — LA boucle du calcul : la
 * valeur (computeIndicator) et son explication (explainIndicator) en dérivent,
 * elles ne peuvent donc pas diverger.
 *   total = soumissions examinées ; absent = sans la variable ; blank = variable
 *   vide ; naExcluded = codes « hors base » écartés (par valeur) ; values =
 *   réponses comptées (par valeur) ; answered = nombre de réponses comptées ;
 *   positives (méthodes en %) ; numeric / sum (moyenne, somme).
 *
 * Le décompte est ADDITIF (lot 7a) : les soumissions lues page par page, ou par
 * bureau, donnent des décomptes que mergeTallies réunit sans relire les données.
 * La somme est faite par valeur distincte (byNumber), dans l'ordre croissant des
 * valeurs (Σ valeur × effectif) : elle ne dépend ni de l'ordre des lignes ni de
 * leur découpage — un décompte réuni est identique, au bit près, au décompte
 * d'un seul tenant.
 */
function tallyIndicator(indicator, submissions, names = [indicator.sourceField]) {
  const na = naSet(indicator.naValues);
  const pct = isPercentAgg(indicator.agg);
  const numericAgg = indicator.agg === 'sum' || indicator.agg === 'mean';
  // Valeurs positives lues une fois (même règle que isYes, sans relire positiveValue à chaque ligne).
  const posList = indicator.positiveValue != null && indicator.positiveValue !== '' ? new Set(positiveList(indicator.positiveValue).map((x) => x.toLowerCase())) : null;
  const t = emptyTally();
  const has = Object.prototype.hasOwnProperty;
  for (const s of submissions || []) {
    t.total += 1;
    const d = s.data || {};
    const field = names.find((n) => has.call(d, n));
    if (field === undefined) { t.absent += 1; continue; }
    const v = d[field];
    if (v == null || v === '') { t.blank += 1; continue; } // non répondue : hors base
    const trimmed = String(v).trim();
    const low = trimmed.toLowerCase();
    // Clé d'affichage d'une réponse (comptage par valeur) : le texte sans espaces autour.
    const key = trimmed === '' ? String(v) : trimmed;
    // Codes « hors base » écartés pour toutes les méthodes (une moyenne avec 9999 n'a pas de sens).
    if (na.has(low)) { bumpBy(t.naExcluded, key, 1); continue; }
    t.answered += 1;
    bumpBy(t.values, key, 1);
    if (pct) {
      if (posList ? posList.has(low) : YES.has(low)) t.positives += 1;
    } else if (numericAgg) {
      const n = toNumber(v);
      if (n != null) { t.numeric += 1; bumpBy(t.byNumber, n, 1); }
    }
  }
  t.sum = sumOf(t.byNumber);
  return t;
}

function emptyTally() {
  return { total: 0, absent: 0, blank: 0, naExcluded: new Map(), values: new Map(), answered: 0, positives: 0, numeric: 0, byNumber: new Map(), sum: 0 };
}

/** Σ valeur × effectif, valeurs dans l'ordre croissant : indépendant de l'ordre de lecture. */
function sumOf(byNumber) {
  let sum = 0;
  for (const [n, c] of [...byNumber.entries()].sort((a, b) => a[0] - b[0])) sum += n * c;
  return sum;
}

/**
 * Réunion de décomptes du MÊME indicateur (pages de lecture, bureaux, mois…) :
 * identique au décompte de toutes leurs soumissions d'un seul tenant.
 * @param {object[]} tallies décomptes de tallyIndicator (ou de mergeTallies)
 */
function mergeTallies(tallies) {
  const t = emptyTally();
  for (const x of tallies || []) {
    if (!x) continue;
    for (const k of ['total', 'absent', 'blank', 'answered', 'positives', 'numeric']) t[k] += x[k];
    for (const k of ['naExcluded', 'values', 'byNumber']) for (const [v, c] of x[k]) bumpBy(t[k], v, c);
  }
  t.sum = sumOf(t.byNumber);
  return t;
}

/** Valeur, base et classe d'un indicateur à partir de son décompte. */
function resultFromTally(indicator, t) {
  let value = null;
  let base = 0;
  if (indicator.agg === 'count') {
    value = t.answered;
    base = value;
  } else if (indicator.agg === 'sum') {
    base = t.numeric;
    value = t.sum;
  } else if (indicator.agg === 'mean') {
    base = t.numeric;
    value = base ? round1(t.sum / base) : null;
  } else {
    // percent_yes / percent_value : % des réponses comptées qui sont positives
    base = t.answered;
    value = base ? round1((t.positives / base) * 100) : null;
  }
  // Aucune réponse comptée : non évalué (un nombre ou une somme vaut 0, mais rien n'a été mesuré).
  // present = soumissions qui portent la variable ; naCount = réponses écartées « hors base » ;
  // answered = réponses comptées. Ils ne changent pas la valeur : ils disent POURQUOI un
  // indicateur n'est pas évalué (naReason).
  let naCount = 0;
  for (const n of t.naExcluded.values()) naCount += n;
  return { value, base, rating: base ? rate(value, indicator) : 'na', present: t.total - t.absent, naCount, answered: t.answered };
}

/**
 * Compute one indicator over a list of submissions.
 * @param {object} indicator {sourceField, agg, positiveValue, target, direction, naValues}
 * @param {object[]} submissions rows with a `.data` object
 * @returns {{value:number|null, base:number, rating:string}}
 */
function computeIndicator(indicator, submissions, names = [indicator.sourceField]) {
  return resultFromTally(indicator, tallyIndicator(indicator, submissions, names));
}

// Seuils des modèles de référence (score orienté, sur 100) quand l'indicateur n'a pas de cible.
const BANDS = { exc: 80, sat: 65, imp: 50 };
// Écart relatif à la cible, en % : ≤ sat → Satisfaisant ; ≤ imp → À améliorer ; au-delà → Action urgente.
const TARGET_GAPS = { sat: 10, imp: 30 };
// Seuil franchi par chaque classe sous la cible : l'écart d'une classe est TOUJOURS au-dessus.
const GAP_FLOOR = { sat: 0, imp: TARGET_GAPS.sat, urg: TARGET_GAPS.imp };

/**
 * Écart à la cible en %, débarrassé du bruit des flottants pour la comparaison
 * aux seuils : 2,7 face à 3 est un écart de 10 % pile (Satisfaisant), pas de
 * 10,000000000000009 % (À améliorer).
 */
const snapPct = (x) => Math.round(x * 1e9) / 1e9;

/**
 * Écart AFFICHÉ, cohérent avec la classe : arrondi au dixième, sauf s'il
 * retomberait sur le seuil que la classe a franchi — 10,05 % est « À
 * améliorer », l'afficher « 10 % » contredirait « ≤ 10 % : Satisfaisant ».
 * Il est alors arrondi au centième SUPÉRIEUR (10,05), jamais au seuil ou en
 * dessous ; de même un écart non nul ne s'affiche jamais « 0 % ».
 * Le relèvement ne vaut que pour un écart POSITIF : un écart nul (ou négatif,
 * qui ne devrait jamais arriver) s'affiche tel quel, jamais un « 0,01 % » inventé.
 * @param {number} gapPct écart en % (> 0 : cible non atteinte)
 * @param {'sat'|'imp'|'urg'} rating classe obtenue avec cet écart
 */
function displayGap(gapPct, rating) {
  const r = round1(gapPct);
  const floor = GAP_FLOOR[rating];
  if (floor == null || !(gapPct > 0) || r > floor) return r;
  const up = Math.ceil(Math.round(gapPct * 1e6) / 1e4) / 100;
  return up > floor ? up : Math.round((floor + 0.01) * 100) / 100;
}

/**
 * Classe d'un résultat d'indicateur AVEC la règle appliquée — la MÊME partout
 * (liste des résultats, Synthèse, Couverture & performance, rapports,
 * explication du calcul) :
 *   - pas de valeur, ou aucune réponse comptée (base 0) → na (non évalué)
 *     — basis 'none', reason 'no_data' ;
 *   - avec cible : atteinte → exc ; écart relatif à la cible ≤ 10 % → sat ;
 *     ≤ 30 % → imp ; au-delà → urg — basis 'target', gapPct (l'écart affiché,
 *     jamais en contradiction avec la classe : displayGap) ;
 *   - sans cible : bandes des modèles sur le score orienté d'un % (≥ 80 exc,
 *     ≥ 65 sat, ≥ 50 imp, sinon urg) — basis 'bands', oriented ; na pour une
 *     moyenne, une somme ou un nombre — basis 'none', reason 'no_target'.
 * @param {{ value, base?, target, direction, agg }} result
 * @returns {{ rating: string, basis: 'target'|'bands'|'none', reason?: string, oriented?: number,
 *   target?: number, achieved?: boolean, gapPct?: number, thresholds?: object }}
 */
function classifyDetail(result) {
  if (!result || result.value == null || result.base === 0) return { rating: 'na', basis: 'none', reason: 'no_data' };
  const t = result.target == null || result.target === '' ? null : Number(result.target);
  if (t == null || Number.isNaN(t)) {
    const sc = orientedScore(result);
    if (sc == null) return { rating: 'na', basis: 'none', reason: 'no_target' };
    const rating = sc >= BANDS.exc ? 'exc' : sc >= BANDS.sat ? 'sat' : sc >= BANDS.imp ? 'imp' : 'urg';
    return { rating, basis: 'bands', oriented: round1(sc), thresholds: { ...BANDS } };
  }
  const value = Number(result.value);
  const better = result.direction !== 'lower_better';
  if (better ? value >= t : value <= t) return { rating: 'exc', basis: 'target', target: t, achieved: true, gapPct: 0, thresholds: { ...TARGET_GAPS } };
  // Écart RELATIF à |cible| : une cible négative (solde, variation…) donne un
  // écart positif comme les autres, jamais un écart négatif lu « Satisfaisant ».
  // Cible 0 : écart absolu (rien à rapporter).
  const gap = snapPct(((better ? t - value : value - t) / (Math.abs(t) || 1)) * 100);
  const rating = gap <= TARGET_GAPS.sat ? 'sat' : gap <= TARGET_GAPS.imp ? 'imp' : 'urg';
  return { rating, basis: 'target', target: t, achieved: false, gapPct: displayGap(gap, rating), thresholds: { ...TARGET_GAPS } };
}

/** Classe d'un résultat d'indicateur (exc / sat / imp / urg / na) : la règle de classifyDetail, la seule. */
function classify(result) {
  return classifyDetail(result).rating;
}

/** Classe d'une valeur pour un indicateur (cible, sens, méthode) : voir classify. */
function rate(value, indicator) {
  return classify({ value, target: indicator.target, direction: indicator.direction, agg: indicator.agg });
}

/**
 * Clés réelles des réponses, par nom en minuscules : le XLSForm nomme une
 * question « field_office » quand l'export SPSS l'appelle « Field_office ».
 */
function keyIndex(submissions) {
  const idx = new Map();
  for (const s of submissions || []) {
    for (const k of Object.keys(s.data || {})) {
      const l = k.toLowerCase();
      if (!idx.has(l)) idx.set(l, new Set());
      idx.get(l).add(k);
    }
  }
  return idx;
}
/**
 * Noms à essayer pour une variable : le nom exact d'abord, puis ses variantes de
 * casse présentes dans les données, dans un ordre FIXE (tri par code) — le choix
 * d'une ligne qui porterait deux variantes ne dépend pas de l'ordre de lecture
 * (le chemin par histogramme SQL applique la même priorité).
 */
function namesFor(field, idx) {
  const alts = idx ? [...(idx.get(String(field).toLowerCase()) || [])].filter((k) => k !== field).sort() : [];
  return [field, ...alts];
}

/**
 * Définition d'un indicateur telle que la renvoient les résultats (sans la valeur) :
 * partagée par computeAll (soumissions une à une) et computeAllFromHistogram
 * (histogrammes SQL) — un seul objet résultat.
 */
function indicatorMeta(ind) {
  return {
    id: ind.id,
    code: ind.code,
    label: ind.label,
    module: ind.module || null,
    sourceField: ind.sourceField,
    agg: ind.agg,
    direction: ind.direction || 'higher_better',
    // Compte dans l'indice (faux pour un chiffre clé ou un module complémentaire du modèle).
    scored: ind.scored !== false,
    target: ind.target == null ? null : Number(ind.target),
    // Définition complète, pour expliquer le calcul et éditer l'indicateur depuis les résultats.
    positiveValue: ind.positiveValue == null || ind.positiveValue === '' ? null : String(ind.positiveValue),
    naValues: Array.isArray(ind.naValues) ? ind.naValues : [],
    templateCode: ind.templateCode ?? null,
    active: ind.active !== false,
  };
}

/** Compute every indicator of a form over the given submissions. */
function computeAll(indicators, submissions) {
  const idx = keyIndex(submissions);
  return (indicators || []).map((ind) => ({
    ...indicatorMeta(ind),
    ...computeIndicator(ind, submissions, namesFor(ind.sourceField, idx)),
  }));
}

const DISTRIBUTION_TOP = 12;
const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * Explication d'un indicateur sur des soumissions : d'où vient la valeur, chiffre
 * par chiffre. Même décompte que computeIndicator (tallyIndicator) : `value` et
 * `base` sont TOUJOURS ceux du calcul.
 * @param {object} indicator {sourceField, agg, positiveValue, naValues, target, direction}
 * @param {object[]} submissions rows with a `.data` object
 * @param {string[]} [names] noms à essayer (namesFor)
 * @param {{ choiceLabels?: Map<string,string>|object, top?: number }} [opts]
 * @returns {{ agg, positiveValues: string[], naValues: string[], total, absent, blank,
 *   na: Array<{value,label,n}>, naCount, answered, ignored, base, numerator, denominator, value,
 *   distribution: Array<{value,label,n,role}>, others: {n, positives}, distinct, classification }}
 *   role ∈ positive | negative (méthodes en %), counted | ignored (moyenne, somme, nombre).
 */
function explainIndicator(indicator, submissions, names = [indicator.sourceField], opts = {}) {
  return explainFromTally(indicator, tallyIndicator(indicator, submissions, names), opts);
}

/** Explication à partir d'un décompte déjà fait (tallyIndicator ou mergeTallies) : voir explainIndicator. */
function explainFromTally(indicator, t, { choiceLabels, top = DISTRIBUTION_TOP } = {}) {
  const r = resultFromTally(indicator, t);
  const pct = isPercentAgg(indicator.agg);
  const labelOf = (v) => {
    if (!choiceLabels) return null;
    const l = choiceLabels instanceof Map ? choiceLabels.get(String(v)) : choiceLabels[String(v)];
    return l == null || l === '' ? null : String(l);
  };
  const roleOf = (v) => {
    if (pct) return isYes(v, indicator.positiveValue) === 1 ? 'positive' : 'negative';
    if (indicator.agg === 'count') return 'counted';
    return toNumber(v) == null ? 'ignored' : 'counted';
  };
  // Ordre FIXE (effectif, puis valeur) : l'explication ne dépend pas de l'ordre de lecture des soumissions.
  const byCount = (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'fr', { numeric: true })
    || (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0);
  const sorted = [...t.values.entries()].sort(byCount);
  const distribution = sorted.slice(0, top).map(([value, n]) => ({ value, label: labelOf(value), n, role: roleOf(value) }));
  const rest = sorted.slice(top);
  const na = [...t.naExcluded.entries()].sort(byCount).map(([value, n]) => ({ value, label: labelOf(value), n }));
  let numerator = null;
  let denominator = null;
  if (pct) { numerator = t.positives; denominator = t.answered; } else if (indicator.agg === 'mean') { numerator = round4(t.sum); denominator = t.numeric; } else if (indicator.agg === 'sum') numerator = round4(t.sum);
  else numerator = t.answered;
  return {
    agg: indicator.agg,
    positiveValues: positiveList(indicator.positiveValue),
    naValues: (indicator.naValues || []).map((x) => String(x).trim()).filter(Boolean),
    total: t.total,
    absent: t.absent,
    blank: t.blank,
    na,
    naCount: na.reduce((s, x) => s + x.n, 0),
    answered: t.answered,
    // Moyenne / somme : réponses non numériques, ignorées.
    ignored: indicator.agg === 'sum' || indicator.agg === 'mean' ? t.answered - t.numeric : 0,
    base: r.base,
    numerator,
    denominator,
    value: r.value,
    distribution,
    others: { n: rest.reduce((s, [, n]) => s + n, 0), positives: pct ? rest.reduce((s, [v, n]) => s + (roleOf(v) === 'positive' ? n : 0), 0) : 0 },
    distinct: t.values.size,
    classification: classifyDetail({ value: r.value, base: r.base, target: indicator.target, direction: indicator.direction, agg: indicator.agg }),
  };
}

const isPercentResult = (r) => r && (r.agg === 'percent_yes' || r.agg === 'percent_value') && r.value != null;

/**
 * Score orienté d'un indicateur en % : la valeur, ou 100 − valeur quand « plus
 * bas = mieux » (personnel armé présent, fraude…). C'est lui qui entre dans les
 * moyennes et les classes ; la valeur affichée reste la valeur mesurée.
 */
function orientedScore(r) {
  if (!isPercentResult(r)) return null;
  return r.direction === 'lower_better' ? 100 - Number(r.value) : Number(r.value);
}

/**
 * Indice de conformité (sur 100), comme les rapports de référence : moyenne des
 * DOMAINES à poids égaux, chaque domaine (`module`) étant la moyenne des scores
 * orientés de ses indicateurs en %. Sans domaines, c'est la moyenne des
 * indicateurs. Null quand aucun indicateur en % n'est calculable.
 */
function overallIndex(indicatorResults) {
  const groups = new Map();
  for (const r of indicatorResults || []) {
    if (r && r.scored === false) continue;
    const sc = orientedScore(r);
    if (sc == null) continue;
    const k = r.module || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(sc);
  }
  if (!groups.size) return null;
  const means = [...groups.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  return Math.round((means.reduce((a, b) => a + b, 0) / means.length) * 10) / 10;
}

/**
 * POURQUOI un indicateur est « Non évalué » (classify → na), sans changer la
 * règle de classe : c'est classify qui décide, naReason ne fait que l'expliquer.
 *   - 'no_data'         : aucune soumission sur la période ;
 *   - 'variable_absent' : des soumissions, mais aucune ne porte la variable
 *                         (question ajoutée/retirée dans une autre version du
 *                         formulaire, ou nom de variable à corriger) ;
 *   - 'only_na'         : la variable n'a reçu que des codes « hors base » (NA) ;
 *   - 'no_answer'       : la variable est présente mais toujours vide ;
 *   - 'not_numeric'     : une moyenne ou une somme dont les réponses existent
 *                         mais ne sont pas des nombres (méthode ou variable à revoir) ;
 *   - 'no_target'       : une moyenne, une somme ou un nombre sans cible —
 *                         valeur affichée, mais aucune bande ne s'applique ;
 *   - 'not_scored'      : classé, mais hors indice (indicateur complémentaire).
 * Renvoie null pour un indicateur classé qui compte dans l'indice.
 * @param {object} result un résultat de computeAll (value, base, present, naCount, scored…)
 * @param {{ periodCount?:number }} [ctx] nombre de soumissions de la période
 */
function naReason(result, { periodCount } = {}) {
  if (!result) return null;
  if (classify(result) !== 'na') return result.scored === false ? 'not_scored' : null;
  if (periodCount === 0) return 'no_data';
  if (result.present === 0) return 'variable_absent';
  if (!result.base) {
    if (result.answered > 0) return 'not_numeric';
    return result.naCount > 0 ? 'only_na' : 'no_answer';
  }
  return 'no_target';
}

module.exports = {
  computeIndicator, computeAll, rate, classify, classifyDetail, displayGap, BANDS, TARGET_GAPS, overallIndex, orientedScore, toNumber, isYes,
  keyIndex, namesFor, tallyIndicator, mergeTallies, resultFromTally, indicatorMeta, explainIndicator, explainFromTally,
  isPercentAgg, positiveList, naReason,
};
