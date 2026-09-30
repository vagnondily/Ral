const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const repo = require('./planning.repository');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const itemSchema = z.object({
  lineCode: z.string().min(2).max(40),
  designation: z.string().trim().min(2).max(200),
  unit: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)),
  unitCount: z.number().nonnegative().max(1e9),
  unitCost: z.number().nonnegative().max(1e13),
  payBy: z.enum(['bailleur', 'ong']).optional(),
  site: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  observation: z.string().trim().max(400).optional().or(z.literal('').transform(() => undefined)),
});

const isPgText = (msg) => /Ligne budgétaire|désignation|invalide/.test(msg);

router.get('/', asyncHandler(async (req, res) =>
  res.json(await repo.listPlans(t(req), { month: req.query.month, contractId: req.query.contractId }))));

// Items of the plan matching a contract + month — used to pre-fill a facture.
router.get('/prefill', asyncHandler(async (req, res) => {
  const { contractId, month } = req.query;
  if (!contractId || !/^\d{4}-\d{2}/.test(month || '')) throw badRequest('contractId et month requis.');
  res.json(await repo.planItemsFor(t(req), { contractId, periodMonth: month }));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const plan = await repo.getPlan(t(req), req.params.id);
  if (!plan) throw notFound('Plan introuvable');
  res.json(plan);
}));

const createSchema = z.object({
  partnerId: z.string().uuid(),
  contractId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  title: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
  items: z.array(itemSchema).max(1000).optional(),
});

router.post('/', WRITE, body(createSchema), asyncHandler(async (req, res) => {
  const input = { ...req.valid, periodMonth: `${req.valid.periodMonth.slice(0, 7)}-01`, createdBy: req.auth.userId };
  try {
    const id = await repo.createPlan(t(req), input);
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === 'DUP') throw conflict('Un plan existe déjà pour ce prestataire, ce contrat et ce mois.');
    if (err instanceof Error && isPgText(err.message)) throw badRequest(err.message);
    throw err;
  }
}));

const updateSchema = z.object({
  items: z.array(itemSchema).max(1000).optional(),
  title: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(['brouillon', 'valide']).optional(),
});

router.put('/:id', WRITE, body(updateSchema), asyncHandler(async (req, res) => {
  try {
    const id = await repo.updatePlan(t(req), req.params.id, req.valid);
    if (!id) throw notFound('Plan introuvable');
    res.status(204).end();
  } catch (err) {
    if (err instanceof Error && isPgText(err.message)) throw badRequest(err.message);
    throw err;
  }
}));

router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deletePlan(t(req), req.params.id))) throw notFound('Plan introuvable');
  res.status(204).end();
}));

module.exports = router;
