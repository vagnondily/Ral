const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const repo = require('./quarterly.repository');
const { buildQuarterlyWorkbook } = require('./quarterlyXlsx');

/**
 * Dashboard décisionnel › Rapport trimestriel (retour 54) — lecture seule, tout utilisateur
 * du compte. GET /api/dashboards/quarterly?year=2026&officeId=… ; …/quarterly.xlsx (même tableau).
 */
const router = Router();
router.use(requireAuth);
const t = (req) => req.auth.tenantId;
const query = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(() => new Date().getUTCFullYear()),
  officeId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
});
function opts(req) {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) throw badRequest('Paramètres invalides (année AAAA, bureau).', parsed.error.flatten());
  return { year: parsed.data.year, officeId: parsed.data.officeId || null };
}

router.get('/quarterly', asyncHandler(async (req, res) => res.json(await repo.quarterlyReport(t(req), opts(req)))));

router.get('/quarterly.xlsx', asyncHandler(async (req, res) => {
  const o = opts(req);
  const table = await repo.quarterlyReport(t(req), o);
  const wb = buildQuarterlyWorkbook(table);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Rapport_trimestriel_${o.year}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
