const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict, forbidden } = require('../../middleware/errors');
const repo = require('./reports.repository');
const { readPeriod } = require('../../middleware/period');
const { buildInvoiceWorkbook } = require('./factureXlsx');
const { reportActions, REPORT_WRITE_ROLES, canWriteReports } = require('./reportWorkflow');

const router = Router();
router.use(requireAuth);
// Rôles d'écriture : la liste partagée avec le Centre d'alertes (reportWorkflow).
const WRITE = requireRole(...REPORT_WRITE_ROLES);

// Chaque rapport renvoyé porte les actions permises à l'utilisateur courant,
// calculées par les règles qui s'appliquent à l'écriture (reportWorkflow).
const withActions = (req) => (report) => ({
  ...report,
  actions: reportActions(report, { userId: req.auth.userId, canWrite: canWriteReports(req.auth.role) }),
});

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

// Liste : ?from&to (ou l'ancien ?month) — rapports dont la période chevauche ; sans période, tous.
const idQ = (v) => (typeof v === 'string' && v ? v : undefined);
router.get('/', asyncHandler(async (req, res) => {
  const period = readPeriod(req.query);
  for (const k of ['partnerId', 'contractId']) {
    if (idQ(req.query[k]) && !z.string().uuid().safeParse(req.query[k]).success) throw badRequest('Filtres invalides', { field: k });
  }
  const rows = await repo.listReports(t(req), { period, partnerId: idQ(req.query.partnerId), contractId: idQ(req.query.contractId) });
  res.json(rows.map(withActions(req)));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const report = await repo.getReport(t(req), req.params.id);
  if (!report) throw notFound('Rapport introuvable');
  res.json(withActions(req)(report));
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
    userId: req.auth.userId, // seul l'auteur modifie un brouillon ; le premier qui remplit un gabarit en devient l'auteur
  };
  try {
    const id = await repo.replaceReportItems(t(req), req.params.id, req.valid.items, opts);
    if (!id) throw notFound('Rapport introuvable');
    res.status(204).end();
  } catch (err) {
    if (err.code === 'KIND') throw badRequest('Seul un rapport financier porte un état des dépenses.');
    if (err.code === 'LOCKED') throw conflict(err.message);
    if (err.code === 'AUTHOR') throw forbidden(err.message);
    if (err instanceof Error && /Ligne budgétaire|désignation|invalide|Activité inconnue/.test(err.message)) throw badRequest(err.message);
    throw err;
  }
}));

// Génère les gabarits mensuels (financier « attendu ») d'un contrat × TPM
// pour toute sa durée — à remplir ou à marquer non applicable ensuite.
const stubSchema = z.object({ contractId: z.string().uuid(), partnerId: z.string().uuid() });
router.post('/generate-monthly', WRITE, body(stubSchema), asyncHandler(async (req, res) => {
  try {
    const r = await repo.generateMonthlyStubs(t(req), { ...req.valid, createdBy: req.auth.userId });
    res.json(r);
  } catch (err) {
    if (err.code === 'NOCONTRACT') throw notFound('Contrat introuvable');
    throw err;
  }
}));

// Soumettre un rapport « attendu » ou « rejeté » (machine d'états
// reportWorkflow) : 403 si l'acteur n'en est pas l'auteur, 409 si la
// transition est interdite ou si la facture ne porte encore aucun poste. Le
// soumetteur ne pourra ni valider ni rejeter.
router.post('/:id/submit', WRITE, asyncHandler(async (req, res) => {
  const r = await repo.submitReport(t(req), req.params.id, req.auth.userId);
  if (r.error === 'not_found') throw notFound('Rapport introuvable');
  if (r.error === 'author') throw forbidden(r.message);
  if (r.error) throw conflict(r.message);
  res.status(204).end();
}));

// Marquer un rapport « non applicable » (aucun suivi ce mois). Interdit sur un
// rapport déjà validé.
router.post('/:id/not-applicable', WRITE, asyncHandler(async (req, res) => {
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : null;
  const r = await repo.markNotApplicable(t(req), req.params.id, req.auth.userId, comment);
  if (r.error === 'not_found') throw notFound('Rapport introuvable');
  if (r.error === 'locked') throw conflict('Un rapport validé ne peut pas être marqué non applicable.');
  res.status(204).end();
}));

// Suppression (politique commune, retour 56) : un rapport non validé est
// supprimable après confirmation ; un rapport validé seulement sans donnée
// reliée (montant ≠ 0 ou postes) et avec un justificatif. Toute suppression
// est inscrite au journal des suppressions.
router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  const justification = typeof req.body?.justification === 'string' ? req.body.justification : undefined;
  const outcome = await repo.deleteReport(t(req), req.params.id, { actorId: req.auth.userId, justification });
  if (outcome === null) throw notFound('Rapport introuvable');
  if (outcome === 'linked_data') throw conflict('Ce rapport est validé et porte des dépenses comptées : il ne peut pas être supprimé.');
  if (outcome === 'justification_required') throw badRequest('Un justificatif est obligatoire pour supprimer un rapport validé.');
  res.status(204).end();
}));

const decisionSchema = z.object({ comment: z.string().trim().max(1000).optional() });

// Décision réservée aux gestionnaires (admin / validateur), sur un rapport soumis,
// par une autre personne que celle qui l'a soumis ou en a rempli le contenu.
async function decide(req, status) {
  const r = await repo.setStatus(t(req), req.params.id, status, req.auth.userId, req.valid.comment);
  if (r.error === 'not_found') throw notFound('Rapport introuvable');
  if (r.error === 'status') throw conflict(r.message);
  if (r.error === 'self') throw forbidden(r.message);
}

router.post('/:id/approve', WRITE, body(decisionSchema), asyncHandler(async (req, res) => {
  await decide(req, 'valide');
  res.status(204).end();
}));

router.post('/:id/reject', WRITE, body(decisionSchema), asyncHandler(async (req, res) => {
  if (!req.valid.comment) throw badRequest('Un motif est obligatoire pour rejeter.');
  await decide(req, 'rejete');
  res.status(204).end();
}));

module.exports = router;
