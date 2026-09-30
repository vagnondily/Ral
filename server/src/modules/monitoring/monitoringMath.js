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

function isYes(v, positiveValue) {
  if (v == null || v === '') return null; // not answered → excluded from the base
  const s = String(v).trim().toLowerCase();
  if (positiveValue != null && positiveValue !== '') return s === String(positiveValue).trim().toLowerCase() ? 1 : 0;
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
  const vals = [];
  for (const s of submissions || []) {
    const d = s.data || {};
    if (Object.prototype.hasOwnProperty.call(d, field)) vals.push(d[field]);
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
    const flags = vals.map((v) => isYes(v, indicator.positiveValue)).filter((f) => f != null);
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
    target: ind.target == null ? null : Number(ind.target),
    ...computeIndicator(ind, submissions),
  }));
}

module.exports = { computeIndicator, computeAll, rate, toNumber, isYes };
