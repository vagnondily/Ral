const { Router } = require('express');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const controller = require('./tpm.controller');

const router = Router();

// Every route in this module requires a valid session; tenantId always
// comes from req.auth (see middleware/auth.js), never from the request.
router.use(requireAuth);

router.get('/providers', asyncHandler(controller.listProviders));

router.get('/agents-evaluation', asyncHandler(controller.listAgentsEvaluation));

router.get('/sites', asyncHandler(controller.listSites));

router.get('/plans', asyncHandler(controller.getMonthlyPlan)); // ?month=2026-11
router.post('/plans/:planId/advance', requireRole('admin', 'manager'), asyncHandler(controller.advancePlanStatus));

router.put(
  '/plans/:planId/assignments',
  requireRole('admin', 'manager'),
  asyncHandler(controller.upsertAssignment)
);
router.get('/plans/:planId/mission-days', asyncHandler(controller.listMissionDays));
router.get('/plans/:planId/expenses', asyncHandler(controller.listExpenses));

router.post(
  '/assignments/:assignmentId/mission-days',
  requireRole('admin', 'manager'),
  asyncHandler(controller.toggleMissionDay)
);

module.exports = router;
