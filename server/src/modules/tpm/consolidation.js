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
/** Ratio of the period columns: null (« — ») when the base is 0, never 0 %. */
function ratioOrNull(aCents, bCents) {
  return bCents > 0 ? aCents / bCents : null;
}

/**
 * Part mensuelle d'un budget, en CENTIMES entiers (lot 1b) : `base = floor(total / n)`,
 * le reste (total − base·n) réparti d'un centime sur les PREMIERS mois — la somme des
 * parts vaut exactement le budget (1 000,00 sur 3 mois → 333,34 + 333,33 + 333,33).
 * @returns {number[]} n parts en centimes (vide si n ≤ 0)
 */
function monthlyBudgetCents(totalCents, contractMonths) {
  const n = Math.floor(Number(contractMonths) || 0);
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => monthShareCents(totalCents, n, i));
}
/** Part du mois d'indice i (0 … n−1) — la règle de monthlyBudgetCents, sans matérialiser les n parts. */
function monthShareCents(totalCents, n, i) {
  const total = Math.round(Number(totalCents) || 0);
  const base = Math.floor(total / n);
  return base + (i < total - base * n ? 1 : 0);
}

/**
 * Budget d'un contrat sur une période, en centimes : somme des parts mensuelles
 * (monthlyBudgetCents) des mois COMMUNS au contrat et à la période. Les mois du
 * contrat partent du mois de début, au nombre de `periodMonths` (la base du barème
 * mensuel du contrat), sinon des mois entre début et fin, mois partiels compris
 * (contracts.domain.monthsBetween) — sans plafond ; seule l'intersection est
 * matérialisée. Sans date de début : null (« période du contrat inconnue »).
 */
function periodBudgetCents({ dateDebut, dateFin, periodMonths }, budgetCents, period) {
  if (!dateDebut) return null;
  const start = monthIndex(dateDebut);
  const n = Number(periodMonths) > 0 ? Number(periodMonths)
    : (dateFin ? monthIndex(dateFin) - start + 1 : 0);
  if (!(n > 0)) return null;
  const lo = Math.max(start, monthIndex(period.from));
  const hi = Math.min(start + n - 1, monthIndex(period.to));
  if (hi < lo) return 0;
  // Parts des mois communs seulement (indices lo − start … hi − start), sans matérialiser tout le contrat.
  let sum = 0;
  for (let i = lo - start; i <= hi - start; i += 1) sum += monthShareCents(budgetCents, n, i);
  return sum;
}

/**
 * Build the consolidated view.
 *
 * @param {object[]} contracts  {id, numero, partnerId, partnerName, dateDebut,
 *                               dateFin, periodMonths, monitoringBudget}
 * @param {object[]} monthly    {contractId, month:'YYYY-MM', planned, actual, pending?}
 * @param {object}   opts       {today:'YYYY-MM', period?:{from,to}}
 *
 * Sans `period` : sortie inchangée (cumul du contrat, colonnes = union des durées
 * des contrats). Avec `period` (lot 1b) : le cumul « à date » reste, et s'y ajoutent
 *  - `months` = mois de la période, `monthlyTotals` limité à ces mois ;
 *  - `row.period` = { months, budget, budgetKnown, planned, actual, pending, plannedRate,
 *    actualRate, planVsActual } : budget de la période (parts mensuelles en centimes,
 *    mois communs), planifié / réalisé / en attente = sommes des mois de la période,
 *    taux à null quand la base est nulle (plage hors contrat → budget 0, taux null) ;
 *  - `totals.period`, taux recalculés sur les sommes en centimes ; `period` en écho.
 */
function buildConsolidation(contracts, monthly, { today, period = null } = {}) {
  const now = today || new Date().toISOString().slice(0, 7);
  const inPeriod = (m) => !period || (m >= period.from && m <= period.to);

  // Index the monthly aggregates by contract.
  const byContract = new Map();
  for (const m of monthly || []) {
    if (!byContract.has(m.contractId)) byContract.set(m.contractId, []);
    byContract.get(m.contractId).push({ month: String(m.month).slice(0, 7), planned: m.planned, actual: m.actual, pending: m.pending });
  }

  // Month columns = union of every contract's own period.
  let minStart = null;
  let maxEnd = null;
  for (const c of contracts || []) {
    if (c.dateDebut) minStart = minStart == null ? c.dateDebut : (c.dateDebut < minStart ? c.dateDebut : minStart);
    if (c.dateFin) maxEnd = maxEnd == null ? c.dateFin : (c.dateFin > maxEnd ? c.dateFin : maxEnd);
  }
  const months = period
    ? monthRange(period.from, period.to)
    : (minStart && maxEnd ? monthRange(minStart, maxEnd) : []);

  const monthlyTotals = Object.fromEntries(months.map((mm) => [mm, { planned: 0, actual: 0 }]));
  const periodSums = { budget: 0, planned: 0, actual: 0, pending: 0, unknown: 0 }; // période, en centimes

  const rows = (contracts || []).map((c) => {
    const budgetCents = toCents(c.monitoringBudget);
    const cells = byContract.get(c.id) || [];
    const perMonth = {};
    let plannedCents = 0;
    let actualCents = 0;
    const per = { planned: 0, actual: 0, pending: 0 }; // période (centimes)
    for (const cell of cells) {
      const p = toCents(cell.planned);
      const a = toCents(cell.actual);
      plannedCents += p;
      actualCents += a;
      if (period && inPeriod(cell.month)) {
        per.planned += p;
        per.actual += a;
        per.pending += toCents(cell.pending);
      }
      perMonth[cell.month] = { planned: round2(p), actual: round2(a), ecart: round2(a - p) };
      if (monthlyTotals[cell.month]) {
        monthlyTotals[cell.month].planned += p;
        monthlyTotals[cell.month].actual += a;
      }
    }

    const left = monthsRemaining(c.dateFin, c.periodMonths, now);
    const nMonths = Number(c.periodMonths) || 0;
    const elapsed = Math.max(1, nMonths > 0 ? nMonths - left : cells.length || 1);
    const avgBurnCents = Math.round(actualCents / elapsed);
    const projectedRemainingCents = avgBurnCents * left;

    const row = {
      contractId: c.id,
      numero: c.numero,
      partnerId: c.partnerId,
      partnerName: c.partnerName,
      dateDebut: c.dateDebut,
      dateFin: c.dateFin,
      periodMonths: nMonths,
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
    if (period) {
      const budget = periodBudgetCents(c, budgetCents, period);
      row.period = {
        months: months.length,
        budget: budget == null ? null : round2(budget),
        budgetKnown: budget != null,
        planned: round2(per.planned),
        actual: round2(per.actual),
        pending: round2(per.pending),
        plannedRate: ratioOrNull(per.planned, budget || 0),
        actualRate: ratioOrNull(per.actual, budget || 0),
        planVsActual: ratioOrNull(per.actual, per.planned),
      };
      if (budget == null) periodSums.unknown += 1; else periodSums.budget += budget;
      periodSums.planned += per.planned;
      periodSums.actual += per.actual;
      periodSums.pending += per.pending;
    }
    return row;
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
  if (period) {
    const ps = periodSums;
    totals.period = {
      months: months.length,
      budget: round2(ps.budget),
      budgetUnknown: ps.unknown,
      planned: round2(ps.planned),
      actual: round2(ps.actual),
      pending: round2(ps.pending),
      plannedRate: ratioOrNull(ps.planned, ps.budget),
      actualRate: ratioOrNull(ps.actual, ps.budget),
      planVsActual: ratioOrNull(ps.actual, ps.planned),
    };
  }

  const monthlyTotalsOut = months.map((mm) => ({
    month: mm,
    planned: round2(monthlyTotals[mm].planned),
    actual: round2(monthlyTotals[mm].actual),
    ecart: round2(monthlyTotals[mm].actual - monthlyTotals[mm].planned),
  }));

  const out = { rows, totals, months, monthlyTotals: monthlyTotalsOut, today: now };
  if (period) out.period = { from: period.from, to: period.to, months: months.length };
  return out;
}

module.exports = { buildConsolidation, monthRange, monthsRemaining, monthIndex, monthlyBudgetCents, periodBudgetCents };
