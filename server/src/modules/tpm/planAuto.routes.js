/**
 * Planification automatique sur une période (retour n° 82) — routes, fichier
 * NEUF monté à part (`/api/tpm/plan-auto`). Deux temps :
 *   POST /preview : calcule le plan (aucune écriture) → aperçu + explication ;
 *   POST /apply   : écrit les visites planifiées (idempotent).
 * Les chiffres MMR/RBM viennent du Plan de suivi (planBoard) ; le calcul est pur.
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const repo = require('./planAuto.repository');
const { generatePlan } = require('./planAuto');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId || req.auth.sub;

const month = z.string().regex(/^\d{4}-\d{2}$/, 'Mois AAAA-MM requis');
const settingsSchema = z.object({
  frequency: z.object({
    elevee: z.number().int().min(1).max(12).optional(),
    moyenne: z.number().int().min(1).max(12).optional(),
    faible: z.number().int().min(1).max(12).optional(),
  }).partial().optional(),
  capacityPerMonth: z.number().int().min(1).max(100000).nullable().optional(),
  overflowPct: z.number().min(0).max(100).optional(),
  excludeMonths: z.array(month).max(12).optional(),
  useMmrCapacity: z.boolean().optional(),
  groupByCommune: z.boolean().optional(),
  useGps: z.boolean().optional(),
  gpsGridDeg: z.number().min(0.01).max(5).optional(),
  balanceByTpm: z.boolean().optional(),
  tpmCapacityPerMonth: z.number().int().min(1).max(100000).nullable().optional(),
  targetCoverage: z.number().min(0).max(1).optional(),
}).partial().optional();

const bodySchema = z.object({
  from: month,
  to: month,
  adjusted: z.boolean().optional(),
  risk: z.enum(['faible', 'moyenne', 'elevee']).optional(),
  settings: settingsSchema,
}).refine((v) => v.from <= v.to, { message: 'La période est inversée (from > to).', path: ['to'] })
  .refine((v) => v.from.slice(0, 4) === v.to.slice(0, 4), { message: 'La période doit tenir dans un seul exercice (même année).', path: ['to'] });

function parseBody(req) {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Données invalides', parsed.error.flatten());
  const { from, to } = parsed.data;
  const year = Number(from.slice(0, 4));
  const m0 = Number(from.slice(5, 7));
  const m1 = Number(to.slice(5, 7));
  const months = [];
  for (let m = m0; m <= m1; m += 1) months.push(m);
  return { ...parsed.data, year, months };
}

/** Construit le plan (sans écriture) pour une période + critères. */
async function build(req) {
  const { risk, adjusted, settings, months, year } = parseBody(req);
  const s = settings || {};
  const { sites, mmrByKey } = await repo.sitesForPlanning(t(req), {
    year, adjusted: Boolean(adjusted), risk, capacityOverride: s.capacityPerMonth,
  });
  // L'ajustement MMR (CO adjusted) est transmis au moteur pour l'intervalle.
  const plan = generatePlan(sites, mmrByKey, { ...s, adjusted: Boolean(adjusted) }, months, year);
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

// Effacement des visites PLANIFIÉES de la période (pour repartir d'un plan propre).
router.post('/clear', WRITE, asyncHandler(async (req, res) => {
  const { risk, months, year } = parseBody(req);
  const { deleted } = await repo.clearPlanned(t(req), { year, from: months[0], to: months[months.length - 1], risk });
  res.json({ deleted });
}));

module.exports = router;
