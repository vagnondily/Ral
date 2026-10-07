const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const repo = require('./pdd.repository');
const { parsePddWorkbook } = require('./pddImport');

/**
 * Plan de Distribution d'urgence (PDD). Lecture pour tout utilisateur du
 * tenant ; écritures (stock, import) réservées admin/manager. Réutilise les
 * mêmes zones/bureaux/partenaires que le reste de MEMS (stockés en libellé).
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId || req.auth.sub;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}
const monthQ = (req) => (/^\d{4}-\d{2}/.test(req.query.month || '') ? req.query.month : undefined);
const filters = (req) => ({
  month: monthQ(req),
  hazard: req.query.hazard || undefined,
  region: req.query.region || undefined,
  district: req.query.district || undefined,
});

// ---- Référentiel denrées -------------------------------------------------
router.get('/commodities', asyncHandler(async (req, res) => res.json(await repo.listCommodities(t(req)))));

// ---- Lignes de distribution (liste) --------------------------------------
router.get('/distributions', asyncHandler(async (req, res) => res.json(await repo.listDistributions(t(req), filters(req)))));

// ---- Synthèse (totaux, par aléa, par mois, arbre zone) -------------------
router.get('/summary', asyncHandler(async (req, res) => res.json(await repo.summaryData(t(req), filters(req)))));

// ---- Pipeline (besoin planifié vs stock disponible, par denrée) ----------
router.get('/pipeline', asyncHandler(async (req, res) => res.json(await repo.pipelineData(t(req), { month: monthQ(req) }))));

// ---- Stock disponible (saisie manuelle pour le pipeline) -----------------
const stockSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  commodity: z.string().trim().min(1).max(120),
  availableMt: z.number().min(0).max(1e9),
  donor: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
  note: z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined)),
});
router.put('/stock', WRITE, body(stockSchema), asyncHandler(async (req, res) => {
  await repo.setStock(t(req), req.valid, uid(req));
  res.status(204).end();
}));

// ---- Import du fichier PDD (.xlsx, feuille « PDD base ») -----------------
// Réimport idempotent : les mois présents dans le fichier sont d'abord vidés.
router.post('/import', WRITE, express.raw({ type: '*/*', limit: '40mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let parsed;
  try { parsed = await parsePddWorkbook(req.body); }
  catch { throw badRequest('Fichier illisible : fournissez un .xlsx du plan de distribution.'); }
  if (!parsed.sheet) throw badRequest('Aucune feuille « PDD base » détectée (en-têtes Mois + Commune).');
  if (parsed.rows.length === 0) throw badRequest(`Aucune ligne exploitable (mois + zone + activité requis). ${parsed.skipped} ligne(s) ignorée(s).`);
  const result = await repo.insertDistributions(t(req), uid(req), parsed.rows, { source: 'xlsx', replaceMonths: true });
  res.json({ ...result, sheet: parsed.sheet, skipped: parsed.skipped });
}));

module.exports = router;
