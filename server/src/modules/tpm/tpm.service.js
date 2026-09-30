const repo = require('./tpm.repository');
const { enqueueRecalculation } = require('../../jobs/queue');
const { badRequest, notFound } = require('../../middleware/errors');

/**
 * Business rules for the Partenaires & TPM module. Controllers call only
 * this layer — never the repository directly — so validation and workflow
 * rules live in exactly one place.
 */

const PLAN_TRANSITIONS = {
  draft: 'submitted',
  submitted: 'validated',
};

function normalizeMonth(month) {
  // Accepts "2026-11" or "2026-11-05"; plans are keyed on the 1st of month.
  return `${month.slice(0, 7)}-01`;
}

async function listAgentsEvaluation(tenantId) {
  return repo.listAgentsEvaluation(tenantId);
}

async function listProviders(tenantId) {
  return repo.listProviders(tenantId);
}

/** Returns (creating if needed) the plan for a month, with every site
 * pre-populated as an (initially unassigned) assignment row. */
async function getMonthlyPlan(tenantId, month) {
  const periodMonth = normalizeMonth(month);
  const plan = await repo.getOrCreatePlan(tenantId, periodMonth);
  await repo.ensureAssignmentsForAllSites(tenantId, plan.id);
  const [assignments, expenses] = await Promise.all([
    repo.listAssignments(tenantId, plan.id),
    repo.listExpenses(tenantId, plan.id),
  ]);
  return { plan, assignments, expenses };
}

async function upsertAssignment(tenantId, planId, input) {
  const plan = await repo.getPlan(tenantId, planId);
  if (!plan) throw notFound('Plan introuvable');
  if (plan.status !== 'draft') {
    throw badRequest('Le plan est déjà soumis ; les affectations ne sont plus modifiables.');
  }
  const result = await repo.upsertAssignment(tenantId, planId, input);
  // Changing a site's provider moves its mission days (and their cost) to
  // another provider's budget line, so the totals must be recomputed too.
  await enqueueRecalculation(tenantId, planId);
  return result;
}

async function toggleMissionDay(tenantId, assignmentId, date) {
  const assignment = await repo.getAssignment(tenantId, assignmentId);
  if (!assignment) throw notFound('Affectation introuvable');
  const plan = await repo.getPlan(tenantId, assignment.planId);
  if (plan.status === 'validated') {
    throw badRequest('Le plan est validé ; le calendrier ne peut plus être modifié.');
  }
  if (!assignment.tpmProviderId) {
    throw badRequest("Choisissez d'abord un prestataire TPM (puis un agent) avant de planifier une mission.");
  }
  const result = await repo.toggleMissionDay(tenantId, assignmentId, date);
  // Fire-and-forget into the background queue: the API responds immediately
  // with the toggle result, and the (potentially expensive, tenant-wide)
  // expense recalculation happens asynchronously in the worker process.
  await enqueueRecalculation(tenantId, plan.id);
  return result;
}

async function advancePlanStatus(tenantId, planId) {
  const plan = await repo.getPlan(tenantId, planId);
  if (!plan) throw notFound('Plan introuvable');
  const next = PLAN_TRANSITIONS[plan.status];
  if (!next) {
    throw badRequest(`Le plan est déjà au statut final "${plan.status}".`);
  }
  const timestampColumn = next === 'submitted' ? 'submitted_at' : 'validated_at';
  return repo.updatePlanStatus(tenantId, planId, next, timestampColumn);
}

async function listSites(tenantId) {
  return repo.listSites(tenantId);
}

async function listMissionDays(tenantId, planId) {
  return repo.listMissionDaysForPlan(tenantId, planId);
}

/** Read-only: lets the UI poll for the worker's result without the side
 * effects of getMonthlyPlan (plan upsert + assignment backfill). */
async function listExpenses(tenantId, planId) {
  const plan = await repo.getPlan(tenantId, planId);
  if (!plan) throw notFound('Plan introuvable');
  return repo.listExpenses(tenantId, planId);
}

module.exports = {
  listProviders,
  listAgentsEvaluation,
  listSites,
  getMonthlyPlan,
  upsertAssignment,
  toggleMissionDay,
  advancePlanStatus,
  listMissionDays,
  listExpenses,
  normalizeMonth, // exported for unit testing only
  PLAN_TRANSITIONS, // exported for unit testing only
};
