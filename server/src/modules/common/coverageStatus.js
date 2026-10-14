/**
 * Statut d'un TAUX DE COUVERTURE (sites actifs réalisés ÷ sites actifs) — PUR, testé
 * (test/coverageStatus.test.js). Seuils proposés (lot 7a, à confirmer, § 19) :
 *   ≥ 80 % Bon · ≥ 60 % Moyen · ≥ 30 % Faible · sinon Critique ; pas de taux (aucun site
 *   actif) → null, affiché « — aucun plan », jamais « Critique ».
 * Repères du rapport de référence : 82 % → Bon, 65 % → Moyen, 38 % → Faible, 25 % → Critique
 * (« < 40 % : sous le seuil de représentativité »).
 *
 * Ce n'est PAS la classe d'un indicateur (monitoringMath.classify : écart à la cible ou bandes
 * 80 / 65 / 50 sur un score de conformité) : une couverture mesure la présence sur le terrain,
 * pas la qualité de ce qui a été observé — deux règles distinctes, chacune à un seul endroit.
 */
const COVERAGE_THRESHOLDS = { bon: 0.8, moyen: 0.6, faible: 0.3 };
const COVERAGE_STATUS_LABELS = { bon: 'Bon', moyen: 'Moyen', faible: 'Faible', critique: 'Critique' };

/**
 * @param {number|null} rate taux en fraction (0..1), comme fieldMath / siteActivity.ratesOf
 * @returns {'bon'|'moyen'|'faible'|'critique'|null}
 */
function coverageStatus(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return null;
  const r = Number(rate);
  if (r >= COVERAGE_THRESHOLDS.bon) return 'bon';
  if (r >= COVERAGE_THRESHOLDS.moyen) return 'moyen';
  if (r >= COVERAGE_THRESHOLDS.faible) return 'faible';
  return 'critique';
}

module.exports = { coverageStatus, COVERAGE_THRESHOLDS, COVERAGE_STATUS_LABELS };
