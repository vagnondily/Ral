const { Router } = require('express');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const repo = require('./deletions.repository');
const { DOCUMENT_TYPES } = require('../common/deletionPolicy');

const router = Router();
router.use(requireAuth);
const t = (req) => req.auth.tenantId;

// Journal des suppressions (retour 56) — lecture seule, réservé à l'admin.
// Filtres : docType (un type de document), limit (≤ 500), offset.
router.get('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const docType = DOCUMENT_TYPES.includes(req.query.docType) ? req.query.docType : null;
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;
  res.json(await repo.listDeletions(t(req), { docType, limit, offset }));
}));

module.exports = router;
