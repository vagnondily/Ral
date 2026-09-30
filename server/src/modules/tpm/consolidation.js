/**
 * Suivi budgétaire consolidé — pure business rules (no I/O, unit-tested).
 *
 * Faithful reproduction of the workbook "Suivi_Budget_TPM_BT.xlsx"
 * (feuilles Overview / Recap / Analysis). It is the INTERLIAISON layer of
 * MEMS 2.0: for every monitoring contract it brings together, per partner
 * (TPM) and per month, the three numbers that live in three different
 * modules and must always be read side by side:
 *
 *   • Budget    → ligne « Suivi » (IV.suivi) du contrat            [Contrats]
 *   • Planifié  → montants prévus des rapports mensuels            [Affectation / Rapports]
 *   • Réalisé   → montants justifiés des rapports financiers       [Rapports & dépenses]
 *
 * From those it derives the variance / burn-rate / remaining columns of the
 * Overview sheet (taux de consommation, écart plan vs réel, mois restants,
 * consommation restante estimée, budget restant estimé).
 *
 * All money is handled in integer cents to avoid float drift, exactly like
 * contracts.domain.js.
 */

function toCents(v) {
  return Math.round(Number(v || 0) * 100);
}
function round2(cents) {
  return Math.round(cents) / 100;
}

/** 'YYYY-MM' → absolute month index (year*12 + monthIndex). */
function monthIndex(month) {
  const [y, m] = String(month).slice(0, 7).split('-').map(Number);
  return y * 12 + (m - 1);
}

/** Ordered list of 'YYYY-MM' from start to end inclusive (bounded for safety). */
function monthRange(startMonth, endMonth, cap = 60) {
  const start = monthIndex(startMonth);
  const end = monthIndex(endMonth);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const out = [];
  for (let i = start; i <= end && out.length < cap; i += 1) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Whole months of a contract still to run, counting the current month in.
 * today before the start → the full period; today after the end → 0.
 */
function monthsRemaining(dateFin, periodMonths, today) {
  if (!dateFin) return 0;
  const end = monthIndex(dateFin);
  const now = monthIndex(today);
  const total = Number(periodMonths) || 0;
  const left = end - now + 1;
  if (left <= 0) return 0;
  return total > 0 ? Math.min(total, left) : left;
}

/** Safe ratio a/b (0 when b is 0). */
function ratio(aCents, bCents) {
  return bCents > 0 ? aCents / bCents : 0;
}

/**
 * Build the consolidated view.
 *
 * @param {object[]} contracts  {id, numero, partnerId, partnerName, dateDebut,
 *                               dateFin, periodMonths, monitoringBudget}
 * @param {object[]} monthly    {contractId, month:'YYYY-MM', planned, actual}
 * @param {object}   opts       {today:'YYYY-MM'}
 */
function buildConsolidation(contracts, monthly, { today } = {}) {
  const now = today || new Date().toISOString().slice(0, 7);

  // Index the monthly aggregates by contract.
  const byContract = new Map();
  for (const m of monthly || []) {
    if (!byContract.has(m.contractId)) byContract.set(m.contractId, []);
    byContract.get(m.contractId).push({ month: String(m.month).slice(0, 7), planned: m.planned, actual: m.actual });
  }

  // Month columns = union of every contract's own period.
  let minStart = null;
  let maxEnd = null;
  for (const c of contracts || []) {
    if (c.dateDebut) minStart = minStart == null ? c.dateDebut : (c.dateDebut < minStart ? c.dateDebut : minStart);
    if (c.dateFin) maxEnd = maxEnd == null ? c.dateFin : (c.dateFin > maxEnd ? c.dateFin : maxEnd);
  }
  const months = minStart && maxEnd ? monthRange(minStart, maxEnd) : [];

  const monthlyTotals = Object.fromEntries(months.map((mm) => [mm, { planned: 0, actual: 0 }]));

  const rows = (contracts || []).map((c) => {
    const budgetCents = toCents(c.monitoringBudget);
    const cells = byContract.get(c.id) || [];
    const perMonth = {};
    let plannedCents = 0;
    let actualCents = 0;
    for (const cell of cells) {
      const p = toCents(cell.planned);
      const a = toCents(cell.actual);
      plannedCents += p;
      actualCents += a;
      perMonth[cell.month] = { planned: round2(p), actual: round2(a), ecart: round2(a - p) };
      if (monthlyTotals[cell.month]) {
        monthlyTotals[cell.month].planned += p;
        monthlyTotals[cell.month].actual += a;
      }
    }

    const left = monthsRemaining(c.dateFin, c.periodMonths, now);
    const period = Number(c.periodMonths) || 0;
    const elapsed = Math.max(1, period > 0 ? period - left : cells.length || 1);
    const avgBurnCents = Math.round(actualCents / elapsed);
    const projectedRemainingCents = avgBurnCents * left;

    return {
      contractId: c.id,
      numero: c.numero,
      partnerId: c.partnerId,
      partnerName: c.partnerName,
      dateDebut: c.dateDebut,
      dateFin: c.dateFin,
      periodMonths: period,
      budget: round2(budgetCents),
      planned: round2(plannedCents),
      actual: round2(actualCents),
      plannedRate: ratio(plannedCents, budgetCents),
      actualRate: ratio(actualCents, budgetCents),
      planVsActual: ratio(actualCents, plannedCents),
      remaining: round2(budgetCents - actualCents),
      overspent: actualCents > budgetCents,
      monthsRemaining: left,
      avgMonthlyBurn: round2(avgBurnCents),
      projectedRemaining: round2(projectedRemainingCents),
      projectedTotal: round2(actualCents + projectedRemainingCents),
      projectedOverrun: round2(actualCents + projectedRemainingCents - budgetCents),
      monthly: perMonth,
    };
  });

  // Grand Total row (recompute the rates on the summed cents).
  const sum = rows.reduce(
    (t, r) => {
      t.budget += toCents(r.budget);
      t.planned += toCents(r.planned);
      t.actual += toCents(r.actual);
      return t;
    },
    { budget: 0, planned: 0, actual: 0 }
  );

  const totals = {
    budget: round2(sum.budget),
    planned: round2(sum.planned),
    actual: round2(sum.actual),
    plannedRate: ratio(sum.planned, sum.budget),
    actualRate: ratio(sum.actual, sum.budget),
    planVsActual: ratio(sum.actual, sum.planned),
    remaining: round2(sum.budget - sum.actual),
    overspent: sum.actual > sum.budget,
    contracts: rows.length,
  };

  const monthlyTotalsOut = months.map((mm) => ({
    month: mm,
    planned: round2(monthlyTotals[mm].planned),
    actual: round2(monthlyTotals[mm].actual),
    ecart: round2(monthlyTotals[mm].actual - monthlyTotals[mm].planned),
  }));

  return { rows, totals, months, monthlyTotals: monthlyTotalsOut, today: now };
}

module.exports = { buildConsolidation, monthRange, monthsRemaining, monthIndex };
