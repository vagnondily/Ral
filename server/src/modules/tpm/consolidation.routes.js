const { Router } = require('express');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const repo = require('./consolidation.repository');
const { readPeriod } = require('../../middleware/period');
const { isMonth } = require('../common/period');

/**
 * Suivi budgétaire consolidé (Dashboard décisionnel).
 * Read-only: any authenticated user of the tenant may view it.
 *
 * GET /?today=AAAA-MM[&from=AAAA-MM&to=AAAA-MM | &month=AAAA-MM]
 *   period facultative (60 mois au plus) : null = aucun bloc « période » (cumul seul,
 *   sortie inchangée) ; sinon `rows[].period`, `totals.period`, `months` = mois de la
 *   période et l'écho `period`. `today` (mois de référence du cumul) reste à part.
 */
const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.today === 'string' ? req.query.today.slice(0, 7) : '';
    const today = isMonth(raw) ? raw : undefined;
    const period = readPeriod(req.query);
    res.json(await repo.consolidation(req.auth.tenantId, { today, period }));
  })
);

module.exports = router;
