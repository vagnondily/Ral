/**
 * Planification automatique du plan de suivi (lot 5, §§ 6–7) — monté sur /api/tpm/plan
 * (avant /api/tpm). Lecture des paramètres : tout utilisateur connecté ; modification :
 * administrateur ; aperçu et application : administrateur ou gestionnaire (comme le Plan
 * de suivi). Toute entrée est validée ici (zod) ET en base (CHECK, verrous, garde-fous).
 */
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const controller = require('./plan.controller');
const S = require('./planSettings');

const router = Router();
router.use(requireAuth);
const ADMIN = requireRole('admin');
const WRITE = requireRole('admin', 'manager');

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const int = (lo, hi) => z.number().int().min(lo).max(hi);
// Seuls paramètres du compte (retours 107 et 108) : tout le reste vient du MMR, du RBM et des contrats.
const settingsSchema = z.object({
  revision: z.number().int().min(0),
  strategy: z.enum(S.STRATEGIES),
  agentsPerVehicle: int(...S.BOUNDS.agentsPerVehicle),
  fieldDaysPerMonth: int(...S.BOUNDS.fieldDaysPerMonth),
}).strict();
// Choix changés pour UN aperçu (jamais enregistrés) : mêmes bornes que les paramètres.
const overridesSchema = settingsSchema.omit({ revision: true }).partial().strict();
// Exceptions du mois : communes inaccessibles (saison des pluies, route coupée).
const adjustSchema = z.object({
  excludedCommunes: z.array(z.object({
    district: z.string().trim().max(120).optional().default(''),
    commune: z.string().trim().min(1).max(160),
  }).strict()).max(S.ADJUST_BOUNDS.excludedCommunes[1]).optional().default([]),
}).strict();

const month = int(1, 12);
const optText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const previewSchema = z.object({
  year: int(2000, 2100),
  from: month,
  to: month,
  officeId: z.string().uuid().optional().nullable().transform((v) => v || null),
  activity: optText(160),
  district: optText(120),
  params: overridesSchema.optional().default({}),
  adjust: adjustSchema.optional().default({}),
}).strict().refine((b) => b.from <= b.to, { message: 'Le mois de début est après le mois de fin.', path: ['from'] });

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const cell = z.object({ siteId: z.string().uuid(), month }).strict();
const applySchema = z.object({
  year: int(2000, 2100),
  from: month,
  to: month,
  officeId: z.string().uuid().optional().nullable().transform((v) => v || null),
  activity: optText(160),
  district: optText(120),
  params: overridesSchema.optional().default({}),
  adjust: adjustSchema.optional().default({}),
  fingerprint: hex64,
  sections: z.record(z.string().max(20), hex64).optional().default({}),
  keep: z.array(cell).min(1).max(5000),
  changes: z.array(cell.extend({ planned: z.boolean() })).max(5000).optional().default([]),
}).strict().refine((b) => b.from <= b.to, { message: 'Le mois de début est après le mois de fin.', path: ['from'] });

router.get('/settings', asyncHandler(controller.getSettings));
router.put('/settings', ADMIN, body(settingsSchema), asyncHandler(controller.saveSettings));
router.post('/preview', WRITE, body(previewSchema), asyncHandler(controller.preview));
router.post('/apply', WRITE, body(applySchema), asyncHandler(controller.apply));

module.exports = router;
