/**
 * Planification automatique sur une période (retour n° 82) — routes, fichier
 * NEUF monté à part (`/api/tpm/plan-auto`) pour ne pas toucher field.routes.js
 * (disputé). Deux temps, comme le reste des imports/générations de MEMS :
 *   POST /preview : calcule le plan (aucune écriture) → aperçu + explication ;
 *   POST /apply   : écrit les visites planifiées (idempotent).
 * Le calcul est pur (`planAuto.generatePlan`) ; la base fait foi à l'écriture.
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const repo = require('./planAuto.repository');
const { generatePlan } = require('./planAuto');
const { toMonth, addMonths, monthsBetween } = require('./rbmMath');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId || req.auth.sub;

const MAX_SPAN = 24; // mois : borne de sécurité (cohérent avec PERIOD_CAPS.facts)

const month = z.string().regex(/^\d{4}-\d{2}$/, 'Mois AAAA-MM requis');
const settingsSchema = z.object({
  frequency: z.object({
    elevee: z.number().int().min(1).max(12).optional(),
    moyenne: z.number().int().min(1).max(12).optional(),
    faible: z.number().int().min(1).max(12).optional(),
  }).partial().optional(),
  capacityPerMonth: z.number().int().min(1).max(100000).nullable().optional(),
  excludeMonths: z.array(month).max(60).optional(),
  targetCoverage: z.number().min(0).max(1).optional(),
}).partial().optional();

const bodySchema = z.object({
  from: month,
  to: month,
  risk: z.enum(['faible', 'moyenne', 'elevee']).optional(),
  settings: settingsSchema,
}).refine((v) => v.from <= v.to, { message: 'La période est inversée (from > to).', path: ['to'] });

function parseBody(req) {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Données invalides', parsed.error.flatten());
  const { from, to } = parsed.data;
  const span = monthsBetween(from, to) + 1;
  if (span < 1) throw badRequest('Période vide.');
  if (span > MAX_SPAN) throw badRequest(`Période trop longue (${span} mois) ; maximum ${MAX_SPAN} mois.`);
  const months = [];
  for (let m = toMonth(from), g = 0; m && m <= to && g < MAX_SPAN; m = addMonths(m, 1), g += 1) months.push(m);
  return { ...parsed.data, months };
}

/** Construit le plan (sans écriture) pour une période + critères. */
async function build(req) {
  const { from, to, risk, settings, months } = parseBody(req);
  const sites = await repo.sitesForPlanning(t(req), { from, to, risk });
  const plan = generatePlan(sites, settings || {}, months);
  // Libellés pour l'aperçu (nom / district / commune du site).
  const label = new Map(sites.map((s) => [s.id, { name: s.name, district: s.district, commune: s.commune }]));
  plan.assignments = plan.assignments.map((a) => ({ ...a, ...(label.get(a.siteId) || {}) }));
  return plan;
}

// Aperçu (lecture seule) — visible à tout utilisateur du tenant.
router.post('/preview', asyncHandler(async (req, res) => res.json(await build(req))));

// Application — écrit les visites planifiées (admin / manager).
router.post('/apply', WRITE, asyncHandler(async (req, res) => {
  const plan = await build(req);
  const { created } = await repo.applyPlan(t(req), uid(req), plan.assignments);
  res.json({ created, planned: plan.assignments.length, summary: plan.summary, perMonth: plan.perMonth });
}));

module.exports = router;
