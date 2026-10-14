const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const repo = require('./sitesAdmin.repository');
const { buildWorkbook, parseSitesWorkbook } = require('./sitesXlsx');
const { isRefusal } = require('../common/xlsxGuard');

const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const str = (max) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const lat = z.number().min(-90).max(90).nullable().optional();
const lng = z.number().min(-180).max(180).nullable().optional();

// Un site exige au moins une localité (nom). District/commune peuvent venir de
// l'attribution GPS ensuite.
const createSchema = z.object({
  identifiant: str(120),
  localite: z.string().trim().min(1).max(200),
  codePoi: str(60),
  fieldOfficeId: z.string().uuid().nullable().optional(),
  region: str(120), district: str(120), commune: str(120), fokontany: str(120),
  activityTag: str(160), tagCode: str(60),
  lat, lng,
});
const updateSchema = createSchema.partial().extend({ localite: str(200) });

// Modèle Excel vide (en-têtes fidèles à la demande).
router.get('/template.xlsx', asyncHandler(async (req, res) => {
  const wb = buildWorkbook({ title: 'Registre des sites — modèle (MEMS 2.0)', sites: [] });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Modele_sites_MEMS2.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

// Export des sites existants (mêmes colonnes).
router.get('/export.xlsx', asyncHandler(async (req, res) => {
  const sites = await repo.listSites(t(req), { q: req.query.q, limit: 5000 });
  const wb = buildWorkbook({ title: 'Registre des sites (MEMS 2.0)', sites });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Sites_MEMS2.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

// Import depuis un classeur rempli (upsert par identifiant). Rien d'autre côté
// client : le résultat annonce créés / mis à jour / ignorés.
router.post('/import', WRITE, express.raw({ type: '*/*', limit: '20mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let parsed;
  try {
    parsed = await parseSitesWorkbook(req.body);
  } catch (err) {
    if (isRefusal(err)) throw err;
    if (err && err.code === 'NO_SHEET') throw badRequest('Le fichier ne contient pas de feuille de sites. Téléchargez et remplissez le modèle.');
    if (err && err.code === 'NO_HEADER') throw badRequest('En-têtes introuvables : la 1re ligne doit contenir « Identifiant » / « Localité ». Utilisez le modèle.');
    throw badRequest('Fichier Excel illisible ou format non reconnu (utilisez le modèle).');
  }
  if (!parsed.rows.length) {
    throw badRequest(parsed.skipped.length
      ? `Aucun site valide. ${parsed.skipped.length} ligne(s) ignorée(s) : ${parsed.skipped.slice(0, 3).map((s) => `L${s.row} — ${s.reason}`).join(' ; ')}`
      : 'Aucun site trouvé dans le fichier.');
  }
  const result = await repo.importSites(t(req), parsed.rows);
  result.skipped = [...parsed.skipped, ...(result.skipped || [])];
  res.json(result);
}));

// Liste complète (colonnes de la page). Lecture pour tout utilisateur du tenant.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await repo.listSites(t(req), { q: req.query.q, limit: req.query.limit, offset: req.query.offset }));
}));

router.post('/', WRITE, body(createSchema), asyncHandler(async (req, res) => {
  try {
    res.status(201).json(await repo.createSite(t(req), req.valid));
  } catch (e) {
    if (e && e.code === 'DUP') throw conflict('Un site avec cet identifiant (ou même district + commune + nom) existe déjà.', { siteId: e.siteId });
    throw e;
  }
}));

router.patch('/:id', WRITE, body(updateSchema), asyncHandler(async (req, res) => {
  if (!(await repo.updateSite(t(req), req.params.id, req.valid))) throw notFound('Site introuvable');
  res.status(204).end();
}));

router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  const outcome = await repo.deleteSite(t(req), req.params.id);
  if (outcome === 'not_found') throw notFound('Site introuvable');
  if (outcome === 'linked') throw conflict('Ce site porte des visites : il ne peut pas être supprimé (désactivez-le ou retirez ses visites).');
  res.status(204).end();
}));

// Attribution automatique de la zone depuis le GPS (centroïde le plus proche).
// { ids?: uuid[] } pour cibler, sinon tous les sites géolocalisés ; onlyEmpty
// pour ne compléter que les sites sans commune.
const attrSchema = z.object({
  ids: z.array(z.string().uuid()).max(10000).optional(),
  onlyEmpty: z.boolean().optional(),
});
router.post('/auto-attribute', WRITE, body(attrSchema), asyncHandler(async (req, res) => {
  res.json(await repo.autoAttribute(t(req), { ids: req.valid.ids || null, onlyEmpty: !!req.valid.onlyEmpty }));
}));

module.exports = router;
