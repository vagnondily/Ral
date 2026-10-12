const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const repo = require('./reports.repository');
const service = require('./reports.service');

/**
 * Concepteur de rapport : catalogue (blocs, jeux de données, modèles système),
 * modèles personnalisés, documents (brouillon → finalisé), rendu des données,
 * export Excel. Lecture : tout utilisateur ; écriture : admin / validateur.
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId;
const uuid = (v) => { if (!z.string().uuid().safeParse(v).success) throw badRequest('Identifiant invalide'); return v; };

router.get('/catalog', (req, res) => res.json(service.catalog()));

// Rendu des données d'un rapport (non enregistré ou en cours d'édition).
router.post('/render', asyncHandler(async (req, res) => res.json(await service.renderReport(t(req), req.body))));

router.post('/export.xlsx', asyncHandler(async (req, res) => {
  const wb = await service.exportXlsx(t(req), req.body);
  const name = String(req.body && req.body.title || 'Rapport').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Rapport';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// ---- Modèles personnalisés -----------------------------------------------------
const tplBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional(), content: z.any() });
const parseTpl = (body) => {
  const b = tplBody.safeParse(body);
  if (!b.success) throw badRequest('Données invalides', b.error.flatten());
  return { ...b.data, content: service.validate(b.data.content) };
};
router.get('/templates', asyncHandler(async (req, res) => res.json(await repo.listTemplates(t(req)))));
router.post('/templates', WRITE, asyncHandler(async (req, res) => res.status(201).json(await repo.createTemplate(t(req), parseTpl(req.body), uid(req)))));
router.put('/templates/:id', WRITE, asyncHandler(async (req, res) => res.json(await repo.updateTemplate(t(req), uuid(req.params.id), parseTpl(req.body)))));
router.delete('/templates/:id', WRITE, asyncHandler(async (req, res) => res.json(await repo.deleteTemplate(t(req), uuid(req.params.id)))));

// ---- Documents ---------------------------------------------------------------------
router.get('/documents', asyncHandler(async (req, res) => res.json(await repo.listDocuments(t(req)))));
router.get('/documents/:id', asyncHandler(async (req, res) => res.json(await repo.getDocument(t(req), uuid(req.params.id)))));
router.get('/documents/:id/data', asyncHandler(async (req, res) => res.json(await service.documentData(t(req), uuid(req.params.id)))));
router.post('/documents', WRITE, asyncHandler(async (req, res) => {
  const content = service.validate(req.body && req.body.content);
  const templateKey = typeof req.body.templateKey === 'string' ? req.body.templateKey.slice(0, 60) : null;
  res.status(201).json(await repo.createDocument(t(req), { content, templateKey }, uid(req)));
}));
const version = (body) => { const v = Number(body && body.version); if (!Number.isInteger(v) || v < 1) throw badRequest('Version manquante'); return v; };
router.put('/documents/:id', WRITE, asyncHandler(async (req, res) => {
  const content = service.validate(req.body && req.body.content);
  res.json(await repo.updateDocument(t(req), uuid(req.params.id), { content, version: version(req.body) }, uid(req)));
}));
router.post('/documents/:id/finalize', WRITE, asyncHandler(async (req, res) =>
  res.json(await service.finalize(t(req), uuid(req.params.id), version(req.body), uid(req)))));
router.delete('/documents/:id', WRITE, asyncHandler(async (req, res) => res.json(await repo.deleteDocument(t(req), uuid(req.params.id)))));

module.exports = router;
