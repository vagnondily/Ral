const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const repo = require('./partners.repository');
const service = require('./partners.service');
const { readPeriod } = require('../../middleware/period');
const { PERIOD_CAPS } = require('../common/periodCaps');

/**
 * Partenaires & TPM — fiche 360°, frise du parcours, équipe (lot E de
 * docs/REFONTE_UX.md). Le tenant vient UNIQUEMENT de req.auth.
 */
const router = Router();
router.use(requireAuth);
// Le responsable S&E (gestionnaire) gère les agents (décision 8.6 adoptée par défaut).
const WRITE = requireRole('admin', 'manager');
const canWrite = (req) => ['admin', 'manager'].includes(req.auth.role);
const t = (req) => req.auth.tenantId;
const currentMonth = () => new Date().toISOString().slice(0, 7);

const uuid = z.string().uuid();
function ids(...names) {
  return (req, res, next) => {
    for (const n of names) if (!uuid.safeParse(req.params[n]).success) return next(badRequest('Identifiant invalide'));
    return next();
  };
}
function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ').nullable().optional().or(z.literal('').transform(() => null));
const email = z.string().trim().email('Courriel invalide').max(160).nullable().optional().or(z.literal('').transform(() => null));

// Listes de choix des prestataires (retour 30) : « actif selon contrat » pour les mois demandés
// (?month= ou ?from=&to=, mois courant par défaut), puis les autres TPM actifs.
router.get('/selectable', asyncHandler(async (req, res) => {
  const period = readPeriod(req.query, { maxSpan: PERIOD_CAPS.document }) || { from: currentMonth(), to: currentMonth() };
  res.json(await service.selectable(t(req), period));
}));

// Liste des partenaires (onglet « Prestataires TPM ») : compteurs et statut selon contrat.
router.get('/providers', asyncHandler(async (req, res) => res.json(await service.providers(t(req)))));

router.get('/:id/sheet', ids('id'), asyncHandler(async (req, res) => {
  const s = await service.sheet(t(req), req.params.id);
  if (!s) throw notFound('Partenaire introuvable');
  if (!canWrite(req)) { s.partner.contactPhone = null; s.partner.contactEmail = null; }
  res.json(s);
}));

router.get('/:id/contracts', ids('id'), asyncHandler(async (req, res) => {
  const rows = await service.contracts(t(req), req.params.id);
  if (!rows) throw notFound('Partenaire introuvable');
  res.json(rows);
}));

router.get('/:id/reports', ids('id'), asyncHandler(async (req, res) => {
  const rows = await service.reports(t(req), req.params.id);
  if (!rows) throw notFound('Partenaire introuvable');
  res.json(rows);
}));

// Suivis effectués : visites et formulaires reçus du prestataire (12 derniers mois par défaut).
router.get('/:id/followups', ids('id'), asyncHandler(async (req, res) => {
  const period = readPeriod(req.query, { maxSpan: PERIOD_CAPS.facts });
  const r = await service.followups(t(req), req.params.id, period, currentMonth());
  if (!r) throw notFound('Partenaire introuvable');
  res.json(r);
}));

router.get('/:id/timeline', ids('id'), asyncHandler(async (req, res) => {
  const before = req.query.before ? z.string().datetime({ offset: true }).safeParse(req.query.before) : { success: true, data: null };
  if (!before.success) throw badRequest('Curseur invalide.');
  const r = await service.timeline(t(req), req.params.id, { before: before.data, limit: 50 });
  if (!r) throw notFound('Partenaire introuvable');
  res.json(r);
}));

const partnerPatch = z.object({
  name: z.string().trim().min(2).max(160).optional(), shortName: optText(40), dailyRate: z.number().nonnegative().max(1e12).nullable().optional(),
  legalId: optText(80), address: optText(300), contactName: optText(120), contactPhone: optText(40), contactEmail: email,
  startedOn: optDate, notes: optText(2000), active: z.boolean().optional(),
}).strict();
router.patch('/:id', WRITE, ids('id'), body(partnerPatch), asyncHandler(async (req, res) => {
  if (!(await repo.updatePartner(t(req), req.params.id, req.valid))) throw notFound('Partenaire introuvable');
  res.status(204).end();
}));

router.get('/:id/agents', ids('id'), asyncHandler(async (req, res) => {
  const rows = await repo.listAgents(t(req), req.params.id, { personal: canWrite(req) });
  if (!rows) throw notFound('Partenaire introuvable');
  res.json(rows);
}));

const agentFields = {
  fonction: optText(120), code: optText(60), phone: optText(40), email, sex: z.enum(['F', 'M']).nullable().optional(),
  startedOn: optDate, endedOn: optDate,
};
const agentCreate = z.object({ name: z.string().trim().min(2).max(160), ...agentFields, active: z.boolean().optional() }).strict()
  .refine((a) => !a.startedOn || !a.endedOn || a.endedOn >= a.startedOn, { message: 'La sortie doit suivre l\'entrée.', path: ['endedOn'] });
const agentPatch = z.object({ name: z.string().trim().min(2).max(160).optional(), ...agentFields, active: z.boolean().optional() }).strict()
  .refine((a) => !a.startedOn || !a.endedOn || a.endedOn >= a.startedOn, { message: 'La sortie doit suivre l\'entrée.', path: ['endedOn'] });

router.post('/:id/agents', WRITE, ids('id'), body(agentCreate), asyncHandler(async (req, res) => {
  res.status(201).json(await repo.createAgent(t(req), req.params.id, req.valid));
}));
router.patch('/:id/agents/:agentId', WRITE, ids('id', 'agentId'), body(agentPatch), asyncHandler(async (req, res) => {
  if (!(await repo.updateAgent(t(req), req.params.id, req.params.agentId, req.valid))) throw notFound('Agent introuvable');
  res.status(204).end();
}));
router.delete('/:id/agents/:agentId', WRITE, ids('id', 'agentId'), asyncHandler(async (req, res) => {
  if (!(await repo.deleteAgent(t(req), req.params.id, req.params.agentId))) throw notFound('Agent introuvable');
  res.status(204).end();
}));

module.exports = router;
