const express = require('express');
const { Router } = require('express');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const service = require('./contracts.service');
const v = require('./contracts.validation');
const { parseFlaBudget } = require('./budgetImport');

const router = Router();
router.use(requireAuth);

const WRITE = requireRole('admin', 'manager');

/** Validates req[source] with a zod schema; 400 with field details on failure. */
function body(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const actor = (req) => ({ userId: req.auth.userId, role: req.auth.role });
const t = (req) => req.auth.tenantId;

router.get('/', body(v.listQuerySchema, 'query'), asyncHandler(async (req, res) => {
  res.json(await service.listContracts(t(req), req.valid));
}));

router.get('/validators', asyncHandler(async (req, res) => {
  res.json(await service.listValidators(t(req), actor(req)));
}));

router.post('/', WRITE, body(v.createContractSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.createContract(t(req), actor(req), req.valid));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await service.getContractDetail(t(req), req.params.id, actor(req)));
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  res.json(await service.getHistory(t(req), req.params.id));
}));

// Import d'un budget FLA (.xlsx du template) → postes extraits pour
// pré-remplir le formulaire de contrat (aucune écriture en base).
router.post('/import-budget', WRITE, express.raw({ type: '*/*', limit: '20mb' }),
  asyncHandler(async (req, res) => {
    if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
    let parsed;
    try {
      parsed = await parseFlaBudget(req.body);
    } catch {
      throw badRequest('Fichier Excel illisible ou format non reconnu.');
    }
    if (!parsed.items.length) throw badRequest('Aucun poste budgétaire trouvé dans le fichier (feuilles « Détails Section … »).');
    res.json(parsed);
  }));

// Budget FLA au format Excel du template, formules incrustées.
router.get('/:id/budget.xlsx', asyncHandler(async (req, res) => {
  const { buffer, filename } = await service.budgetWorkbook(t(req), req.params.id);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}));

router.put('/:id', WRITE, body(v.updateContractSchema), asyncHandler(async (req, res) => {
  await service.updateDraft(t(req), actor(req), req.params.id, req.valid);
  res.status(204).end();
}));

router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  await service.deleteDraft(t(req), actor(req), req.params.id);
  res.status(204).end();
}));

router.post('/:id/submit', WRITE, body(v.submitSchema), asyncHandler(async (req, res) => {
  await service.submit(t(req), actor(req), req.params.id, req.valid);
  res.status(204).end();
}));

router.post('/:id/approve', body(v.decisionSchema), asyncHandler(async (req, res) => {
  await service.decide(t(req), actor(req), req.params.id, { ...req.valid, approve: true });
  res.status(204).end();
}));

router.post('/:id/reject', body(v.decisionSchema), asyncHandler(async (req, res) => {
  await service.decide(t(req), actor(req), req.params.id, { ...req.valid, approve: false });
  res.status(204).end();
}));

router.post('/:id/amendments', WRITE, body(v.amendmentSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.requestAmendment(t(req), actor(req), req.params.id, req.valid));
}));

router.post('/:id/amendments/:amendmentId/approve', body(v.decisionSchema), asyncHandler(async (req, res) => {
  await service.decideAmendment(t(req), actor(req), req.params.id, req.params.amendmentId, { ...req.valid, approve: true });
  res.status(204).end();
}));

router.post('/:id/amendments/:amendmentId/reject', body(v.decisionSchema), asyncHandler(async (req, res) => {
  await service.decideAmendment(t(req), actor(req), req.params.id, req.params.amendmentId, { ...req.valid, approve: false });
  res.status(204).end();
}));

router.post('/:id/renew', WRITE, body(v.renewSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await service.renew(t(req), actor(req), req.params.id, req.valid));
}));

router.post('/:id/terminate', WRITE, body(v.terminateSchema), asyncHandler(async (req, res) => {
  await service.terminate(t(req), actor(req), req.params.id, req.valid);
  res.status(204).end();
}));

module.exports = router;
