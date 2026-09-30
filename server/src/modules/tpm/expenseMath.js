/**
 * Pure calculation extracted out of tpm.repository.recomputeExpenses so it
 * can be unit-tested without a database. The repository still does the
 * actual per-provider aggregation via SQL (fine, since GROUP BY is exactly
 * what SQL is for) — this covers just the money math, which is the part
 * most worth guarding with a test as the pricing model evolves.
 */
function computeExpenseAmount(dailyRate, missionDaysCount) {
  const rate = Number(dailyRate);
  const days = Number(missionDaysCount);
  if (!Number.isFinite(rate) || rate < 0) throw new RangeError('dailyRate must be a non-negative number');
  if (!Number.isInteger(days) || days < 0) throw new RangeError('missionDaysCount must be a non-negative integer');
  // Rounded to 2 decimals to match the numeric(14,2) column — avoids
  // floating point remainders like 85000.00000000001 reaching Postgres.
  return Math.round(rate * days * 100) / 100;
}

module.exports = { computeExpenseAmount };
