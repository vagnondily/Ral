const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const repo = require('./reports.repository');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}
const t = (req) => req.auth.tenantId;

router.get('/context', asyncHandler(async (req, res) => res.json(await repo.reportContext(t(req)))));

router.get('/', asyncHandler(async (req, res) =>
  res.json(await repo.listReports(t(req), { month: req.query.month, partnerId: req.query.partnerId, contractId: req.query.contractId }))));

const createSchema = z.object({
  partnerId: z.string().uuid(),
  contractId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  kind: z.enum(['financier', 'technique']),
  reportedAmount: z.number().nonnegative().max(1e13).optional(),
  plannedAmount: z.number().nonnegative().max(1e13).optional(),
  reference: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  documentName: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
}).refine((r) => r.kind !== 'financier' || typeof r.reportedAmount === 'number', {
  message: 'Un rapport financier doit porter un montant justifié.', path: ['reportedAmount'],
});

router.post('/', WRITE, body(createSchema), asyncHandler(async (req, res) => {
  const input = { ...req.valid, periodMonth: `${req.valid.periodMonth.slice(0, 7)}-01`, createdBy: req.auth.userId };
  if (input.kind === 'technique') input.reportedAmount = null;
  try {
    const id = await repo.insertReport(t(req), input);
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === 'DUP') throw conflict('Un rapport de ce type existe déjà pour ce partenaire, ce contrat et ce mois.');
    throw err;
  }
}));

const decisionSchema = z.object({ comment: z.string().trim().max(1000).optional() });

router.post('/:id/approve', body(decisionSchema), asyncHandler(async (req, res) => {
  if (!(await repo.setStatus(t(req), req.params.id, 'valide', req.auth.userId, req.valid.comment))) throw notFound('Rapport introuvable');
  res.status(204).end();
}));

router.post('/:id/reject', body(decisionSchema), asyncHandler(async (req, res) => {
  if (!req.valid.comment) throw badRequest('Un motif est obligatoire pour rejeter.');
  if (!(await repo.setStatus(t(req), req.params.id, 'rejete', req.auth.userId, req.valid.comment))) throw notFound('Rapport introuvable');
  res.status(204).end();
}));

module.exports = router;
