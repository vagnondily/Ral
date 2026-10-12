const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, conflict } = require('../../middleware/errors');
const repo = require('./settings.repository');
const { parseUpload } = require('./adminImport');
const loc = require('./localities.repository');
const places = require('./placeMatch.repository');
const { configHealth } = require('./health.repository');
const { directoryCsv } = require('./localities.domain');
const { buildMmrWorkbook, parseMmrWorkbook } = require('../tpm/mmrXlsx');
const { isRefusal } = require('../common/xlsxGuard');

const router = Router();
router.use(requireAuth);
const ADMIN = requireRole('admin');
const WRITE = requireRole('admin', 'manager');

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}

const slug = z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/i, 'Code : lettres, chiffres, tiret/underscore');
const label = z.string().trim().min(2).max(120);
const t = (req) => req.auth.tenantId;

// ---- Partner types
router.get('/partner-types', asyncHandler(async (req, res) => res.json(await repo.listPartnerTypes(t(req)))));
router.post('/partner-types', ADMIN, body(z.object({ code: slug, label, sortOrder: z.number().int().optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await repo.createPartnerType(t(req), req.valid))));

// ---- Activities
router.get('/activities', asyncHandler(async (req, res) =>
  res.json(await repo.listActivities(t(req), { activeOnly: req.query.active === 'true' }))));
router.post('/activities', ADMIN, body(z.object({ code: slug, label, sortOrder: z.number().int().optional() })),
  asyncHandler(async (req, res) => res.status(201).json(await repo.createActivity(t(req), req.valid))));
router.patch('/activities/:id', ADMIN, body(z.object({ active: z.boolean() })), asyncHandler(async (req, res) => {
  const ok = await repo.setActivityActive(t(req), req.params.id, req.valid.active);
  if (!ok) return res.status(404).json({ error: 'Activité introuvable' });
  return res.status(204).end();
}));

// ---- Exchange rates (ariary pour 1 USD), horodatés — lecture pour tous,
// écriture admin. Sert à « regarder les valeurs en dollars selon la période ».
router.get('/exchange-rates', asyncHandler(async (req, res) => res.json(await repo.listExchangeRates(t(req)))));
const rateBody = z.object({
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Mois AAAA-MM requis'),
  usdRate: z.number().positive().max(1e9),
  note: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
});
router.post('/exchange-rates', ADMIN, body(rateBody), asyncHandler(async (req, res) =>
  res.status(201).json(await repo.upsertExchangeRate(t(req), req.valid, req.auth.userId))));
router.delete('/exchange-rates/:id', ADMIN, asyncHandler(async (req, res) => {
  if (!(await repo.deleteExchangeRate(t(req), req.params.id))) return res.status(404).json({ error: 'Taux introuvable' });
  return res.status(204).end();
}));

// ---- Bureaux & antennes — lecture pour tous, écriture admin.
router.get('/offices', asyncHandler(async (req, res) => res.json(await repo.officesWithCounts(t(req)))));
router.get('/offices/communes', asyncHandler(async (req, res) => res.json(await repo.listCommunes(t(req)))));
router.get('/offices/:id/perimeter', asyncHandler(async (req, res) => res.json(await repo.officePerimeter(t(req), req.params.id))));
const communeItem = z.object({ district: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)), commune: z.string().trim().min(1).max(120) });
const officeBody = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  nature: z.enum(['pays', 'terrain']).optional(),
  parentId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  responsible: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
  national: z.boolean().optional(),
  active: z.boolean().optional(),
  communes: z.array(communeItem).max(2000).optional(),
});
router.post('/offices', ADMIN, body(officeBody), asyncHandler(async (req, res) => {
  try { res.status(201).json({ id: await repo.createOffice(t(req), req.valid) }); }
  catch (err) { if (err.code === '23505') throw badRequest('Ce code de bureau existe déjà.'); throw err; }
}));
router.patch('/offices/:id', ADMIN, body(officeBody.partial()), asyncHandler(async (req, res) => {
  try { if (!(await repo.updateOffice(t(req), req.params.id, req.valid))) return res.status(404).json({ error: 'Bureau introuvable' }); }
  catch (err) { if (err.code === '23505') throw badRequest('Ce code de bureau existe déjà.'); throw err; }
  return res.status(204).end();
}));
router.delete('/offices/:id', ADMIN, asyncHandler(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  try {
    const r = await repo.deleteOffice(t(req), req.params.id, { confirm: req.query.confirm === '1' });
    if (!r) return res.status(404).json({ error: 'Bureau introuvable' });
    return res.json(r);
  } catch (err) {
    if (err.code !== 'CONFIRM_DELETE') throw err;
    const { sites, mmr, antennes } = err.impact;
    throw conflict(`Ce bureau a ${sites} site(s) rattaché(s), ${mmr} dérogation(s) MMR et ${antennes} antenne(s). Préférez « Désactiver » ; supprimer détache les sites et efface les dérogations.`,
      { code: 'CONFIRM_DELETE', ...err.impact });
  }
}));

// ---- MMR (Minimum Monitoring Requirements) — lecture tous, écriture admin.
router.get('/mmr', asyncHandler(async (req, res) => res.json(await repo.listMmr(t(req)))));
const mmrBody = z.object({
  // Omis / vide = plan général (vaut pour tous les bureaux) ; renseigné = dérogation bureau.
  fieldOfficeId: z.string().uuid().optional().nullable().or(z.literal('').transform(() => undefined)),
  activityCategory: z.string().trim().min(1).max(160),
  operationDuration: z.number().int().min(0).max(12),
  numberOfSites: z.number().int().min(0).max(100000),
  riskLevel: z.number().int().min(1).max(3),
  feasible: z.number().int().min(0).max(100000).optional().nullable(),
  personsToDeploy: z.number().int().min(0).max(100000).optional().nullable(),
  visitsPerDay: z.number().min(0).max(1000).optional().nullable(),
  workingDays: z.number().int().min(0).max(31).optional().nullable(),
  note: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
});
router.post('/mmr', ADMIN, body(mmrBody), asyncHandler(async (req, res) =>
  res.status(201).json({ id: await repo.upsertMmr(t(req), req.valid, req.auth.userId) })));
// Grille MMR : enregistrement groupé tout-ou-rien (créations, modifications, suppressions).
const mmrBulk = z.object({
  upserts: z.array(mmrBody.extend({ id: z.string().uuid().optional() })).max(2000).default([]),
  deletes: z.array(z.string().uuid()).max(2000).default([]),
}).superRefine((v, ctx) => {
  const seen = new Set();
  v.upserts.forEach((u, i) => {
    const k = `${u.fieldOfficeId || ''}|${u.activityCategory.toLowerCase()}`;
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['upserts', i, 'activityCategory'], message: `« ${u.activityCategory} » en double pour la même portée` });
    seen.add(k);
  });
});
router.put('/mmr/bulk', ADMIN, body(mmrBulk), asyncHandler(async (req, res) =>
  res.json(await repo.bulkSaveMmr(t(req), req.valid, req.auth.userId))));
router.get('/mmr/registry', asyncHandler(async (req, res) => res.json(await repo.mmrRegistry(t(req)))));
router.get('/mmr/export.xlsx', asyncHandler(async (req, res) => {
  const [rows, offices] = await Promise.all([repo.listMmr(t(req)), repo.officeRefs(t(req))]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Parametres_MMR_MEMS2.xlsx"');
  await buildMmrWorkbook(rows, offices).xlsx.write(res);
  res.end();
}));
// Import = lecture seule : renvoie les lignes pour revue dans la grille ;
// rien n'est enregistré avant « Enregistrer » (même schéma que /mmr/bulk).
router.post('/mmr/import', ADMIN, express.raw({ type: '*/*', limit: '20mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let parsed;
  try { parsed = await parseMmrWorkbook(req.body, await repo.officeRefs(t(req))); } catch (err) {
    if (isRefusal(err)) throw err;
    if (err && err.code === 'NO_SHEET') throw badRequest('Aucune feuille de paramètres MMR reconnue (colonnes Catégorie d\'activité, Durée, Risque).');
    throw badRequest('Fichier Excel illisible.');
  }
  const errors = [...parsed.errors];
  const rows = parsed.rows.filter((r) => {
    const ok = mmrBody.safeParse(r);
    if (!ok.success) errors.push({ row: null, message: `« ${r.activityCategory} » : ${Object.values(ok.error.flatten().fieldErrors).flat().join(', ')}` });
    return ok.success;
  });
  res.json({ rows, errors, skipped: parsed.skipped, sheet: parsed.sheet });
}));
router.delete('/mmr/:id', ADMIN, asyncHandler(async (req, res) => {
  if (!(await repo.deleteMmr(t(req), req.params.id))) return res.status(404).json({ error: 'Paramètre MMR introuvable' });
  return res.status(204).end();
}));

// ---- Partners (unified registry)
router.get('/partners', asyncHandler(async (req, res) =>
  res.json(await repo.listPartners(t(req), { typeCode: req.query.type }))));

const partnerBody = z.object({
  name: z.string().trim().min(2).max(160),
  partnerTypeId: z.string().uuid(),
  dailyRate: z.number().nonnegative().nullable().optional(),
  contractRef: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
});

router.post('/partners', ADMIN, body(partnerBody), asyncHandler(async (req, res) => {
  const type = await repo.partnerTypeById(t(req), req.valid.partnerTypeId);
  if (!type) throw badRequest('Type de partenaire inconnu');
  // A daily rate only makes sense for a TPM partner.
  const dailyRate = type.code === 'tpm' ? req.valid.dailyRate ?? 0 : null;
  const id = await repo.createPartner(t(req), { ...req.valid, dailyRate });
  return res.status(201).json({ id });
}));

router.patch('/partners/:id', ADMIN, body(z.object({
  name: z.string().trim().min(2).max(160).optional(),
  dailyRate: z.number().nonnegative().nullable().optional(),
  contractRef: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  active: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const ok = await repo.updatePartner(t(req), req.params.id, req.valid);
  if (!ok) return res.status(404).json({ error: 'Partenaire introuvable' });
  return res.status(204).end();
}));

router.post('/partners/:id/agents', ADMIN, body(z.object({
  name: z.string().trim().min(2).max(120),
  fonction: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
})), asyncHandler(async (req, res) => res.status(201).json(await repo.createAgent(t(req), req.params.id, req.valid))));

router.delete('/partners/:id/agents/:agentId', ADMIN, asyncHandler(async (req, res) => {
  const ok = await repo.deleteAgent(t(req), req.params.id, req.params.agentId);
  if (!ok) return res.status(404).json({ error: 'Agent introuvable' });
  return res.status(204).end();
}));

// Évaluation : formations suivies par un agent (thématique, date, jours)
router.post('/partners/:id/agents/:agentId/formations', ADMIN, body(z.object({
  thematique: z.string().trim().min(2).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
  jours: z.number().positive().max(365).optional(),
})), asyncHandler(async (req, res) => {
  const f = await repo.createFormation(t(req), req.params.id, req.params.agentId, req.valid);
  if (!f) return res.status(404).json({ error: 'Agent introuvable' });
  return res.status(201).json(f);
}));

router.delete('/partners/:id/agents/:agentId/formations/:formationId', ADMIN, asyncHandler(async (req, res) => {
  const ok = await repo.deleteFormation(t(req), req.params.id, req.params.agentId, req.params.formationId);
  if (!ok) return res.status(404).json({ error: 'Formation introuvable' });
  return res.status(204).end();
}));

// Évaluation d'un agent (basée sur son travail terrain) : période, note, appréciation
router.post('/partners/:id/agents/:agentId/evaluations', ADMIN, body(z.object({
  periode: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  note: z.number().min(0).max(20).optional(),
  appreciation: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
  commentaire: z.string().trim().max(1000).optional().or(z.literal('').transform(() => undefined)),
})), asyncHandler(async (req, res) => {
  const input = { ...req.valid, periode: `${req.valid.periode.slice(0, 7)}-01` };
  const e = await repo.createEvaluation(t(req), req.params.id, req.params.agentId, input, req.auth.userId);
  if (!e) return res.status(404).json({ error: 'Agent introuvable' });
  return res.status(201).json(e);
}));

router.delete('/partners/:id/agents/:agentId/evaluations/:evaluationId', ADMIN, asyncHandler(async (req, res) => {
  const ok = await repo.deleteEvaluation(t(req), req.params.id, req.params.agentId, req.params.evaluationId);
  if (!ok) return res.status(404).json({ error: 'Évaluation introuvable' });
  return res.status(204).end();
}));

// ---- Localités : profil pays, vocabulaire, découpage, répertoire, CRUD -------
const latS = z.number().min(-90).max(90).nullable().optional();
const lngS = z.number().min(-180).max(180).nullable().optional();
const pcodeS = z.string().trim().max(40).regex(/^[A-Za-z0-9._-]*$/, 'P-code : lettres, chiffres, . _ -').nullable().optional()
  .transform((v) => (v === undefined ? undefined : (v || null))); // absent ≠ vidé (un PATCH sans pcode le conserve)
const areaName = z.string().trim().min(1).max(120);

router.get('/admin-levels', asyncHandler(async (req, res) => res.json(await loc.listAdminLevels(t(req)))));
router.get('/admin-areas', asyncHandler(async (req, res) => {
  const depth = req.query.depth ? Number(req.query.depth) : undefined;
  res.json(await loc.listAdminAreas(t(req), { depth, parentId: req.query.parentId || undefined }));
}));

router.get('/country', asyncHandler(async (req, res) => res.json(await loc.getCountry(t(req)))));
router.put('/country', ADMIN, body(z.object({
  name: z.string().trim().min(1).max(120),
  iso3: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Code ISO : 3 lettres').nullable().optional().or(z.literal('').transform(() => null)),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Devise : code ISO à 3 lettres').nullable().optional().or(z.literal('').transform(() => null)),
  centerLat: latS, centerLng: lngS,
  note: z.string().trim().max(500).nullable().optional(),
  levels: z.array(z.object({ depth: z.number().int().min(1).max(9), label: z.string().trim().min(1).max(60), labelPlural: z.string().trim().min(1).max(60) })).max(9).default([]),
})), asyncHandler(async (req, res) => res.json(await loc.saveCountry(t(req), req.valid))));

// Import d'un découpage (un fichier par pays) : .csv, .dbf ou .zip (shapefile). Met à jour
// l'existant en conservant les identifiants ; ?confirm=1 accepte de supprimer des unités
// dont dépendent des zones de contrat (sinon 409 avec les compteurs).
router.post('/admin-breakdown/import', ADMIN, express.raw({ type: '*/*', limit: '200mb' }), asyncHandler(async (req, res) => {
  const filename = req.get('x-filename') || 'upload.csv';
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let parsed;
  try { parsed = await parseUpload(req.body, filename); } catch (err) { throw badRequest(err.message); }
  if (!parsed.levels.length || !parsed.rows.length) throw badRequest('Aucune unité administrative détectée dans le fichier.');
  res.status(201).json(await loc.replaceBreakdown(t(req), parsed, { confirm: req.query.confirm === '1' }));
}));

const dirQuery = (req) => ({
  depth: Math.max(1, Number(req.query.depth) || 1),
  ancestorId: z.string().uuid().safeParse(req.query.ancestorId).success ? req.query.ancestorId : undefined,
  q: String(req.query.q || '').trim().slice(0, 80) || undefined,
});
router.get('/localities', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 50));
  res.json(await loc.directory(t(req), { ...dirQuery(req), page, pageSize, sort: req.query.sort }));
}));
router.get('/localities/export.csv', asyncHandler(async (req, res) => {
  const f = dirQuery(req);
  const [rows, levels] = await Promise.all([loc.directoryAll(t(req), f), loc.listAdminLevels(t(req))]);
  const labels = levels.filter((l) => l.depth <= f.depth).map((l) => l.label);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Localites_${labels[labels.length - 1] || 'niveau'}.csv"`);
  res.send(directoryCsv(rows, labels));
}));
router.post('/localities', ADMIN, body(z.object({
  depth: z.number().int().min(1).max(9), parentId: z.string().uuid().nullable().optional(),
  name: areaName, pcode: pcodeS, lat: latS, lng: lngS,
})), asyncHandler(async (req, res) => res.status(201).json(await loc.createArea(t(req), req.valid))));
router.patch('/localities/:id', ADMIN, body(z.object({
  name: areaName.optional(), parentId: z.string().uuid().nullable().optional(),
  pcode: pcodeS, lat: latS, lng: lngS,
}).refine((v) => Object.keys(v).length > 0, 'Rien à modifier')), asyncHandler(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  res.json(await loc.updateArea(t(req), req.params.id, req.valid));
}));
router.delete('/localities/:id', ADMIN, asyncHandler(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  res.json(await loc.deleteArea(t(req), req.params.id, { cascade: req.query.cascade === '1' }));
}));

// ---- État de la configuration : « prêt / à compléter / bloquant » par réglage ---------
router.get('/health', asyncHandler(async (req, res) => res.json(await configHealth(t(req)))));

// ---- Rapprochement des lieux : file « À rapprocher » et alias ------------------------
const queueStatus = z.enum(['a_valider', 'ambigu', 'introuvable', 'ignore', 'resolu']);
router.get('/place-matches', asyncHandler(async (req, res) => {
  const st = req.query.status ? queueStatus.safeParse(req.query.status) : { success: true, data: undefined };
  if (!st.success) throw badRequest('Statut inconnu.');
  res.json(await places.listQueue(t(req), { status: st.data }));
}));
router.post('/place-matches/apply', WRITE, asyncHandler(async (req, res) => res.json(await places.applyAll(t(req)))));
// Lieu (zone) : areaId ; site du référentiel : siteId — exactement l'un des deux (selon le type de la graphie).
router.post('/place-matches/:id/decide', WRITE, body(z.discriminatedUnion('action', [
  z.object({ action: z.literal('lier'), areaId: z.string().uuid().optional(), siteId: z.string().uuid().optional() }),
  z.object({ action: z.literal('ignorer') }),
]).refine((v) => v.action !== 'lier' || Boolean(v.areaId) !== Boolean(v.siteId), { message: 'Indiquez soit une unité, soit un site.' })),
asyncHandler(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  res.json(await places.decideQueue(t(req), req.params.id, req.valid, req.auth.userId));
}));
router.get('/place-aliases', asyncHandler(async (req, res) => res.json(await places.listAliases(t(req)))));
router.delete('/place-aliases/:id', WRITE, asyncHandler(async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) throw badRequest('Identifiant invalide');
  if (!(await places.deleteAlias(t(req), req.params.id))) throw badRequest('Alias introuvable.');
  res.status(204).end();
}));

module.exports = router;
