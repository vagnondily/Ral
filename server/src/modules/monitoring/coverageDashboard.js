// Logique PURE (zéro I/O, testée) du tableau de bord « Couverture & performance
// du suivi ». Elle met en forme, par activité (= fiche de suivi), les résultats
// d'indicateurs déjà calculés par monitoringMath (computeAll) en :
//   • une répartition en 5 bandes de conformité (exc/sat/imp/urg/na),
//   • des dimensions (regroupées par `module` d'indicateur) avec un score moyen,
//   • un top / flop d'indicateurs en pourcentage,
// et expose les aides « plan vs réalisé » (taux, statut). Aucune valeur n'est
// inventée : tout dérive des résultats fournis.

const { orientedScore, classify, naReason } = require('./monitoringMath');

const CLASSES = ['exc', 'sat', 'imp', 'urg', 'na'];
const CLASS_LABELS = { exc: 'Excellent', sat: 'Satisfaisant', imp: 'À améliorer', urg: 'Action urgente', na: 'Non évalué' };
// La classe d'un indicateur (monitoringMath.classify) est la même que dans la liste des résultats.

/** Compte les indicateurs par bande. Renvoie { exc, sat, imp, urg, na, scored }
 * où `scored` = indicateurs réellement notés (hors na). */
function classDistribution(results) {
  const out = { exc: 0, sat: 0, imp: 0, urg: 0, na: 0 };
  for (const r of results || []) if (!r || r.scored !== false) out[classify(r)] += 1;
  out.scored = out.exc + out.sat + out.imp + out.urg;
  return out;
}

/**
 * Pourquoi les indicateurs notés d'une fiche sont « Non évalué » : nombre par
 * raison (monitoringMath.naReason), sur le même ensemble que classDistribution
 * (indicateurs hors indice exclus) — la somme égale `na`.
 */
function naReasonCounts(results, periodCount) {
  const out = {};
  for (const r of results || []) {
    if (!r || r.scored === false || classify(r) !== 'na') continue;
    const k = naReason(r, { periodCount });
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Vrai pour un indicateur exprimé en pourcentage (0–100) et calculable. */
function isPercent(r) {
  return r && (r.agg === 'percent_yes' || r.agg === 'percent_value') && r.value != null;
}

/** Arrondi à l'entier le plus proche (valeurs déjà en %). */
function round(v) { return Math.round(Number(v) || 0); }

/**
 * Dimensions = regroupement des indicateurs en pourcentage par `module`
 * (ex. « Accès & transport »). Score = moyenne des valeurs du groupe. Chaque
 * dimension liste ses indicateurs {label, pct} triés du plus faible au plus fort.
 * Dimensions triées par score croissant (les plus faibles d'abord).
 */
function dimGroups(results) {
  const groups = new Map();
  for (const r of (results || []).filter((x) => isPercent(x) && x.scored !== false)) {
    const key = r.module || '(sans dimension)';
    if (!groups.has(key)) groups.set(key, []);
    // pct = valeur mesurée (affichée) ; score = orienté (100 − valeur si « plus bas = mieux »).
    groups.get(key).push({ label: r.label, pct: round(r.value), score: orientedScore(r), lower: r.direction === 'lower_better' });
  }
  const out = [];
  for (const [name, inds] of groups.entries()) {
    const score = round(inds.reduce((a, b) => a + b.score, 0) / inds.length);
    inds.sort((a, b) => a.score - b.score);
    for (const i of inds) i.score = round(i.score);
    out.push({ name, score, n: inds.length, inds });
  }
  return out.sort((a, b) => a.score - b.score);
}

/**
 * Top / flop des indicateurs en pourcentage. `top` = meilleurs (desc),
 * `flop` = plus faibles (asc). Bornés par nTop / nFlop.
 */
function topFlop(results, { nTop = 4, nFlop = 6 } = {}) {
  // Classés sur le score orienté : « personnel armé présent 3 % » est un bon résultat.
  const pct = (results || []).filter(isPercent)
    .map((r) => ({ label: r.label, pct: round(r.value), score: orientedScore(r), lower: r.direction === 'lower_better' }));
  const asc = [...pct].sort((a, b) => a.score - b.score);
  const desc = [...pct].sort((a, b) => b.score - a.score);
  return { top: desc.slice(0, nTop), flop: asc.slice(0, nFlop) };
}

/** Taux d'avancement plan→réalisé en %, borné [0,100], 0 si plan nul. */
function progressPct(realized, planned) {
  const p = Number(planned) || 0;
  if (p <= 0) return 0;
  return Math.round((Math.max(0, Number(realized) || 0) / p) * 100);
}

/** Statut d'une ligne plan vs réalisé selon le taux : ok ≥ 80, warn ≥ 50, else low. */
function progressStatus(pctValue) {
  const v = Number(pctValue) || 0;
  if (v >= 80) return 'ok';
  if (v >= 50) return 'warn';
  return 'low';
}

module.exports = {
  CLASSES, CLASS_LABELS,
  classify, classDistribution, naReasonCounts, dimGroups, topFlop,
  isPercent, progressPct, progressStatus,
};
