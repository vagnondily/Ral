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
const { localDay } = require('../common/localDay');

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

// Mois courant au jour LOCAL de l'application (APP_TIMEZONE, common/localDay) — le même partout
// (Plan de suivi, RBM, planification automatique et son écran).
const currentMonth = () => localDay().slice(0, 7);

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
 * Mois prévu `month` encore « non réalisé » vu de `targetMonth` : AVANT le mois cible et APRÈS
 * la dernière visite réelle (`lastVisitMonth`). Une visite prévue avant la dernière visite réelle
 * (ou le même mois) n'est plus « non réalisée » : le site a été visité depuis.
 */
function isLatePlanned(month, targetMonth, lastVisitMonth) {
  const m = toMonth(month);
  const target = toMonth(targetMonth) || currentMonth();
  const last = toMonth(lastVisitMonth);
  return Boolean(m && m < target && (!last || m > last));
}

/**
 * Visites encore PLANIFIÉES d'un site, vues depuis `targetMonth` (défaut : mois courant) :
 *   - nextPlannedMonth : la première prévue au mois cible ou après ;
 *   - latePlannedMonth : la plus récente prévue AVANT le mois cible, jamais réalisée, et
 *     postérieure à la dernière visite réelle `lastVisitMonth` (isLatePlanned).
 */
function plannedVisits(plannedMonths, targetMonth, lastVisitMonth = null) {
  const target = toMonth(targetMonth) || currentMonth();
  const months = [...new Set((plannedMonths || []).map(toMonth).filter(Boolean))].sort();
  const late = months.filter((m) => isLatePlanned(m, target, lastVisitMonth));
  return {
    nextPlannedMonth: months.find((m) => m >= target) || null,
    latePlannedMonth: late.length ? late[late.length - 1] : null,
  };
}

/**
 * État des visites d'une ligne de site (colonnes du SELECT RBM) : dernière visite
 * effective + sa source, et visites prévues — une seule règle pour la page RBM,
 * la génération du plan du mois et le Plan de suivi.
 */
function visitState(row = {}, targetMonth) {
  const last = lastVisitOf(row);
  return { lastVisitMonth: last.month, lastVisitSource: last.source, ...plannedVisits(row.plannedMonths, targetMonth, last.month) };
}

/**
 * « À planifier » pour `targetMonth` (bouton « Générer depuis le RBM ») : site à suivre (`due`),
 * hors zone interdite (`forbidden` : suivi à distance uniquement, jamais de visite planifiée) et
 * sans visite déjà prévue ce mois (`nextPlannedMonth` = le mois cible), sans visite ANNULÉE ce
 * mois (`cancelledThisMonth` : décision de l'utilisateur) et actif ce mois (`inactiveThisMonth`).
 * Une visite RÉALISÉE ce mois rend déjà le site « à jour ».
 */
function needsPlanning({ due, forbidden, nextPlannedMonth, cancelledThisMonth, inactiveThisMonth } = {}, targetMonth) {
  const target = toMonth(targetMonth);
  // Une visite ANNULÉE ce mois est une décision de l'utilisateur : jamais replanifiée d'office.
  // Un site « Inactive » ce mois (grille d'activation) n'est pas planifiable ce mois-là.
  return Boolean(target && due && !forbidden && !cancelledThisMonth && !inactiveThisMonth
    && toMonth(nextPlannedMonth) !== target);
}

/**
 * Compteurs de la génération du mois, une seule définition pour l'écran et « Générer » :
 * `due` = sites à suivre hors zones interdites ; parmi eux `toPlan` (à planifier),
 * `cancelled` (visite annulée ce mois, laissée telle quelle) et `inactive` (inactifs ce mois).
 */
function planningCounts(rows, targetMonth) {
  let due = 0; let toPlan = 0; let cancelled = 0; let inactive = 0;
  for (const r of rows || []) {
    if (!r.due || r.forbidden) continue;
    due += 1;
    if (r.cancelledThisMonth) cancelled += 1;
    else if (r.inactiveThisMonth) inactive += 1;
    if (needsPlanning(r, targetMonth)) toPlan += 1;
  }
  return { due, toPlan, cancelled, inactive };
}

module.exports = {
  RISK_LEVELS, DEFAULT_FREQUENCY, frequencyFor, monthsBetween, isDue,
  toMonth, addMonths, currentMonth, lastVisitOf, isLatePlanned, plannedVisits, visitState,
  needsPlanning, planningCounts,
};
