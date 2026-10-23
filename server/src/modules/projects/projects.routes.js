/**
 * Projets — routes (première version, docs/SPEC_PROGRAMMES.md). Lecture : tout utilisateur connecté ;
 * écriture : éditeur et plus. Erreurs mappées par le gestionnaire central (23505 → 409, etc.).
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole, WRITE_ROLES } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const repo = require('./projects.repository');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole(...WRITE_ROLES);
const t = (req) => req.auth.tenantId;
const uuid = z.string().uuid();
function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}
const param = (req) => { if (!uuid.safeParse(req.params.id).success) throw badRequest('Identifiant invalide'); return req.params.id; };

const text = (max) => z.string().trim().max(max).optional().or(z.literal('').transform(() => null)).nullable();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ').nullable().optional().or(z.literal('').transform(() => null));
const projectSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(200),
  code: text(60),
  grantNumber: text(80),
  awardNumber: text(80),
  donorCode: text(40),
  donorName: text(160),
  regions: text(2000),
  startDate: dateStr,
  endDate: dateStr,
  status: z.enum(['en_cours', 'suspendu', 'termine', 'abandonne']).optional(),
  budgetAmount: z.number().int().min(0).max(1e15).nullable().optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable().optional().or(z.literal('').transform(() => null)),
  description: text(5000),
});

router.get('/', asyncHandler(async (req, res) => res.json(await repo.listProjects(t(req)))));
router.get('/:id', asyncHandler(async (req, res) => {
  const p = await repo.getProject(t(req), param(req));
  if (!p) throw notFound('Projet introuvable');
  res.json(p);
}));
router.post('/', WRITE, body(projectSchema), asyncHandler(async (req, res) => {
  try { res.status(201).json({ id: await repo.createProject(t(req), req.valid) }); }
  catch (err) { if (err.code === '23505') throw conflict('Un projet porte déjà ce code.'); throw err; }
}));
router.patch('/:id', WRITE, body(projectSchema.partial()), asyncHandler(async (req, res) => {
  try { if (!(await repo.updateProject(t(req), param(req), req.valid))) throw notFound('Projet introuvable'); res.status(204).end(); }
  catch (err) { if (err.code === '23505') throw conflict('Un projet porte déjà ce code.'); throw err; }
}));
router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deleteProject(t(req), param(req)))) throw notFound('Projet introuvable');
  res.status(204).end();
}));

// ---- Cadre logique -----------------------------------------------------------------
const logframeSchema = z.object({
  parentId: uuid.nullable().optional(),
  level: z.enum(['impact', 'outcome', 'output', 'activity']),
  statement: z.string().trim().min(1, 'Énoncé requis').max(1000),
  indicator: text(500), baseline: text(300), target: text(300),
  meansOfVerification: text(500), assumptions: text(1000),
  sortOrder: z.number().int().optional(),
});
router.post('/:id/logframe', WRITE, body(logframeSchema), asyncHandler(async (req, res) => {
  const id = await repo.addLogframe(t(req), param(req), req.valid);
  if (!id) throw notFound('Projet introuvable');
  res.status(201).json({ id });
}));
router.patch('/logframe/:id', WRITE, body(logframeSchema.partial()), asyncHandler(async (req, res) => {
  if (!(await repo.updateLogframe(t(req), param(req), req.valid))) throw notFound('Ligne introuvable');
  res.status(204).end();
}));
router.delete('/logframe/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deleteLogframe(t(req), param(req)))) throw notFound('Ligne introuvable');
  res.status(204).end();
}));

// ---- Besoins -----------------------------------------------------------------------
const needSchema = z.object({
  title: z.string().trim().min(2, 'Titre requis').max(200),
  description: text(2000), zone: text(160),
  targetPopulation: z.number().int().min(0).max(1e12).nullable().optional(),
  priority: z.enum(['haute', 'moyenne', 'basse']).nullable().optional().or(z.literal('').transform(() => null)),
  sortOrder: z.number().int().optional(),
});
router.post('/:id/needs', WRITE, body(needSchema), asyncHandler(async (req, res) => {
  const id = await repo.addNeed(t(req), param(req), req.valid);
  if (!id) throw notFound('Projet introuvable');
  res.status(201).json({ id });
}));
router.patch('/needs/:id', WRITE, body(needSchema.partial()), asyncHandler(async (req, res) => {
  if (!(await repo.updateNeed(t(req), param(req), req.valid))) throw notFound('Besoin introuvable');
  res.status(204).end();
}));
router.delete('/needs/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deleteNeed(t(req), param(req)))) throw notFound('Besoin introuvable');
  res.status(204).end();
}));

module.exports = router;
