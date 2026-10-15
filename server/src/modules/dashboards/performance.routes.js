const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { readPeriod } = require('../../middleware/period');
const { PERIOD_CAPS } = require('../common/periodCaps');
const controller = require('./performance.controller');

/**
 * Tableau de bord « Couverture & performance du suivi » (maquette de l'utilisateur) — lecture
 * pour tout utilisateur authentifié du compte. Entrées bornées au bord :
 *   période requise (l'écran envoie toujours la sienne), 12 mois au plus (PERIOD_CAPS.analysis :
 *   les réponses de la période sont relues) ; bureau = uuid (« Tous » vide = sans filtre) ;
 *   activité = catégorie (1 à 200 caractères), ou none=1 pour les fiches sans activité.
 *   GET /api/dashboards/performance          activités et vue d'ensemble
 *   GET /api/dashboards/performance/trend    tendance mensuelle d'une activité
 *   GET /api/dashboards/performance/agents   qualité de saisie par agent d'une activité
 */
const router = Router();
router.use(requireAuth);

const blank = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const baseSchema = z.object({ office: z.preprocess(blank, z.string().uuid().optional()) });
const activitySchema = baseSchema.extend({
  activity: z.preprocess(blank, z.string().trim().min(1).max(200).optional()),
  none: z.preprocess(blank, z.enum(['1', 'true']).optional()),
}).refine((q) => !!q.activity !== !!q.none, { message: 'Activité requise : activity=<catégorie> ou none=1 (fiches sans activité), pas les deux.' });

/** Période + filtres → req.valid = { period, officeId[, activity, none] }. */
const query = (schema) => (req, res, next) => {
  try {
    const period = readPeriod(req.query, { required: true, maxSpan: PERIOD_CAPS.analysis });
    const parsed = schema.safeParse({ office: req.query.office, activity: req.query.activity, none: req.query.none });
    if (!parsed.success) return next(badRequest('Filtres invalides', parsed.error.flatten()));
    const d = parsed.data;
    req.valid = { period, officeId: d.office || null };
    if (schema === activitySchema) Object.assign(req.valid, { activity: d.activity || null, none: !!d.none });
    return next();
  } catch (e) {
    return next(e);
  }
};

router.get('/', query(baseSchema), asyncHandler(controller.performance));
router.get('/trend', query(activitySchema), asyncHandler(controller.trend));
router.get('/agents', query(activitySchema), asyncHandler(controller.agents));

module.exports = router;
