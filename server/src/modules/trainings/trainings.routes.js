const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { readPeriod } = require('../../middleware/period');
const { PERIOD_CAPS } = require('../common/periodCaps');
const service = require('./trainings.service');
const { isoDateSchema } = require('../common/isoDate');

/**
 * Formations en sessions (lot 8, retour 28.2) — /api/trainings. Lecture pour tout compte
 * authentifié ; écriture pour l'administrateur et le gestionnaire. Le tenant vient UNIQUEMENT
 * de req.auth.
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;

const uuid = z.string().uuid();
function ids(...names) {
  return (req, res, next) => {
    for (const n of names) if (!uuid.safeParse(req.params[n]).success) return next(badRequest('Identifiant invalide'));
    return next();
  };
}
function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const isoDate = isoDateSchema(z);
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
// 200 caractères : comme la base (training_themes, migration 087) et l'ancienne saisie par agent.
const THEME_MAX = 200;
const themes = z.array(z.string().trim().min(2).max(THEME_MAX)).max(30);
const status = z.enum(['planifiee', 'realisee', 'annulee']);
const sessionFields = {
  objective: optText(2000), place: optText(200), trainer: optText(200), organiserId: uuid.nullable().optional(),
  status: status.optional(), scoreMax: z.number().positive().max(1000).optional(), passMark: z.number().min(0).max(100).optional(),
  themes: themes.optional(),
};
const createSchema = z.object({
  title: z.string().trim().min(2).max(200), startDate: isoDate, endDate: isoDate, ...sessionFields,
  agentIds: z.array(uuid).max(500).optional(), providerId: uuid.optional(),
}).strict();
const patchSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(), startDate: isoDate.optional(), endDate: isoDate.optional(),
  feedbackSummary: optText(4000), ...sessionFields,
}).strict();
const addSchema = z.object({ agentIds: z.array(uuid).max(500).optional(), providerId: uuid.optional() }).strict()
  .refine((v) => (v.agentIds && v.agentIds.length) || v.providerId, { message: 'Choisissez des agents ou un TPM.' });
const score = z.number().min(0).max(1000).nullable().optional();
const participantsSchema = z.object({
  rows: z.array(z.object({
    agentId: uuid, attendance: z.enum(['present', 'partiel', 'absent']).nullable().optional(),
    daysPresent: z.number().min(0).max(366).nullable().optional(), preScore: score, postScore: score,
    satisfaction: z.number().int().min(1).max(5).nullable().optional(), feedback: optText(1000),
  }).strict()).max(500),
}).strict();

router.get('/', asyncHandler(async (req, res) => {
  const f = z.object({ providerId: uuid.optional(), themeId: uuid.optional(), status: status.optional() }).safeParse({
    providerId: req.query.providerId || undefined, themeId: req.query.themeId || undefined, status: req.query.status || undefined,
  });
  if (!f.success) throw badRequest('Filtre invalide.');
  res.json(await service.list(t(req), { ...f.data, period: readPeriod(req.query, { maxSpan: PERIOD_CAPS.document }) }));
}));
router.get('/themes', asyncHandler(async (req, res) => res.json(await service.themes(t(req)))));
// Chiffres clés agrégés en SQL sur TOUTES les sessions filtrées (la liste est bornée : `limit`).
router.get('/summary', asyncHandler(async (req, res) => {
  const f = z.object({ providerId: uuid.optional(), themeId: uuid.optional(), status: status.optional() }).safeParse({
    providerId: req.query.providerId || undefined, themeId: req.query.themeId || undefined, status: req.query.status || undefined,
  });
  if (!f.success) throw badRequest('Filtre invalide.');
  res.json(await service.summary(t(req), { ...f.data, period: readPeriod(req.query, { maxSpan: PERIOD_CAPS.document }) }));
}));
router.get('/by-provider/:providerId', ids('providerId'), asyncHandler(async (req, res) => {
  res.json(await service.byProvider(t(req), req.params.providerId));
}));
router.get('/:id', ids('id'), asyncHandler(async (req, res) => res.json(await service.get(t(req), req.params.id))));
router.post('/', WRITE, body(createSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.create(t(req), req.valid, req.auth.userId));
}));
router.patch('/:id', WRITE, ids('id'), body(patchSchema), asyncHandler(async (req, res) => {
  res.json(await service.update(t(req), req.params.id, req.valid));
}));
router.delete('/:id', WRITE, ids('id'), asyncHandler(async (req, res) => {
  await service.remove(t(req), req.params.id);
  res.status(204).end();
}));
router.post('/:id/participants', WRITE, ids('id'), body(addSchema), asyncHandler(async (req, res) => {
  res.json(await service.addParticipants(t(req), req.params.id, req.valid));
}));
router.patch('/:id/participants', WRITE, ids('id'), body(participantsSchema), asyncHandler(async (req, res) => {
  res.json(await service.updateParticipants(t(req), req.params.id, req.valid.rows));
}));
router.delete('/:id/participants/:agentId', WRITE, ids('id', 'agentId'), asyncHandler(async (req, res) => {
  await service.removeParticipant(t(req), req.params.id, req.params.agentId);
  res.status(204).end();
}));

module.exports = router;
