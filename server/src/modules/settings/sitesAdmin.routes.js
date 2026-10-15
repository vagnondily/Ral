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
const uuid = z.string().uuid();
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

/** « 3 visite(s), 12 soumission(s)… » : ce qui empêche la suppression d'un site. */
function linkedText(l) {
  const parts = [];
  if (l.visits) parts.push(`${l.visits} visite(s)`);
  if (l.submissions) parts.push(`${l.submissions} soumission(s) rattachée(s)`);
  if (l.activation) parts.push(`${l.activation} mois dans la grille des sites actifs`);
  if (l.assignments) parts.push(`${l.assignments} affectation(s)`);
  return parts.join(', ');
}

router.delete('/:id', WRITE, asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw notFound('Site introuvable');
  const r = await repo.deleteSite(t(req), id.data);
  if (r.outcome === 'not_found') throw notFound('Site introuvable');
  if (r.outcome === 'linked') {
    throw conflict(`Ce site porte des données (${linkedText(r.linked)}) : il ne peut pas être supprimé. Marquez-le inactif dans la grille des sites actifs.`, { linked: r.linked });
  }
  res.status(204).end();
}));

// Actions groupées sur une sélection (retour 62) : supprimer (sites sans donnée reliée) ou
// changer l'activité / le bureau. Tout-ou-rien, une transaction.
const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  action: z.enum(['delete', 'set']),
  patch: z.object({
    activityTag: z.string().trim().max(160).nullable().optional(),
    fieldOfficeId: z.string().uuid().nullable().optional(),
  }).optional(),
}).refine((b) => b.action !== 'set' || (b.patch && (b.patch.activityTag !== undefined || b.patch.fieldOfficeId !== undefined)),
  { message: 'Indiquez l\'activité ou le bureau à appliquer.' });
router.post('/bulk', WRITE, body(bulkSchema), asyncHandler(async (req, res) => {
  const ids = [...new Set(req.valid.ids)];
  try {
    const r = await repo.bulkSites(t(req), { ids, action: req.valid.action, patch: req.valid.patch || {} });
    if (r.sample) r.sample = r.sample.map((x) => ({ ...x, reason: linkedText(x.counts) }));
    res.json(r);
  } catch (e) {
    if (e && e.code === 'BAD_OFFICE') throw badRequest('Bureau inconnu.');
    throw e;
  }
}));

// Aperçu d'une suppression groupée (retour 89), sans rien écrire : combien de
// sites seraient supprimés, combien gardés car ils portent des données, et pourquoi.
router.post('/bulk/preview', WRITE, body(z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) })), asyncHandler(async (req, res) => {
  const r = await repo.previewBulkDelete(t(req), [...new Set(req.valid.ids)]);
  r.sample = r.sample.map((x) => ({ ...x, reason: linkedText(x.counts) }));
  res.json(r);
}));

// Export d'une sélection (mêmes colonnes que l'export complet).
router.post('/export.xlsx', body(z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) })), asyncHandler(async (req, res) => {
  const sites = await repo.listSites(t(req), { ids: [...new Set(req.valid.ids)], limit: 5000 });
  const wb = buildWorkbook({ title: 'Registre des sites — sélection (MEMS 2.0)', sites });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Sites_selection_MEMS2.xlsx"');
  await wb.xlsx.write(res);
  res.end();
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
