/**
 * Note AUTOMATIQUE d'un agent, tirée des données de suivi (lot 8, retour 28.3) — logique PURE,
 * sans I/O, testée (test/agentScore.test.js). Réglée PAR FICHE (agent_score_configs).
 *
 * Mesures d'un agent sur une fiche et une période (agrégées en SQL ; indicateurs calculés par
 * monitoringMath sur les seuls formulaires de l'agent) :
 *   volume      formulaires valides (non écartés)                                 nombre
 *   ecartes     part écartée au nettoyage = écartés ÷ (valides + écartés)          %
 *   gps         part des formulaires valides avec une position GPS                 %
 *   site        part des formulaires valides reliés à un site du registre          %
 *   indicateur  valeur d'un indicateur de la fiche sur ses seuls formulaires       selon l'indicateur
 *
 * Pour chaque critère c (poids w > 0, plancher f, cible t, f ≠ t) :
 *   v = valeur mesurée (null si aucune donnée) ;  s = clamp((v − f) / (t − f), 0, 1)
 *   (marche dans les deux sens : t < f veut dire « plus c'est bas, mieux c'est »).
 * Couverture = Σ w des critères mesurés ÷ Σ w.
 * Statut de la fiche :
 *   formulaires valides < minimum      → « données insuffisantes », pas de note ;
 *   couverture < minimum (%)           → « non évaluable », pas de note ;
 *   sinon note = 20 × Σ w·s ÷ Σ w (critères mesurés).
 * Plusieurs fiches : moyenne des notes des fiches notées, pondérée par leurs formulaires valides.
 * Arrondi au dixième, demi vers le haut, une seule fois, à la fin.
 */
const SCALE = 20;
const METRICS = ['volume', 'ecartes', 'gps', 'site', 'indicateur'];
// Valeurs proposées à la création d'un critère (modifiables) : plancher → cible.
const METRIC_DEFAULTS = {
  volume: { floor: 5, target: 20, label: 'Formulaires valides' },
  ecartes: { floor: 20, target: 2, label: 'Formulaires écartés au nettoyage' },
  gps: { floor: 70, target: 100, label: 'Formulaires avec position GPS' },
  site: { floor: 50, target: 95, label: 'Formulaires reliés à un site' },
  indicateur: { floor: 50, target: 90, label: 'Indicateur de la fiche' },
};

const EPS = 1e-9;
/** Arrondi au dixième, demi vers le haut (tolérance des flottants). */
const round1 = (x) => (x == null ? null : Math.floor(x * 10 + 0.5 + EPS) / 10);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const pctOf = (n, d) => (d > 0 ? (100 * n) / d : null);

/**
 * Valeur d'une mesure à partir des agrégats d'un agent sur une fiche.
 * @param {string} metric
 * @param {{ valid, excluded, withGps, withSite }} m   comptages SQL
 * @param {number|null} [indicatorValue]                valeur de l'indicateur (monitoringMath)
 */
function measure(metric, m, indicatorValue = null) {
  const valid = Number(m.valid) || 0;
  switch (metric) {
    case 'volume': return valid;
    case 'ecartes': return pctOf(Number(m.excluded) || 0, valid + (Number(m.excluded) || 0));
    case 'gps': return pctOf(Number(m.withGps) || 0, valid);
    case 'site': return pctOf(Number(m.withSite) || 0, valid);
    case 'indicateur': return indicatorValue == null || !Number.isFinite(Number(indicatorValue)) ? null : Number(indicatorValue);
    default: return null;
  }
}

/** Sous-score d'un critère (0 à 1) ; null sans valeur. */
function subScore(v, floor, target) {
  if (v == null) return null;
  const f = Number(floor); const t = Number(target);
  if (f === t) throw new Error('Plancher et cible doivent différer.');
  return clamp01((Number(v) - f) / (t - f));
}

/**
 * Note d'un agent sur UNE fiche.
 * @param {{ formId, formLabel?, minSubmissions, minCoveragePct, criteria: Array<{ id?, label, metric, weight, floor, target, indicatorId? }> }} config
 * @param {{ valid, excluded, withGps, withSite }} m
 * @param {Map<string, number|null>|object} [indicatorValues]  indicatorId → valeur
 */
function formScore(config, m, indicatorValues = new Map()) {
  const get = (id) => (indicatorValues instanceof Map ? indicatorValues.get(id) : indicatorValues[id]);
  const valid = Number(m.valid) || 0;
  let totalW = 0; let measuredW = 0; let acc = 0;
  const exact = []; // sous-scores exacts (non arrondis) : les points affichés en dérivent
  const criteria = (config.criteria || []).map((c) => {
    const w = Number(c.weight);
    totalW += w;
    const v = measure(c.metric, m, c.metric === 'indicateur' ? get(c.indicatorId) : null);
    const s = subScore(v, c.floor, c.target);
    exact.push(s);
    if (s != null) { measuredW += w; acc += w * s; }
    return {
      id: c.id || null, label: c.label, metric: c.metric, indicatorId: c.indicatorId || null, weight: w, floor: Number(c.floor), target: Number(c.target),
      direction: Number(c.target) > Number(c.floor) ? 'higher' : 'lower',
      value: v == null ? null : round1(v), subScore: s == null ? null : round1(s * 100), points: null,
    };
  });
  const coverage = totalW ? round1((measuredW / totalW) * 100) : 0;
  const base = { formId: config.formId, formLabel: config.formLabel || null, submissions: valid, coverage, criteria };
  if (!criteria.length) return { ...base, status: 'non_configure', score: null };
  if (valid < Number(config.minSubmissions || 1)) return { ...base, status: 'donnees_insuffisantes', score: null };
  if (measuredW / totalW * 100 + EPS < Number(config.minCoveragePct || 0)) return { ...base, status: 'non_evaluable', score: null };
  const score = round1((SCALE * acc) / measuredW);
  // Points de chaque critère sur la note, rapportés au poids MESURÉ, pour « Pourquoi cette note ? ».
  criteria.forEach((c, i) => { c.points = exact[i] == null ? null : round1((SCALE * c.weight * exact[i]) / measuredW); });
  return { ...base, status: 'note', score };
}

/**
 * Note automatique d'un agent : moyenne des fiches notées, pondérée par leurs formulaires valides.
 * @param {object[]} forms  résultats de formScore
 * @returns {{ score: number|null, status: 'note'|'donnees_insuffisantes'|'non_evaluable'|'aucune_donnee', forms: object[], submissions: number }}
 */
function autoScore(forms) {
  const list = forms || [];
  const scored = list.filter((f) => f.status === 'note');
  const submissions = list.reduce((s, f) => s + (f.submissions || 0), 0);
  if (!scored.length) {
    const status = !submissions ? 'aucune_donnee'
      : list.some((f) => f.status === 'non_evaluable') ? 'non_evaluable' : 'donnees_insuffisantes';
    return { score: null, status, forms: list, submissions };
  }
  const n = scored.reduce((s, f) => s + f.submissions, 0);
  const score = round1(scored.reduce((s, f) => s + f.score * f.submissions, 0) / n);
  return { score, status: 'note', forms: list, submissions };
}

/** Contrôles d'un critère saisi (service + zod) : mesure connue, poids > 0, plancher ≠ cible, indicateur pour « indicateur ». */
function checkCriterion(c) {
  const errors = [];
  if (!METRICS.includes(c.metric)) errors.push('metric');
  if (!(Number(c.weight) > 0)) errors.push('weight');
  if (!Number.isFinite(Number(c.floor)) || !Number.isFinite(Number(c.target)) || Number(c.floor) === Number(c.target)) errors.push('thresholds');
  if ((c.metric === 'indicateur') !== Boolean(c.indicatorId)) errors.push('indicator');
  return errors;
}

/** Période proposée par défaut : la plus longue des fiches actives (mois 1, trimestre 3, semestre 6). */
const PERIOD_MONTHS = { mois: 1, trimestre: 3, semestre: 6 };
function defaultSpan(configs) {
  const spans = (configs || []).filter((c) => c.enabled !== false).map((c) => PERIOD_MONTHS[c.period] || 3);
  return spans.length ? Math.max(...spans) : 3;
}

module.exports = {
  SCALE, METRICS, METRIC_DEFAULTS, PERIOD_MONTHS, round1, measure, subScore, formScore, autoScore, checkCriterion, defaultSpan,
};
