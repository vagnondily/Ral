const logger = require('../../config/logger');
const tpmRepository = require('../../modules/tpm/tpm.repository');

/**
 * BullMQ job processor: recomputes tpm_expenses for one plan from its
 * mission-day calendar. Idempotent (safe to run twice for the same plan —
 * recomputeExpenses always derives the full total from the current mission
 * days, it never increments), so retries after a crash are harmless.
 */
async function recalcExpensesProcessor(job) {
  const { tenantId, planId } = job.data;
  const start = Date.now();
  const providersUpdated = await tpmRepository.recomputeExpenses(tenantId, planId);
  logger.info(
    { tenantId, planId, providersUpdated, durationMs: Date.now() - start },
    'tpm-expense-recalc: recomputed'
  );
  return { providersUpdated };
}

module.exports = recalcExpensesProcessor;
