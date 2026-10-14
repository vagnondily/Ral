const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { readPeriod } = require('../../middleware/period');
const controller = require('./map.controller');

/**
 * Carte du suivi (lot 6a) : GET /api/map/districts — lecture pour tout utilisateur
 * authentifié du compte. Entrées bornées au bord (zod + règle de période commune) :
 * période requise (l'écran envoie toujours la sienne), 36 mois au plus.
 */
const MAP_MAX_SPAN = 36;

const router = Router();
router.use(requireAuth);

// '' (sélecteur « Tous ») = absent.
const blank = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const filtersSchema = z.object({
  office: z.preprocess(blank, z.string().uuid().optional()),
  activity: z.preprocess(blank, z.string().trim().min(1).max(200).optional()),
  // Niveaux de classement facultatifs (« commune » : tableau détaillé, plus lourd).
  levels: z.preprocess(blank, z.string().max(40).regex(/^(commune)(,(commune))*$/).optional()),
});

/** Période + filtres de la carte → req.valid = { period, officeId, activity }. */
function mapQuery(req, res, next) {
  try {
    const period = readPeriod(req.query, { required: true, maxSpan: MAP_MAX_SPAN });
    const parsed = filtersSchema.safeParse({ office: req.query.office, activity: req.query.activity, levels: req.query.levels });
    if (!parsed.success) return next(badRequest('Filtres invalides', parsed.error.flatten()));
    req.valid = { period, officeId: parsed.data.office || null, activity: parsed.data.activity || null, levels: parsed.data.levels ? parsed.data.levels.split(',') : [] };
    return next();
  } catch (e) {
    return next(e);
  }
}

router.get('/districts', mapQuery, asyncHandler(controller.districts));

module.exports = router;
module.exports.MAP_MAX_SPAN = MAP_MAX_SPAN;
module.exports.mapQuery = mapQuery;
