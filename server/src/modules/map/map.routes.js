const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { readPeriod } = require('../../middleware/period');
const controller = require('./map.controller');
const { LAYERS } = require('./mapPoints');

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

// Points : couches demandées (gps, derived, communes, collect ; toutes par défaut) et plafond
// des points de collecte précis (1 à 5 000 ; au-delà, ou pour un lecteur : carroyage de 2 km).
const pointsSchema = z.object({
  layers: z.preprocess(blank, z.string().max(60).optional())
    .transform((v) => (v ? [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))] : [...LAYERS]))
    .refine((list) => list.length && list.every((x) => LAYERS.includes(x)), 'Couche inconnue'),
  limit: z.preprocess(blank, z.coerce.number().int().min(1).max(5000).optional()),
});
router.get('/points', mapQuery, (req, res, next) => {
  const parsed = pointsSchema.safeParse({ layers: req.query.layers, limit: req.query.limit });
  if (!parsed.success) return next(badRequest('Paramètres invalides', parsed.error.flatten()));
  req.valid = { ...req.valid, layers: parsed.data.layers, limit: parsed.data.limit || 2000 };
  return next();
}, asyncHandler(controller.points));

// Recherche : 2 à 80 caractères.
const searchSchema = z.object({ q: z.string().trim().min(2).max(80) });
router.get('/search', (req, res, next) => {
  const parsed = searchSchema.safeParse({ q: req.query.q });
  if (!parsed.success) return next(badRequest('Recherche : 2 à 80 caractères', parsed.error.flatten()));
  req.valid = parsed.data;
  return next();
}, asyncHandler(controller.search));

module.exports = router;
module.exports.MAP_MAX_SPAN = MAP_MAX_SPAN;
module.exports.mapQuery = mapQuery;
