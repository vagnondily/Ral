/**
 * Prévision de dépense d'un contrat — logique pure (sans I/O), testée.
 *
 * À partir du réalisé mensuel (part bailleur des factures validées sur la ligne
 * Suivi/TPM) jusqu'au mois courant, on projette la dépense mois par mois jusqu'à
 * la fin du contrat (ou jusqu'à un mois cible donné) au rythme moyen observé
 * (burn rate = réalisé cumulé ÷ mois écoulés). Montants en cents pour éviter la
 * dérive flottante, comme contracts.domain.js / consolidation.js.
 */

function toCents(v) { return Math.round(Number(v || 0) * 100); }
function round2(cents) { return Math.round(cents) / 100; }
function monthIndex(month) {
  const [y, m] = String(month).slice(0, 7).split('-').map(Number);
  return y * 12 + (m - 1);
}
function monthLabel(i) { return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; }
function monthRange(startMonth, endMonth, cap = 120) {
  const start = monthIndex(startMonth); const end = monthIndex(endMonth);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const out = [];
  for (let i = start; i <= end && out.length < cap; i += 1) out.push(monthLabel(i));
  return out;
}

/**
 * @param {object} p
 * @param {number} p.budget         budget Suivi/TPM du contrat (ligne IV)
 * @param {object[]} p.monthlyActual [{month:'YYYY-MM', actual}]
 * @param {string} p.dateDebut      'YYYY-MM(-DD)'
 * @param {string} p.dateFin        'YYYY-MM(-DD)'
 * @param {string} p.asOf           mois courant 'YYYY-MM'
 * @param {string} [p.until]        mois cible 'YYYY-MM' (défaut : fin du contrat)
 */
function buildForecast({ budget, monthlyActual, dateDebut, dateFin, asOf, until } = {}) {
  const now = (asOf || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const start = (dateDebut || now).slice(0, 7);
  const contractEnd = (dateFin || now).slice(0, 7);
  // La cible ne dépasse pas la fin du contrat, et n'est jamais avant le mois courant.
  let target = (until || contractEnd).slice(0, 7);
  if (monthIndex(target) > monthIndex(contractEnd)) target = contractEnd;
  if (monthIndex(target) < monthIndex(now)) target = now;

  const budgetCents = toCents(budget);
  const actualByMonth = new Map();
  for (const m of monthlyActual || []) actualByMonth.set(String(m.month).slice(0, 7), toCents(m.actual));

  // Réalisé cumulé et mois écoulés jusqu'au mois courant inclus.
  let realizedToDate = 0;
  let elapsed = 0;
  const startIdx = monthIndex(start);
  const nowIdx = monthIndex(now);
  for (let i = startIdx; i <= nowIdx; i += 1) {
    elapsed += 1;
    realizedToDate += actualByMonth.get(monthLabel(i)) || 0;
  }
  elapsed = Math.max(1, elapsed);
  const avgBurnCents = Math.round(realizedToDate / elapsed);

  const months = monthRange(start, target);
  let cumulative = 0;
  const series = months.map((mm) => {
    const idx = monthIndex(mm);
    const isFuture = idx > nowIdx;
    const actualCents = actualByMonth.get(mm) || 0;
    const monthCents = isFuture ? avgBurnCents : actualCents;
    cumulative += monthCents;
    return {
      month: mm,
      isFuture,
      amount: round2(monthCents),
      cumulative: round2(cumulative),
      remaining: round2(budgetCents - cumulative),
    };
  });

  const projectedTotalCents = cumulative;
  return {
    budget: round2(budgetCents),
    realizedToDate: round2(realizedToDate),
    avgMonthlyBurn: round2(avgBurnCents),
    elapsedMonths: elapsed,
    asOf: now,
    until: target,
    projectedTotal: round2(projectedTotalCents),
    projectedRemaining: round2(budgetCents - projectedTotalCents),
    projectedOverrun: round2(projectedTotalCents - budgetCents),
    willOverspend: projectedTotalCents > budgetCents,
    series,
  };
}

module.exports = { buildForecast, monthRange, monthIndex };
