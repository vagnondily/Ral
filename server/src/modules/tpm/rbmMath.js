/**
 * Risk-Based Monitoring (RBM) — pure logic for « quels sites suivre ce mois ».
 * No I/O. Each site carries a risk level; the monitoring frequency (months
 * between visits) follows the risk: plus le risque est élevé, plus on visite.
 * Un site est « à suivre » (due) ce mois s'il n'a jamais été visité ou si le
 * nombre de mois écoulés depuis sa dernière visite atteint sa fréquence.
 *
 * « Dernière visite » = une visite RÉALISÉE, une collecte réelle (données
 * reçues) ou la date de dernière visite du registre — JAMAIS une visite
 * seulement planifiée (retour n° 48) : une visite prévue ne rend pas un site
 * « à jour » ; elle est montrée à part (« prévue AAAA-MM »).
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

/** 'YYYY-MM' d'une valeur 'YYYY-MM…' (mois, date ISO), sinon null. */
function toMonth(v) {
  const m = /^(\d{4})-(\d{2})/.exec(String(v ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}`;
}

/** 'YYYY-MM' décalé de n mois (n peut être négatif) ; null si le mois ou n est invalide. */
function addMonths(month, n) {
  const m = toMonth(month);
  if (!m || n == null || !Number.isFinite(Number(n))) return null;
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + Math.trunc(Number(n));
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Un site est-il à suivre pour `targetMonth` ('YYYY-MM') ?
 * @param riskLevel      faible | moyenne | elevee
 * @param lastVisitMonth 'YYYY-MM' de la dernière visite RÉALISÉE (ou collecte réelle) ou null —
 *                       jamais d'une visite seulement planifiée (voir lastVisitOf)
 */
function isDue(riskLevel, lastVisitMonth, targetMonth, freq = DEFAULT_FREQUENCY) {
  if (!lastVisitMonth) return true;
  const diff = monthsBetween(lastVisitMonth, targetMonth);
  if (diff < 0) return false;          // dernière visite dans le futur du mois cible
  return diff >= frequencyFor(riskLevel, freq);
}

/**
 * Dernière visite EFFECTIVE d'un site : la plus récente entre
 *   - `fieldVisitMonth` : la dernière visite de terrain RÉALISÉE (statut realise) ;
 *   - `dataVisitMonth`  : la dernière collecte réelle (soumissions reçues) ;
 *   - `lastVisitDate`   : la date de dernière visite du registre (classeur importé).
 * À égalité, la visite réalisée prime, puis les données. Une visite planifiée
 * n'entre jamais ici.
 * @returns {{ month: string|null, source: 'visite'|'donnees'|'registre'|null }}
 */
function lastVisitOf({ fieldVisitMonth, dataVisitMonth, lastVisitDate } = {}) {
  let best = { month: null, source: null };
  for (const [source, value] of [['visite', fieldVisitMonth], ['donnees', dataVisitMonth], ['registre', lastVisitDate]]) {
    const month = toMonth(value);
    if (month && (!best.month || month > best.month)) best = { month, source };
  }
  return best;
}

/**
 * Visites encore PLANIFIÉES d'un site, vues depuis `targetMonth` (défaut : mois courant) :
 *   - nextPlannedMonth : la première prévue au mois cible ou après ;
 *   - latePlannedMonth : la plus récente prévue AVANT le mois cible et jamais réalisée.
 */
function plannedVisits(plannedMonths, targetMonth) {
  const target = toMonth(targetMonth) || currentMonth();
  const months = [...new Set((plannedMonths || []).map(toMonth).filter(Boolean))].sort();
  const past = months.filter((m) => m < target);
  return {
    nextPlannedMonth: months.find((m) => m >= target) || null,
    latePlannedMonth: past.length ? past[past.length - 1] : null,
  };
}

/**
 * État des visites d'une ligne de site (colonnes du SELECT RBM) : dernière visite
 * effective + sa source, et visites prévues — une seule règle pour la page RBM,
 * la génération du plan du mois et le Plan de suivi.
 */
function visitState(row = {}, targetMonth) {
  const last = lastVisitOf(row);
  return { lastVisitMonth: last.month, lastVisitSource: last.source, ...plannedVisits(row.plannedMonths, targetMonth) };
}

module.exports = {
  RISK_LEVELS, DEFAULT_FREQUENCY, frequencyFor, monthsBetween, isDue,
  toMonth, addMonths, currentMonth, lastVisitOf, plannedVisits, visitState,
};
