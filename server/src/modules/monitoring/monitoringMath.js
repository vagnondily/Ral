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

/**
 * Compute one indicator over a list of submissions.
 * @param {object} indicator {sourceField, agg, positiveValue, target, direction}
 * @param {object[]} submissions rows with a `.data` object
 * @returns {{value:number|null, base:number, rating:string}}
 */
function computeIndicator(indicator, submissions, names = [indicator.sourceField]) {
  const na = naSet(indicator.naValues);
  const vals = [];
  for (const s of submissions || []) {
    const d = s.data || {};
    const field = names.find((n) => Object.prototype.hasOwnProperty.call(d, n));
    if (field === undefined) continue;
    // Codes « hors base » écartés pour toutes les méthodes (une moyenne avec 9999 n'a pas de sens).
    if (d[field] != null && na.has(String(d[field]).trim().toLowerCase())) continue;
    vals.push(d[field]);
  }

  let value = null;
  let base = 0;

  if (indicator.agg === 'count') {
    value = vals.filter((v) => v != null && v !== '').length;
    base = value;
  } else if (indicator.agg === 'sum') {
    const nums = vals.map(toNumber).filter((n) => n != null);
    base = nums.length;
    value = nums.reduce((a, b) => a + b, 0);
  } else if (indicator.agg === 'mean') {
    const nums = vals.map(toNumber).filter((n) => n != null);
    base = nums.length;
    value = base ? round1(nums.reduce((a, b) => a + b, 0) / base) : null;
  } else {
    // percent_yes / percent_value: % of answered submissions that are positive
    const flags = vals.map((v) => isYes(v, indicator.positiveValue, indicator.naValues)).filter((f) => f != null);
    base = flags.length;
    value = base ? round1((flags.reduce((a, b) => a + b, 0) / base) * 100) : null;
  }

  return { value, base, rating: rate(value, indicator) };
}

// Seuils des modèles de référence (score orienté, sur 100) quand l'indicateur n'a pas de cible.
const BANDS = { exc: 80, sat: 65, imp: 50 };

/**
 * Classe d'un résultat d'indicateur — la MÊME partout (liste des résultats,
 * Synthèse, Couverture & performance, rapports) :
 *   - pas de valeur → na (non évalué) ;
 *   - avec cible : atteinte → exc ; écart relatif à la cible ≤ 10 % → sat ;
 *     ≤ 30 % → imp ; au-delà → urg ;
 *   - sans cible : bandes des modèles sur le score orienté d'un % (≥ 80 exc,
 *     ≥ 65 sat, ≥ 50 imp, sinon urg) ; na pour une moyenne, une somme ou un nombre.
 * @param {{ value, target, direction, agg }} result
 */
function classify(result) {
  if (!result || result.value == null) return 'na';
  const t = result.target == null || result.target === '' ? null : Number(result.target);
  if (t == null || Number.isNaN(t)) {
    const sc = orientedScore(result);
    if (sc == null) return 'na';
    return sc >= BANDS.exc ? 'exc' : sc >= BANDS.sat ? 'sat' : sc >= BANDS.imp ? 'imp' : 'urg';
  }
  const value = Number(result.value);
  const better = result.direction !== 'lower_better';
  if (better ? value >= t : value <= t) return 'exc';
  const gap = better ? (t - value) / (t || 1) : (value - t) / (t || 1);
  if (gap <= 0.1) return 'sat';
  if (gap <= 0.3) return 'imp';
  return 'urg';
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
/** Noms à essayer pour une variable : le nom exact d'abord, puis ses variantes de casse présentes dans les données. */
function namesFor(field, idx) {
  const alts = idx ? [...(idx.get(String(field).toLowerCase()) || [])].filter((k) => k !== field) : [];
  return [field, ...alts];
}

/** Compute every indicator of a form over the given submissions. */
function computeAll(indicators, submissions) {
  const idx = keyIndex(submissions);
  return (indicators || []).map((ind) => ({
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
    ...computeIndicator(ind, submissions, namesFor(ind.sourceField, idx)),
  }));
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

module.exports = { computeIndicator, computeAll, rate, classify, BANDS, overallIndex, orientedScore, toNumber, isYes, keyIndex, namesFor };
