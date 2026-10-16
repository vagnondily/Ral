/**
 * Planification automatique sur une période (retour n° 82) — routes (`/api/tpm/plan-auto`).
 * Deux temps :
 *   POST /preview : calcule le plan (aucune écriture) → totaux, répartitions, échantillon et
 *                   empreinte des entrées ;
 *   POST /apply   : écrit le plan prévisualisé (même empreinte, sinon 409 plan_inputs_changed) ;
 *   POST /clear   : efface les visites prévues libres de la période.
 * Validation ici (zod) ; règles et transactions dans planAuto.service ; SQL dans le dépôt.
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const service = require('./planAuto.service');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId || req.auth.sub;

// Mois AAAA-MM d'un vrai mois (01 à 12).
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois AAAA-MM requis (01 à 12)');
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'Empreinte invalide');
const settingsSchema = z.object({
  frequency: z.object({
    elevee: z.number().int().min(1).max(12).optional(),
    moyenne: z.number().int().min(1).max(12).optional(),
    faible: z.number().int().min(1).max(12).optional(),
  }).strict().partial().optional(),
  capacityPerMonth: z.number().int().min(1).max(100000).nullable().optional(),
  overflowPct: z.number().min(0).max(100).optional(),
  excludeMonths: z.array(month).max(12).optional(),
  useMmrCapacity: z.boolean().optional(),
  groupByCommune: z.boolean().optional(),
  useGps: z.boolean().optional(),
  gpsGridDeg: z.number().min(0.01).max(5).optional(),
  balanceByTpm: z.boolean().optional(),
  coverAllOnce: z.boolean().optional(),
  tpmCapacityPerMonth: z.number().int().min(1).max(100000).nullable().optional(),
  targetCoverage: z.number().min(0).max(1).optional(),
}).strict().partial().optional();

const baseFields = {
  from: month,
  to: month,
  adjusted: z.boolean().optional(),
  risk: z.enum(['faible', 'moyenne', 'elevee']).optional(),
  settings: settingsSchema,
};
const period = (schema) => schema
  .refine((v) => v.from <= v.to, { message: 'La période est inversée (from > to).', path: ['to'] })
  .refine((v) => v.from.slice(0, 4) === v.to.slice(0, 4), { message: 'La période doit tenir dans un seul exercice (même année).', path: ['to'] });
const previewSchema = period(z.object(baseFields).strict());
// « Appliquer » rend l'empreinte de l'aperçu : on n'écrit jamais un plan que l'utilisateur n'a pas vu.
const applySchema = period(z.object({
  ...baseFields,
  fingerprint: hex64,
  sections: z.record(z.string().max(40), hex64).optional(),
}).strict());
const clearSchema = period(z.object({ from: month, to: month, risk: baseFields.risk }).strict());

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest('Données invalides', parsed.error.flatten());
  return parsed.data;
}

// Aperçu (lecture seule) — visible à tout utilisateur du tenant.
router.post('/preview', asyncHandler(async (req, res) => res.json(await service.preview(t(req), parse(previewSchema, req.body)))));

// Application — écrit les visites planifiées (admin / manager).
router.post('/apply', WRITE, asyncHandler(async (req, res) => res.json(await service.apply(t(req), uid(req), parse(applySchema, req.body)))));

// Effacement des visites PRÉVUES libres de la période (pour repartir d'un plan propre).
router.post('/clear', WRITE, asyncHandler(async (req, res) => {
  const body = parse(clearSchema, req.body);
  const { year, months } = service.periodMonths(body);
  res.json(await service.clearPlanned(t(req), { year, from: months[0], to: months[months.length - 1], risk: body.risk }));
}));

module.exports = router;
