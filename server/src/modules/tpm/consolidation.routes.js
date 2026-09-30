const { Router } = require('express');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const repo = require('./consolidation.repository');

/**
 * Suivi budgétaire consolidé (Dashboard décisionnel).
 * Read-only: any authenticated user of the tenant may view it.
 */
const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const today = /^\d{4}-\d{2}/.test(req.query.today || '') ? req.query.today.slice(0, 7) : undefined;
    res.json(await repo.consolidation(req.auth.tenantId, { today }));
  })
);

module.exports = router;
