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
function computeIndicator(indicator, submissions) {
  const field = indicator.sourceField;
  const na = naSet(indicator.naValues);
  const vals = [];
  for (const s of submissions || []) {
    const d = s.data || {};
    if (!Object.prototype.hasOwnProperty.call(d, field)) continue;
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

/** Rate a value against its target + direction → exc / sat / imp / na. */
function rate(value, indicator) {
  if (value == null) return 'na';
  const t = indicator.target == null || indicator.target === '' ? null : Number(indicator.target);
  if (t == null || Number.isNaN(t)) return 'na';
  const better = indicator.direction !== 'lower_better';
  const ok = better ? value >= t : value <= t;
  if (ok) return 'exc';
  // within 10 % (relative) of the target counts as "à améliorer", else "insuffisant"
  const gap = better ? (t - value) / (t || 1) : (value - t) / (t || 1);
  return gap <= 0.1 ? 'sat' : 'imp';
}

/** Compute every indicator of a form over the given submissions. */
function computeAll(indicators, submissions) {
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
    ...computeIndicator(ind, submissions),
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

module.exports = { computeIndicator, computeAll, rate, overallIndex, orientedScore, toNumber, isYes };
