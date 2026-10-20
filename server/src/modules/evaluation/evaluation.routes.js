const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const service = require('./evaluation.service');
const { isoDateSchema } = require('../common/isoDate');

/**
 * Évaluations (lot 8) — /api/evaluation. Lecture pour tout compte authentifié ; écriture
 * pour l'administrateur et le gestionnaire (responsable S&E) ; grilles et pondérations pour
 * l'administrateur. Le tenant vient UNIQUEMENT de req.auth.
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const ADMIN = requireRole('admin');
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

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois AAAA-MM');
const isoDate = isoDateSchema(z);
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const code = z.string().regex(/^[a-z0-9_]{2,40}$/, 'Code : minuscules, chiffres, « _ »');
const ratings = z.array(z.object({
  code, rating: z.number().int().min(1).max(4).nullable(), comment: optText(1000),
}).strict()).max(60);
const monthSpan = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
const periodOk = (v) => !v.periodFrom || !v.periodTo || (v.periodTo >= v.periodFrom && monthSpan(v.periodFrom, v.periodTo) <= 24);
const periodMsg = { message: 'Période invalide : la fin suit le début, 24 mois au plus.', path: ['periodTo'] };

// ---- Grilles et pondérations ----------------------------------------------------------
const scope = z.enum(['agent', 'prestataire']);
router.get('/criteria', asyncHandler(async (req, res) => {
  const s = scope.safeParse(req.query.scope);
  if (!s.success) throw badRequest('Portée attendue : agent ou prestataire.');
  res.json(await service.listCriteria(t(req), s.data));
}));
router.post('/criteria', ADMIN, body(z.object({
  scope, code, label: z.string().trim().min(2).max(160), help: optText(400), weight: z.number().positive().max(100).optional(),
}).strict()), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createCriterion(t(req), req.valid));
}));
router.patch('/criteria/:id', ADMIN, ids('id'), body(z.object({
  label: z.string().trim().min(2).max(160).optional(), help: optText(400), weight: z.number().positive().max(100).optional(),
  active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(100000).optional(),
}).strict()), asyncHandler(async (req, res) => {
  if (!(await service.updateCriterion(t(req), req.params.id, req.valid))) throw notFound('Critère introuvable');
  res.status(204).end();
}));

router.get('/settings', asyncHandler(async (req, res) => res.json(await service.settings(t(req)))));
router.put('/settings', ADMIN, body(z.object({
  agentAutoWeight: z.number().int().min(0).max(100), providerAgentsWeight: z.number().int().min(0).max(100),
}).strict()), asyncHandler(async (req, res) => {
  res.json(await service.saveSettings(t(req), req.valid, req.auth.userId));
}));

// ---- Évaluation d'un prestataire (retour 28.1) ----------------------------------------
const providerCreate = z.object({
  periodFrom: month, periodTo: month, evaluatedOn: isoDate, comment: optText(2000), ratings: ratings.optional(),
}).strict().refine(periodOk, periodMsg);
const providerPatch = z.object({
  periodFrom: month.optional(), periodTo: month.optional(), evaluatedOn: isoDate.optional(), comment: optText(2000),
  ratings: ratings.optional(),
}).strict().refine(periodOk, periodMsg);

router.get('/providers/:partnerId', ids('partnerId'), asyncHandler(async (req, res) => {
  res.json(await service.listProviderEvaluations(t(req), req.params.partnerId));
}));
router.get('/providers/:partnerId/:id', ids('partnerId', 'id'), asyncHandler(async (req, res) => {
  res.json(await service.getProviderEvaluation(t(req), req.params.partnerId, req.params.id));
}));
router.post('/providers/:partnerId', WRITE, ids('partnerId'), body(providerCreate), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createProviderEvaluation(t(req), req.params.partnerId, req.valid, req.auth.userId));
}));
router.patch('/providers/:partnerId/:id', WRITE, ids('partnerId', 'id'), body(providerPatch), asyncHandler(async (req, res) => {
  res.json(await service.updateProviderEvaluation(t(req), req.params.partnerId, req.params.id, req.valid, req.auth.userId));
}));
// Validation : `updatedAt` = la version que le valideur a relue (jamais une grille qu'il n'a pas vue).
router.post('/providers/:partnerId/:id/validate', WRITE, ids('partnerId', 'id'),
  body(z.object({ updatedAt: z.string().datetime({ offset: true }) }).strict()), asyncHandler(async (req, res) => {
    res.json(await service.validateProviderEvaluation(t(req), req.params.partnerId, req.params.id, req.auth.userId, req.valid.updatedAt));
  }));
router.delete('/providers/:partnerId/:id', WRITE, ids('partnerId', 'id'), asyncHandler(async (req, res) => {
  await service.deleteProviderEvaluation(t(req), req.params.partnerId, req.params.id, { userId: req.auth.userId, role: req.auth.role });
  res.status(204).end();
}));

module.exports = router;
