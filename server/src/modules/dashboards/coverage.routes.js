const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { readPeriod } = require('../../middleware/period');
const { PERIOD_CAPS } = require('../common/periodCaps');
const controller = require('./coverage.controller');

/**
 * GET /api/dashboards/coverage?from=&to=[&office=] — mesures de couverture d'une période
 * (retour 110 : univers, suivis, exécution du plan, sites prévus, sites à jour, communes, par
 * activité / bureau / district), lues par la Synthèse et par « Couverture & performance ».
 * Lecture pour tout utilisateur authentifié du compte. Entrées bornées au bord : période
 * requise, 24 mois au plus (PERIOD_CAPS.facts : faits site × mois) ; bureau = uuid (vide =
 * tous les bureaux), le bureau et ses antennes ; activité = libellé du registre (1 à 200 caractères,
 * casse et espaces de bord ignorés), vide = toutes.
 */
const router = Router();
router.use(requireAuth);

const blank = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const schema = z.object({
  office: z.preprocess(blank, z.string().uuid().optional()),
  activity: z.preprocess(blank, z.string().trim().min(1).max(200).optional()),
});

router.get('/', (req, res, next) => {
  try {
    const period = readPeriod(req.query, { required: true, maxSpan: PERIOD_CAPS.facts });
    const parsed = schema.safeParse({ office: req.query.office, activity: req.query.activity });
    if (!parsed.success) return next(badRequest('Filtres invalides', parsed.error.flatten()));
    req.valid = { period, officeId: parsed.data.office || null, activity: parsed.data.activity || null };
    return next();
  } catch (e) {
    return next(e);
  }
}, asyncHandler(controller.coverage));

module.exports = router;
