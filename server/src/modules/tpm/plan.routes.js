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
const settingsSchema = z.object({
  revision: z.number().int().min(0),
  objective: z.enum(S.OBJECTIVES),
  coverageTargetPct: int(...S.BOUNDS.coverageTargetPct),
  levels: z.array(z.enum(S.LEVELS)).min(1).max(3).refine((l) => new Set(l).size === l.length, 'Niveaux en double.'),
  coverageCatchUp: z.boolean(),
  dayGrouping: z.enum(S.DAY_GROUPINGS),
  fillDistrict: z.boolean(),
  multiActivityDays: z.boolean(),
  capacityMarginPct: int(...S.BOUNDS.capacityMarginPct),
  travelDaysPerTour: int(...S.BOUNDS.travelDaysPerTour),
  urgentMinGapMonths: int(...S.BOUNDS.urgentMinGapMonths),
  anticipationMonths: int(...S.BOUNDS.anticipationMonths),
  defaultVisitsPerDay: z.number().min(S.BOUNDS.defaultVisitsPerDay[0]).max(S.BOUNDS.defaultVisitsPerDay[1])
    .refine((v) => Number.isInteger(v * 2), 'Par pas de 0,5.'),
  generalRowMode: z.enum(S.GENERAL_ROW_MODES),
  minMonthsSinceVisit: int(...S.BOUNDS.minMonthsSinceVisit),
}).strict();
// Critères ajustés pour UN aperçu (jamais enregistrés) : mêmes bornes que les paramètres.
const overridesSchema = settingsSchema.omit({ revision: true }).partial().strict();

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
