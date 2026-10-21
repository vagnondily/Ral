const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole, WRITE_ROLES } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { readPeriod } = require('../../middleware/period');
const { addMonths } = require('../common/period');
const { currentMonth } = require('./rbmMath');
const { MAX_SPAN_MONTHS, MAX_AREAS, MAX_REGIONS, MAX_VISITS, LOG_ACTIONS } = require('./tpmAttribution');
const controller = require('./tpmAttribution.controller');

/**
 * Affectation des TPM par zone (retour 58) — /api/tpm/attribution. Lecture pour tout utilisateur
 * du compte ; écriture admin / manager (comme field.routes). Entrées bornées au bord : période
 * « du … au … » de 24 mois au plus (PERIOD_CAPS.facts, règle commune readPeriod → period_format /
 * period_order / period_span), 300 zones, 30 régions, 500 visites ; la raison est nettoyée et
 * bornée 10..500 par le service (common/reasonText → reason_* ), et par la base (CHECK).
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole(...WRITE_ROLES);

const blank = (v) => (v === '' ? null : v);
const uuid = z.string().uuid();
const optUuid = z.preprocess(blank, uuid.nullable().optional());
const reason = z.string().max(2000).optional().nullable();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function validate(schema, pick) {
  return (req, res, next) => {
    const parsed = schema.safeParse(pick(req));
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}
/** Période du corps ou de la requête (règle commune) → { from, to } ; défaut : `fallback`. */
function withPeriod(src, fallback) {
  const p = readPeriod({ from: src.from, to: src.to, month: src.month }, { maxSpan: MAX_SPAN_MONTHS });
  return p || fallback();
}
const thisMonth = () => ({ from: currentMonth(), to: currentMonth() });

// ---- Lectures --------------------------------------------------------------------
router.get('/', (req, res, next) => {
  try {
    const period = withPeriod(req.query, () => ({ from: currentMonth(), to: addMonths(currentMonth(), 5) }));
    const regionId = req.query.regionId ? uuid.safeParse(req.query.regionId) : null;
    if (regionId && !regionId.success) return next(badRequest('Région invalide.'));
    req.valid = { period, regionId: regionId ? regionId.data : null, all: req.query.all === '1' };
    return next();
  } catch (e) { return next(e); }
}, asyncHandler(controller.table));

router.get('/providers', (req, res, next) => {
  try { req.valid = { period: withPeriod(req.query, thisMonth) }; return next(); } catch (e) { return next(e); }
}, asyncHandler(controller.providers));

router.get('/resolve', validate(z.object({ siteId: uuid, month }), (req) => ({ siteId: req.query.siteId, month: String(req.query.month || '').slice(0, 7) })),
  asyncHandler(controller.resolve));

const logQuery = z.object({
  batchId: optUuid, areaId: optUuid, visitId: optUuid, providerId: optUuid,
  from: z.preprocess(blank, month.nullable().optional()), to: z.preprocess(blank, month.nullable().optional()),
  action: z.preprocess(blank, z.enum(LOG_ACTIONS).nullable().optional()),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
router.get('/log', validate(logQuery, (req) => req.query), asyncHandler(controller.log));

// ---- Écritures -------------------------------------------------------------------
/** Sélection : zones (districts / communes) et/ou régions entières, plage de mois. */
const targetShape = {
  areaIds: z.array(uuid).max(MAX_AREAS).default([]),
  regionIds: z.array(uuid).max(MAX_REGIONS).default([]),
  from: month, to: month,
};
const hasZone = (b) => b.areaIds.length + b.regionIds.length > 0;
const NO_ZONE = { message: 'Choisissez au moins une zone.' };
/** Corps validé → { target, … } (période contrôlée par la règle commune). */
function targetBody(schema) {
  return (req, res, next) => {
    const parsed = schema.refine(hasZone, NO_ZONE).safeParse(req.body || {});
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    try {
      const { areaIds, regionIds, from, to, ...rest } = parsed.data;
      const period = readPeriod({ from, to }, { required: true, maxSpan: MAX_SPAN_MONTHS });
      req.valid = { target: { areaIds, regionIds, from: period.from, to: period.to }, ...rest };
      return next();
    } catch (e) { return next(e); }
  };
}

router.post('/preview', targetBody(z.object({
  ...targetShape, mode: z.enum(['modifier', 'revenir']).default('modifier'), providerId: optUuid.transform((v) => v || null), reason,
})), asyncHandler(controller.preview));

router.put('/overrides', WRITE, targetBody(z.object({
  ...targetShape, providerId: optUuid.transform((v) => v || null), reason, stamp: z.string().min(1).max(64),
})), asyncHandler(controller.saveOverrides));

router.post('/revert', WRITE, targetBody(z.object({ ...targetShape, reason, stamp: z.string().min(1).max(64) })), asyncHandler(controller.revert));

router.post('/apply', WRITE, (req, res, next) => {
  const parsed = z.object({ from: month, to: month, reason }).safeParse(req.body || {});
  if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
  try {
    req.valid = { period: readPeriod(parsed.data, { required: true, maxSpan: MAX_SPAN_MONTHS }), reason: parsed.data.reason };
    return next();
  } catch (e) { return next(e); }
}, asyncHandler(controller.reapply));

router.post('/visits', WRITE, validate(z.object({
  visitIds: z.array(uuid).min(1).max(MAX_VISITS),
  action: z.enum(['zone', 'set', 'keep']),
  providerId: optUuid.transform((v) => v || null),
  reason,
}), (req) => req.body || {}), asyncHandler(controller.visits));

// ---- Indisponibilités des TPM (retour 114) ------------------------------------------
// Lecture : période « du … au … » (défaut : mois courant + 11). Écriture admin / manager : un TPM, une
// plage de 24 mois au plus, un motif (10..500, nettoyé par le service, CHECK en base) ; l'empreinte de
// l'aperçu protège d'une décision prise entre-temps (409).
router.get('/unavailability', (req, res, next) => {
  try {
    req.valid = { period: withPeriod(req.query, () => ({ from: currentMonth(), to: addMonths(currentMonth(), 11) })) };
    return next();
  } catch (e) { return next(e); }
}, asyncHandler(controller.unavailabilityList));

/** Corps d'une décision d'indisponibilité → { providerId, from, to, … } (période contrôlée par la règle commune). */
function unavailabilityBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    try {
      const { from, to, ...rest } = parsed.data;
      const period = readPeriod({ from, to }, { required: true, maxSpan: MAX_SPAN_MONTHS });
      req.valid = { ...rest, from: period.from, to: period.to };
      return next();
    } catch (e) { return next(e); }
  };
}
const unavailabilityShape = { providerId: uuid, from: month, to: month, reason };
router.post('/unavailability/preview', unavailabilityBody(z.object({ ...unavailabilityShape, mode: z.enum(['poser', 'retirer']) })),
  asyncHandler(controller.unavailabilityPreview));
router.put('/unavailability', WRITE, unavailabilityBody(z.object({ ...unavailabilityShape, stamp: z.string().min(1).max(64) })),
  asyncHandler(controller.unavailabilitySet));
router.post('/unavailability/end', WRITE, unavailabilityBody(z.object({ ...unavailabilityShape, stamp: z.string().min(1).max(64) })),
  asyncHandler(controller.unavailabilityEnd));

module.exports = router;
