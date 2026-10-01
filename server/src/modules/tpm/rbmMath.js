/**
 * Risk-Based Monitoring (RBM) — pure logic for « quels sites suivre ce mois ».
 * No I/O. Each site carries a risk level; the monitoring frequency (months
 * between visits) follows the risk: plus le risque est élevé, plus on visite.
 * Un site est « à suivre » (due) ce mois s'il n'a jamais été visité ou si le
 * nombre de mois écoulés depuis sa dernière visite atteint sa fréquence.
 */
const RISK_LEVELS = ['faible', 'moyenne', 'elevee'];

// Fréquence par défaut (mois entre deux visites) selon le risque.
const DEFAULT_FREQUENCY = { elevee: 1, moyenne: 2, faible: 3 };

function frequencyFor(riskLevel, freq = DEFAULT_FREQUENCY) {
  return freq[riskLevel] || freq.faible || 3;
}

/** Nombre de mois entre deux 'YYYY-MM' (b - a). */
function monthsBetween(a, b) {
  const [ya, ma] = String(a).split('-').map(Number);
  const [yb, mb] = String(b).split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * Un site est-il à suivre pour `targetMonth` ('YYYY-MM') ?
 * @param riskLevel      faible | moyenne | elevee
 * @param lastVisitMonth 'YYYY-MM' de la dernière visite (planifiée ou réalisée) ou null
 */
function isDue(riskLevel, lastVisitMonth, targetMonth, freq = DEFAULT_FREQUENCY) {
  if (!lastVisitMonth) return true;
  const diff = monthsBetween(lastVisitMonth, targetMonth);
  if (diff < 0) return false;          // dernière visite dans le futur du mois cible
  return diff >= frequencyFor(riskLevel, freq);
}

module.exports = { RISK_LEVELS, DEFAULT_FREQUENCY, frequencyFor, monthsBetween, isDue };
