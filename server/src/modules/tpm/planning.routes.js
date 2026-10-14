const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const { deletionRefusal } = require('../deletions/deletionRefusal');
const repo = require('./planning.repository');
const { readPeriod } = require('../../middleware/period');

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
  bailleurPct: z.number().min(0).max(1).optional(),
  activityId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  activity2Id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  activity1Pct: z.number().min(0).max(1).optional(),
  site: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  observation: z.string().trim().max(400).optional().or(z.literal('').transform(() => undefined)),
});

const isPgText = (msg) => /Ligne budgétaire|désignation|invalide|Activité inconnue/.test(msg);

// Mois réel (01-12) : un mois mal formé ne doit jamais atteindre PostgreSQL (500).
const monthS = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, 'Mois invalide (AAAA-MM).');
const listQuery = z.object({ contractId: z.string().uuid().optional() });

// Liste : ?from&to (ou l'ancien ?month) — plans dont le mois tombe dans la période ; sans période, tous.
router.get('/', asyncHandler(async (req, res) => {
  const period = readPeriod(req.query);
  const q = listQuery.safeParse({ contractId: req.query.contractId || undefined });
  if (!q.success) throw badRequest('Filtres invalides', q.error.flatten());
  res.json(await repo.listPlans(t(req), { period, contractId: q.data.contractId }));
}));

// Items of the plan matching a contract + month — used to pre-fill a facture.
const prefillQuery = z.object({ partnerId: z.string().uuid(), contractId: z.string().uuid(), month: monthS });
router.get('/prefill', asyncHandler(async (req, res) => {
  const q = prefillQuery.safeParse(req.query);
  if (!q.success) throw badRequest('partnerId, contractId et month (AAAA-MM) requis.', q.error.flatten());
  res.json(await repo.planItemsFor(t(req), { partnerId: q.data.partnerId, contractId: q.data.contractId, periodMonth: q.data.month }));
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

// Suppression (politique commune, retour 56) : plan non validé supprimable
// après confirmation ; plan validé seulement par un administrateur, avec
// justificatif, et sans facture remplie du même mois. Inscrite au journal.
router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  const justification = typeof req.body?.justification === 'string' ? req.body.justification : undefined;
  const outcome = await repo.deletePlan(t(req), req.params.id, {
    actorId: req.auth.userId, isAdmin: req.auth.role === 'admin', justification,
  });
  if (outcome === null) throw notFound('Plan introuvable');
  if (outcome !== 'ok') {
    throw deletionRefusal(outcome.reason, {
      subject: 'ce plan de collecte validé', linked: outcome.linked,
      hint: 'Supprimez d\'abord la facture du mois, ou gardez le plan.',
    });
  }
  res.status(204).end();
}));

module.exports = router;
