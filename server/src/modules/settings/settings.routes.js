const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const repo = require('./settings.repository');
const { parseUpload } = require('./adminImport');

const router = Router();
router.use(requireAuth);
const ADMIN = requireRole('admin');

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const slug = z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/i, 'Code : lettres, chiffres, tiret/underscore');
const label = z.string().trim().min(2).max(120);
const t = (req) => req.auth.tenantId;

// ---- Partner types
router.get('/partner-types', asyncHandler(async (req, res) => res.json(await repo.listPartnerTypes(t(req)))));
router.post('/partner-types', ADMIN, body(z.object({ code: slug, label, sortOrder: z.number().int().optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await repo.createPartnerType(t(req), req.valid))));

// ---- Activities
router.get('/activities', asyncHandler(async (req, res) =>
  res.json(await repo.listActivities(t(req), { activeOnly: req.query.active === 'true' }))));
router.post('/activities', ADMIN, body(z.object({ code: slug, label, sortOrder: z.number().int().optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await repo.createActivity(t(req), req.valid))));
router.patch('/activities/:id', ADMIN, body(z.object({ active: z.boolean() })), asyncHandler(async (req, res) => {
  const ok = await repo.setActivityActive(t(req), req.params.id, req.valid.active);
  if (!ok) return res.status(404).json({ error: 'Activité introuvable' });
  return res.status(204).end();
}));

// ---- Partners (unified registry)
router.get('/partners', asyncHandler(async (req, res) =>
  res.json(await repo.listPartners(t(req), { typeCode: req.query.type }))));

const partnerBody = z.object({
  name: z.string().trim().min(2).max(160),
  partnerTypeId: z.string().uuid(),
  dailyRate: z.number().nonnegative().nullable().optional(),
  contractRef: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
});

router.post('/partners', ADMIN, body(partnerBody), asyncHandler(async (req, res) => {
  const type = await repo.partnerTypeById(t(req), req.valid.partnerTypeId);
  if (!type) throw badRequest('Type de partenaire inconnu');
  // A daily rate only makes sense for a TPM partner.
  const dailyRate = type.code === 'tpm' ? req.valid.dailyRate ?? 0 : null;
  const id = await repo.createPartner(t(req), { ...req.valid, dailyRate });
  return res.status(201).json({ id });
}));

router.patch('/partners/:id', ADMIN, body(z.object({
  name: z.string().trim().min(2).max(160).optional(),
  dailyRate: z.number().nonnegative().nullable().optional(),
  contractRef: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  active: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const ok = await repo.updatePartner(t(req), req.params.id, req.valid);
  if (!ok) return res.status(404).json({ error: 'Partenaire introuvable' });
  return res.status(204).end();
}));

router.post('/partners/:id/agents', ADMIN, body(z.object({
  name: z.string().trim().min(2).max(120),
  fonction: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
})), asyncHandler(async (req, res) => res.status(201).json(await repo.createAgent(t(req), req.params.id, req.valid))));

router.delete('/partners/:id/agents/:agentId', ADMIN, asyncHandler(async (req, res) => {
  const ok = await repo.deleteAgent(t(req), req.params.id, req.params.agentId);
  if (!ok) return res.status(404).json({ error: 'Agent introuvable' });
  return res.status(204).end();
}));

// Évaluation : formations suivies par un agent (thématique, date, jours)
router.post('/partners/:id/agents/:agentId/formations', ADMIN, body(z.object({
  thematique: z.string().trim().min(2).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
  jours: z.number().positive().max(365).optional(),
})), asyncHandler(async (req, res) => {
  const f = await repo.createFormation(t(req), req.params.id, req.params.agentId, req.valid);
  if (!f) return res.status(404).json({ error: 'Agent introuvable' });
  return res.status(201).json(f);
}));

router.delete('/partners/:id/agents/:agentId/formations/:formationId', ADMIN, asyncHandler(async (req, res) => {
  const ok = await repo.deleteFormation(t(req), req.params.id, req.params.agentId, req.params.formationId);
  if (!ok) return res.status(404).json({ error: 'Formation introuvable' });
  return res.status(204).end();
}));

// Évaluation d'un agent (basée sur son travail terrain) : période, note, appréciation
router.post('/partners/:id/agents/:agentId/evaluations', ADMIN, body(z.object({
  periode: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  note: z.number().min(0).max(20).optional(),
  appreciation: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
  commentaire: z.string().trim().max(1000).optional().or(z.literal('').transform(() => undefined)),
})), asyncHandler(async (req, res) => {
  const input = { ...req.valid, periode: `${req.valid.periode.slice(0, 7)}-01` };
  const e = await repo.createEvaluation(t(req), req.params.id, req.params.agentId, input, req.auth.userId);
  if (!e) return res.status(404).json({ error: 'Agent introuvable' });
  return res.status(201).json(e);
}));

router.delete('/partners/:id/agents/:agentId/evaluations/:evaluationId', ADMIN, asyncHandler(async (req, res) => {
  const ok = await repo.deleteEvaluation(t(req), req.params.id, req.params.agentId, req.params.evaluationId);
  if (!ok) return res.status(404).json({ error: 'Évaluation introuvable' });
  return res.status(204).end();
}));

// ---- Admin breakdown (localités) — référentiel géographique par tenant/pays
router.get('/admin-levels', asyncHandler(async (req, res) => res.json(await repo.listAdminLevels(t(req)))));

router.get('/admin-areas', asyncHandler(async (req, res) => {
  const depth = req.query.depth ? Number(req.query.depth) : undefined;
  const parentId = req.query.parentId || undefined;
  res.json(await repo.listAdminAreas(t(req), { depth, parentId }));
}));

router.get('/admin-breakdown/summary', asyncHandler(async (req, res) =>
  res.json(await repo.adminBreakdownSummary(t(req)))));

// Upload d'un découpage (un fichier par pays) : .csv, .dbf ou .zip (shapefile).
router.post('/admin-breakdown/import', ADMIN, express.raw({ type: '*/*', limit: '30mb' }),
  asyncHandler(async (req, res) => {
    const filename = req.get('x-filename') || 'upload.csv';
    if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
    let parsed;
    try {
      parsed = await parseUpload(req.body, filename);
    } catch (err) {
      throw badRequest(err.message);
    }
    if (!parsed.levels.length) throw badRequest('Aucun niveau administratif détecté dans le fichier.');
    const result = await repo.replaceAdminBreakdown(t(req), parsed);
    res.status(201).json(result);
  }));

module.exports = router;
