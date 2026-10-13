const { Router } = require('express');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./alerts.controller');

/**
 * Centre d'alertes (retour n° 34) : GET /api/alerts — la page « Centre
 * d'alertes » et la cloche de l'en-tête lisent la même liste. Lecture seule,
 * tout utilisateur authentifié du tenant.
 */
const router = Router();
router.use(requireAuth);
router.get('/', asyncHandler(controller.list));

module.exports = router;
