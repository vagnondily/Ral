const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const repo = require('./reports.repository');
const { buildInvoiceWorkbook } = require('./factureXlsx');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}
const t = (req) => req.auth.tenantId;

router.get('/context', asyncHandler(async (req, res) => res.json(await repo.reportContext(t(req)))));

router.get('/', asyncHandler(async (req, res) =>
  res.json(await repo.listReports(t(req), { month: req.query.month, partnerId: req.query.partnerId, contractId: req.query.contractId }))));

router.get('/:id', asyncHandler(async (req, res) => {
  const report = await repo.getReport(t(req), req.params.id);
  if (!report) throw notFound('Rapport introuvable');
  res.json(report);
}));

// Per-line budget + cumulative funder spend for the on-screen invoice view
// (Budget · Dépenses du mois · Cumulé · Restant).
router.get('/:id/invoice', asyncHandler(async (req, res) => {
  const invoice = await repo.invoiceData(t(req), req.params.id);
  if (!invoice) throw notFound('Rapport introuvable');
  res.json({ budgetByLine: invoice.budgetByLine, cumulByLine: invoice.cumulByLine });
}));

// Export the facture (formal invoice + detailed état des dépenses) as .xlsx.
router.get('/:id/facture.xlsx', asyncHandler(async (req, res) => {
  const invoice = await repo.invoiceData(t(req), req.params.id);
  if (!invoice) throw notFound('Rapport introuvable');
  const { report } = invoice;
  const wb = buildInvoiceWorkbook(invoice);
  const safe = (report.invoiceNo || `${report.partnerName}_${String(report.periodMonth).slice(0, 7)}`).replace(/[^\w.-]+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Facture_${safe}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// A line of the état des dépenses (facture) — quantité × coût unitaire.
const itemSchema = z.object({
  lineCode: z.string().min(2).max(40),
  designation: z.string().trim().min(2).max(200),
  unit: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)),
  unitCount: z.number().nonnegative().max(1e9),
  unitCost: z.number().nonnegative().max(1e13),
  payBy: z.enum(['bailleur', 'ong']).optional(),
  bailleurPct: z.number().min(0).max(1).optional(),
  activityId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  activity2Id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  activity1Pct: z.number().min(0).max(1).optional(),
  site: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  observation: z.string().trim().max(400).optional().or(z.literal('').transform(() => undefined)),
});

const createSchema = z.object({
  partnerId: z.string().uuid(),
  contractId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
  invoiceNo: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
  advanceDeducted: z.number().nonnegative().max(1e13).optional(),
  kind: z.enum(['financier', 'technique']),
  reportedAmount: z.number().nonnegative().max(1e13).optional(),
  plannedAmount: z.number().nonnegative().max(1e13).optional(),
  reference: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  documentName: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
  items: z.array(itemSchema).max(500).optional(),
}).refine(
  (r) => r.kind !== 'financier' || typeof r.reportedAmount === 'number' || (Array.isArray(r.items) && r.items.length > 0),
  { message: 'Un rapport financier doit porter un montant justifié ou un état des dépenses.', path: ['items'] }
);

router.post('/', WRITE, body(createSchema), asyncHandler(async (req, res) => {
  const input = {
    ...req.valid,
    periodMonth: `${req.valid.periodMonth.slice(0, 7)}-01`,
    periodEnd: req.valid.periodEnd ? `${req.valid.periodEnd.slice(0, 7)}-01` : undefined,
    createdBy: req.auth.userId,
  };
  if (input.kind === 'technique') { input.reportedAmount = null; input.items = undefined; }
  try {
    const id = await repo.insertReport(t(req), input);
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === 'DUP') throw conflict('Un rapport de ce type existe déjà pour ce partenaire, ce contrat et ce mois.');
    if (err instanceof Error && /Ligne budgétaire|désignation|invalide|Activité inconnue/.test(err.message)) throw badRequest(err.message);
    throw err;
  }
}));

const itemsSchema = z.object({
  items: z.array(itemSchema).max(500),
  invoiceNo: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
  periodEnd: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
  advanceDeducted: z.number().nonnegative().max(1e13).optional(),
});

router.put('/:id/items', WRITE, body(itemsSchema), asyncHandler(async (req, res) => {
  const opts = {
    invoiceNo: req.valid.invoiceNo,
    periodEnd: req.valid.periodEnd ? `${req.valid.periodEnd.slice(0, 7)}-01` : undefined,
    advanceDeducted: req.valid.advanceDeducted,
  };
  try {
    const id = await repo.replaceReportItems(t(req), req.params.id, req.valid.items, opts);
    if (!id) throw notFound('Rapport introuvable');
    res.status(204).end();
  } catch (err) {
    if (err.code === 'KIND') throw badRequest('Seul un rapport financier porte un état des dépenses.');
    if (err.code === 'LOCKED') throw conflict('Un rapport validé ne peut plus être modifié.');
    if (err instanceof Error && /Ligne budgétaire|désignation|invalide|Activité inconnue/.test(err.message)) throw badRequest(err.message);
    throw err;
  }
}));

// Supprimer un rapport encore en brouillon (non validé). Un rapport validé
// alimente la consommation budgétaire : il est verrouillé.
router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  const outcome = await repo.deleteReport(t(req), req.params.id);
  if (outcome === null) throw notFound('Rapport introuvable');
  if (outcome === 'locked') throw conflict('Un rapport validé ne peut pas être supprimé.');
  res.status(204).end();
}));

const decisionSchema = z.object({ comment: z.string().trim().max(1000).optional() });

router.post('/:id/approve', body(decisionSchema), asyncHandler(async (req, res) => {
  if (!(await repo.setStatus(t(req), req.params.id, 'valide', req.auth.userId, req.valid.comment))) throw notFound('Rapport introuvable');
  res.status(204).end();
}));

router.post('/:id/reject', body(decisionSchema), asyncHandler(async (req, res) => {
  if (!req.valid.comment) throw badRequest('Un motif est obligatoire pour rejeter.');
  if (!(await repo.setStatus(t(req), req.params.id, 'rejete', req.auth.userId, req.valid.comment))) throw notFound('Rapport introuvable');
  res.status(204).end();
}));

module.exports = router;
