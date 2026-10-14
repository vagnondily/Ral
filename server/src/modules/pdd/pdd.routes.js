const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { sniffFile } = require('../common/fileSniff');
const { assertZipEntries, zipLimitsFromEnv } = require('../common/zipGuard');
const repo = require('./pdd.repository');
const { readPeriod } = require('../../middleware/period');
const { parsePddWorkbook, issue } = require('./pddImport');
const { buildPddTemplate } = require('./pddTemplate');
const { isRefusal } = require('../common/xlsxGuard');

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
// Filtres communs : période (?from&to, ou l'ancien ?month ; null = toutes les périodes,
// 400 avec details.code si mal formée), aléa, région, district.
const str = (v) => (typeof v === 'string' && v ? v : undefined);
const filters = (req) => ({
  period: readPeriod(req.query),
  hazard: str(req.query.hazard),
  region: str(req.query.region),
  district: str(req.query.district),
});
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  offset: z.coerce.number().int().min(0).max(10_000_000).optional(),
});

// ---- Référentiel denrées -------------------------------------------------
router.get('/commodities', asyncHandler(async (req, res) => res.json(await repo.listCommodities(t(req)))));

// ---- Lignes de distribution (liste) --------------------------------------
// Lecture bornée : { rows, total, limit, offset } (2 000 lignes par défaut, 5 000 au plus).
router.get('/distributions', asyncHandler(async (req, res) => {
  const f = filters(req);
  const page = pageQuery.safeParse({ limit: str(req.query.limit), offset: str(req.query.offset) });
  if (!page.success) throw badRequest('Pagination invalide', page.error.flatten());
  res.json(await repo.listDistributions(t(req), f, page.data));
}));

// ---- Synthèse (totaux, par aléa, par mois, arbre zone) -------------------
router.get('/summary', asyncHandler(async (req, res) => res.json(await repo.summaryData(t(req), filters(req)))));

// ---- Pipeline (besoin planifié vs stock disponible, par denrée) ----------
// Sur une période : mois par mois, stock en vigueur chaque mois (dernier saisi ≤ mois).
router.get('/pipeline', asyncHandler(async (req, res) => res.json(await repo.pipelineData(t(req), { period: readPeriod(req.query) }))));

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

// ---- Modèle vierge (même format que l'import, avec note de format) --------
router.get('/template.xlsx', asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Modele_PDD_MEMS2.xlsx"');
  await buildPddTemplate().xlsx.write(res);
  res.end();
}));

// ---- Import du fichier PDD (.xlsx, feuille « PDD base » ou tableau réel) --
// Réimport idempotent : les mois présents dans le fichier sont d'abord vidés.
// La réponse (et le détail d'une erreur 400) porte le résumé d'import : plage
// lue, lignes ignorées avec leur motif, avertissements, mois remplacés. Chaque
// refus porte aussi { code, params, template } : l'interface le traduit.
//
// Tout ou rien par défaut : si une ligne ignorée appartient à un mois que
// l'import va remplacer (ou si son mois est illisible), RIEN n'est écrit — ses
// distributions déjà en base seraient effacées sans être réimportées. Le
// paramètre ?partial=1 (« Importer quand même ») force l'import des lignes valides.
const importQuery = z.object({ partial: z.enum(['0', '1', 'true', 'false']).optional() });

/** Refus motivé (400) : texte français + code, paramètres et modèle pour la traduction. */
function refusal(code, params = {}, details = {}) {
  const m = issue(code, params);
  return badRequest(m.message, { ...details, code: m.code, params: m.params, template: m.template });
}

router.post('/import', WRITE, express.raw({ type: '*/*', limit: '40mb' }), asyncHandler(async (req, res) => {
  const query = importQuery.safeParse(req.query);
  if (!query.success) throw badRequest('Paramètres invalides', query.error.flatten());
  const partial = query.data.partial === '1' || query.data.partial === 'true';
  if (!req.body || !req.body.length) throw refusal('IMPORT_EMPTY_FILE');
  // Format reconnu par les octets, et garde de décompression AVANT ExcelJS
  // (un .xlsx est un zip : quelques Mo peuvent en faire des centaines).
  const sniff = sniffFile(req.body);
  if (sniff.kind !== 'xlsx') throw refusal('IMPORT_NOT_XLSX', { format: sniff.label });
  assertZipEntries(sniff.entries, zipLimitsFromEnv(process.env), { archiveBytes: req.body.length });

  let parsed;
  try { parsed = await parsePddWorkbook(req.body); }
  catch (err) { if (isRefusal(err)) throw err; throw refusal('IMPORT_UNREADABLE'); }
  if (!parsed.sheet) throw refusal('IMPORT_NO_SHEET');
  const report = {
    sheet: parsed.sheet, table: parsed.table, headerRow: parsed.headerRow, firstLine: parsed.firstLine, lastLine: parsed.lastLine,
    months: parsed.months, skipped: parsed.skipped, skippedRows: parsed.skippedRows, blocking: parsed.blocking, warnings: parsed.warnings,
  };
  if (parsed.tooManyRows) throw refusal('IMPORT_TOO_MANY_ROWS', { sheet: parsed.sheet, ...parsed.tooManyRows }, report);
  if (parsed.layoutIssues.length) throw refusal('IMPORT_LAYOUT', { sheet: parsed.sheet }, { ...report, layoutIssues: parsed.layoutIssues });
  if (parsed.rows.length === 0) throw refusal('IMPORT_NO_VALID_ROWS', { skipped: parsed.skipped }, report);
  if (parsed.blocking > 0 && !partial) throw refusal('IMPORT_PARTIAL_REFUSED', { blocking: parsed.blocking }, { ...report, partialAllowed: true });

  const result = await repo.insertDistributions(t(req), uid(req), parsed.rows, { source: 'xlsx', replaceMonths: true });
  res.json({ ...result, ...report, partial: parsed.blocking > 0 });
}));

module.exports = router;
