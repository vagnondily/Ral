const express = require('express');

const { Router } = express;
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const repo = require('./reports.repository');
const service = require('./reports.service');
const assets = require('./reportAssets.service');

/**
 * Concepteur de rapport : catalogue (blocs, jeux de données, chiffres clés, modèles
 * système), modèles personnalisés, documents (brouillon → finalisé), rendu des
 * données, export Excel. Lecture : tout utilisateur ; écriture : admin / validateur.
 * Les documents sont des rapports v2 (lot 7a) ; un contenu v1 est mis à niveau à la
 * lecture et à la validation, l'enregistrement écrit du v2.
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId;
// Langue du rendu (libellé de période, bulletin auto-rédigé, notes) : celle de l'interface.
const lang = (req) => ({ lang: req.query.lang === 'en' ? 'en' : 'fr', log: req.log });
const uuid = (v) => { if (!z.string().uuid().safeParse(v).success) throw badRequest('Identifiant invalide'); return v; };

router.get('/catalog', (req, res) => res.json(service.catalog()));

// Rendu des données d'un rapport (non enregistré ou en cours d'édition) — complet (exports, compatibilité).
router.post('/render', asyncHandler(async (req, res) => res.json(await service.renderReport(t(req), req.body, lang(req)))));

/** En-tête Server-Timing (outils du navigateur) : plan et durée de chaque bloc. */
function serverTiming(planMs, timings) {
  const parts = [`plan;dur=${Math.round(planMs)}`];
  timings.forEach((x, i) => parts.push(`blk${i};dur=${Math.round(x.ms)};desc="${String(x.iid).replace(/[^\w~:.-]/g, '_').slice(0, 80)}${x.ok ? '' : ' (erreur)'}"`));
  return parts.join(', ');
}

// Rendu progressif (lot 7a) : le PLAN d'abord (sans calcul lourd), puis les blocs par lots de 8.
router.post('/render/plan', asyncHandler(async (req, res) => {
  const plan = await service.renderPlanFor(t(req), req.body && req.body.doc, lang(req));
  res.setHeader('Server-Timing', `plan;dur=${Math.round(plan.ms)}`);
  res.json(plan);
}));
router.post('/render/blocks', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const r = await service.renderBlocks(t(req), body.doc, body.iids, lang(req));
  res.setHeader('Server-Timing', serverTiming(r.planMs, r.timings));
  req.log.info({ report: { blocks: r.timings, planMs: r.planMs } }, 'report.blocks');
  res.json({ blocks: r.blocks });
}));

router.post('/export.xlsx', asyncHandler(async (req, res) => {
  const wb = await service.exportXlsx(t(req), req.body, lang(req));
  const name = String(req.body && req.body.title || 'Rapport').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Rapport';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// ---- Images des en-têtes et pieds de page (logos, migration 062) -------------------
// Octets bruts (600 Ko au plus reçus ; 512 Ko au plus acceptés, PNG ou JPEG reconnus par les octets).
router.get('/assets', asyncHandler(async (req, res) => res.json(await assets.listAssets(t(req)))));
router.post('/assets', WRITE, express.raw({ type: '*/*', limit: '600kb' }), asyncHandler(async (req, res) => {
  const r = await assets.uploadAsset(t(req), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { name: req.query.name, userId: uid(req) });
  res.status(r.created ? 201 : 200).json(r.asset);
}));
router.get('/assets/:id', asyncHandler(async (req, res) => {
  const a = await assets.getAsset(t(req), uuid(req.params.id));
  // Type déduit des octets à l'envoi ; jamais interprété autrement (nosniff), aucun script possible (CSP).
  res.set({
    'Content-Type': a.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline',
  });
  res.send(a.data);
}));

// « Mes en-têtes » : en-têtes et pieds de page enregistrés par le compte, réutilisables.
router.get('/band-templates', asyncHandler(async (req, res) => res.json(await assets.listBandTemplates(t(req)))));
router.post('/band-templates', WRITE, asyncHandler(async (req, res) => res.status(201).json(await assets.saveBandTemplate(t(req), req.body, uid(req)))));
router.delete('/band-templates/:id', WRITE, asyncHandler(async (req, res) => res.json(await assets.deleteBandTemplate(t(req), uuid(req.params.id)))));

// ---- Modèles personnalisés -----------------------------------------------------
const tplBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional(), content: z.any() });
const parseTpl = async (tenantId, body) => {
  const b = tplBody.safeParse(body);
  if (!b.success) throw badRequest('Données invalides', b.error.flatten());
  return { ...b.data, content: (await service.normalizeDoc(tenantId, b.data.content)).doc };
};
router.get('/templates', asyncHandler(async (req, res) => res.json(await service.listTemplates(t(req)))));
router.post('/templates', WRITE, asyncHandler(async (req, res) => res.status(201).json(await repo.createTemplate(t(req), await parseTpl(t(req), req.body), uid(req)))));
router.put('/templates/:id', WRITE, asyncHandler(async (req, res) => res.json(await repo.updateTemplate(t(req), uuid(req.params.id), await parseTpl(t(req), req.body)))));
router.delete('/templates/:id', WRITE, asyncHandler(async (req, res) => res.json(await repo.deleteTemplate(t(req), uuid(req.params.id)))));

// ---- Documents ---------------------------------------------------------------------
router.get('/documents', asyncHandler(async (req, res) => res.json(await repo.listDocuments(t(req)))));
router.get('/documents/:id', asyncHandler(async (req, res) => res.json(await service.getDocument(t(req), uuid(req.params.id)))));
router.get('/documents/:id/data', asyncHandler(async (req, res) => res.json(await service.documentData(t(req), uuid(req.params.id), lang(req)))));
router.post('/documents', WRITE, asyncHandler(async (req, res) => {
  const { doc } = await service.normalizeDoc(t(req), req.body && req.body.content);
  const templateKey = typeof req.body.templateKey === 'string' ? req.body.templateKey.slice(0, 60) : null;
  res.status(201).json(await repo.createDocument(t(req), { content: doc, templateKey }, uid(req)));
}));
const version = (body) => { const v = Number(body && body.version); if (!Number.isInteger(v) || v < 1) throw badRequest('Version manquante'); return v; };
router.put('/documents/:id', WRITE, asyncHandler(async (req, res) => {
  const { doc } = await service.normalizeDoc(t(req), req.body && req.body.content);
  res.json(await repo.updateDocument(t(req), uuid(req.params.id), { content: doc, version: version(req.body) }, uid(req)));
}));
router.post('/documents/:id/finalize', WRITE, asyncHandler(async (req, res) =>
  res.json(await service.finalize(t(req), uuid(req.params.id), version(req.body), uid(req), lang(req)))));
router.delete('/documents/:id', WRITE, asyncHandler(async (req, res) => res.json(await repo.deleteDocument(t(req), uuid(req.params.id), { allowFinal: req.auth.role === 'admin' }))));

module.exports = router;
