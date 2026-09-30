const service = require('./tpm.service');
const {
  upsertAssignmentSchema,
  toggleMissionDaySchema,
  monthQuerySchema,
} = require('./tpm.validation');
const { badRequest } = require('../../middleware/errors');

function parseOr400(schema, data, next) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    next(badRequest('Données invalides', parsed.error.flatten()));
    return null;
  }
  return parsed.data;
}

async function listProviders(req, res) {
  res.json(await service.listProviders(req.auth.tenantId));
}

async function listSites(req, res) {
  res.json(await service.listSites(req.auth.tenantId));
}

async function listAgentsEvaluation(req, res) {
  res.json(await service.listAgentsEvaluation(req.auth.tenantId));
}

async function getMonthlyPlan(req, res, next) {
  const query = parseOr400(monthQuerySchema, req.query, next);
  if (!query) return;
  res.json(await service.getMonthlyPlan(req.auth.tenantId, query.month));
}

async function upsertAssignment(req, res, next) {
  const input = parseOr400(upsertAssignmentSchema, req.body, next);
  if (!input) return;
  res.json(await service.upsertAssignment(req.auth.tenantId, req.params.planId, input));
}

async function toggleMissionDay(req, res, next) {
  const input = parseOr400(toggleMissionDaySchema, req.body, next);
  if (!input) return;
  res.json(await service.toggleMissionDay(req.auth.tenantId, req.params.assignmentId, input.date));
}

async function listMissionDays(req, res) {
  res.json(await service.listMissionDays(req.auth.tenantId, req.params.planId));
}

async function listExpenses(req, res) {
  res.json(await service.listExpenses(req.auth.tenantId, req.params.planId));
}

async function advancePlanStatus(req, res) {
  res.json(await service.advancePlanStatus(req.auth.tenantId, req.params.planId));
}

module.exports = {
  listProviders,
  listAgentsEvaluation,
  listSites,
  getMonthlyPlan,
  upsertAssignment,
  toggleMissionDay,
  listMissionDays,
  listExpenses,
  advancePlanStatus,
};
