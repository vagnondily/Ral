const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const ExcelJS = require('exceljs');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const repo = require('./field.repository');
const settingsRepo = require('../settings/settings.repository');
const { buildLocationsWorkbook, parseLocationsWorkbook, POI_SUBTYPES, MODALITIES } = require('./locationsXlsx');
const { officeResolver } = require('./mmrXlsx');

/**
 * Suivi terrain — sites (établissements) et planification/affectation des
 * visites TPM. Lecture pour tout utilisateur du tenant ; écritures admin/manager.
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const t = (req) => req.auth.tenantId;
const uid = (req) => req.auth.userId || req.auth.sub;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(badRequest('Données invalides', parsed.error.flatten()));
    req.valid = parsed.data;
    return next();
  };
}
const monthQ = (req) => (/^\d{4}-\d{2}/.test(req.query.month || '') ? req.query.month : undefined);

// ---- Sites ---------------------------------------------------------------
router.get('/sites', asyncHandler(async (req, res) => res.json(await repo.listSites(t(req), { q: req.query.q }))));

const siteSchema = z.object({
  district: z.string().trim().min(1).max(120),
  commune: z.string().trim().min(1).max(120),
  fokontany: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(1).max(200),
  activity: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
});
// Un site existant (même district + commune + nom) → 409 avec details.siteId :
// jamais de fusion silencieuse (rbm-38). Pour modifier un site : PATCH /sites/:id.
router.post('/sites', WRITE, body(siteSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ id: await repo.createSite(t(req), req.valid) });
}));
const crit02 = z.number().int().min(0).max(2).optional();
const crit01 = z.number().int().min(0).max(1).optional();
// Échelles du classeur RBM (Sheet4) ; l'ancienne valeur 2 de sécurité = stricte (3).
const security = z.number().int().refine((v) => [0, 1, 2, 3, 99].includes(v), 'Sécurité : 0, 1, 3 ou 99')
  .transform((v) => (v === 2 ? 3 : v)).optional();
const optText = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : (v || null)));
router.patch('/sites/:id', WRITE, body(siteSchema.partial().extend({
  riskLevel: z.enum(['faible', 'moyenne', 'elevee']).optional(),
  security, synergies: crit01, beneficiaryOver200: crit01, newPartner: crit01,
  issuesProcess: crit02, issuesPartnerReport: crit02, issuesCFM: crit02, fraud: crit02,
  experiencedPartner: crit02,
  beneficiaryNumber: z.number().int().min(0).max(10_000_000).nullable().optional(),
  modalityType: z.enum(['Cash', 'Voucher', 'Food', 'Capacity Strengthening', 'Mix']).nullable().optional(),
  poiSubtype: optText(80), urbanArea: optText(120),
  lastVisitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})), asyncHandler(async (req, res) => {
  if (!(await repo.updateSite(t(req), req.params.id, req.valid))) throw notFound('Site introuvable');
  res.status(204).end();
}));

// ---- RBM (Risk-Based Monitoring) : sélection des sites à suivre par risque ---
router.get('/rbm/sites', asyncHandler(async (req, res) => res.json(
  await repo.rbmSites(t(req), { month: monthQ(req), risk: req.query.risk })
)));
// ---- Plan de suivi « type Excel » (exercice) ---------------------------------
const yearQ = (req) => { const y = Number(req.query.year); return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : new Date().getFullYear(); };
// Listes de référence de l'écran (Activity Tag = catégories du MMR, sous-types de POI, modalités).
router.get('/plan-board', asyncHandler(async (req, res) => {
  const [board, mmr] = await Promise.all([repo.planBoard(t(req), { year: yearQ(req), adjusted: req.query.adjusted === '1' }), settingsRepo.listMmr(t(req))]);
  const activities = [...new Set(mmr.map((m) => String(m.activityCategory || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  res.json({ ...board, refs: { activities, poiSubtypes: POI_SUBTYPES.map(([label, code]) => ({ label, code })), modalities: MODALITIES } });
}));
const planChanges = z.object({
  year: z.number().int().min(2000).max(2100),
  changes: z.array(z.object({ siteId: z.string().uuid(), month: z.number().int().min(1).max(12), planned: z.boolean() })).min(1).max(5000),
});
router.put('/plan-board/months', WRITE, asyncHandler(async (req, res) => {
  const p = planChanges.safeParse(req.body);
  if (!p.success) throw badRequest('Données invalides', p.error.flatten());
  res.json(await repo.setPlannedMonths(t(req), uid(req), p.data));
}));

const statusChanges = z.object({
  year: z.number().int().min(2000).max(2100),
  changes: z.array(z.object({ siteId: z.string().uuid(), month: z.number().int().min(1).max(12), active: z.boolean().nullable() })).min(1).max(60000),
});
router.put('/plan-board/status', WRITE, asyncHandler(async (req, res) => {
  const p = statusChanges.safeParse(req.body);
  if (!p.success) throw badRequest('Données invalides', p.error.flatten());
  res.json(await repo.setMonthStatuses(t(req), p.data));
}));
// Modification groupée (tout ou rien) : registre, statut mensuel sur une plage, planification.
const month = z.number().int().min(1).max(12);
const bulkSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  siteIds: z.array(z.string().uuid()).min(1).max(5000),
  set: z.object({
    fieldOfficeId: z.string().uuid().nullable().optional(),
    activity: z.string().trim().max(160).nullable().optional(),
    poiSubtype: optText(80), urbanArea: optText(120),
    modalityType: z.enum(['Cash', 'Voucher', 'Food', 'Capacity Strengthening', 'Mix']).nullable().optional(),
    security, synergies: crit01, newPartner: crit01, experiencedPartner: crit02,
    issuesProcess: crit02, issuesPartnerReport: crit02, issuesCFM: crit02, fraud: crit02,
  }).strict().optional(),
  status: z.object({ from: month, to: month, active: z.boolean().nullable() }).refine((s) => s.from <= s.to, 'Plage de mois invalide.').optional(),
  plan: z.union([
    z.object({ month, planned: z.boolean() }).strict(),
    z.object({ auto: z.literal(true), fromMonth: month.default(1), adjusted: z.boolean().optional() }).strict(),
  ]).optional(),
}).refine((b) => (b.set && Object.keys(b.set).length) || b.status || b.plan, 'Aucune modification demandée.');
router.post('/plan-board/bulk', WRITE, asyncHandler(async (req, res) => {
  const p = bulkSchema.safeParse(req.body);
  if (!p.success) throw badRequest('Données invalides', p.error.flatten());
  res.json(await repo.bulkUpdateSites(t(req), uid(req), p.data));
}));

// « Ajouter un site » : ID L### attribué par la base, statut du mois courant Active.
const addSiteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  region: z.string().trim().max(120).optional(),
  district: z.string().trim().min(1).max(120),
  commune: z.string().trim().min(1).max(120),
  fokontany: z.string().trim().max(120).optional(),
  activity: z.string().trim().max(160).optional(),
  fieldOfficeId: z.string().uuid().nullable().optional(),
  poiSubtype: optText(80), urbanArea: optText(120),
  gpsLat: z.number().min(-90).max(90).nullable().optional(),
  gpsLng: z.number().min(-180).max(180).nullable().optional(),
  modalityType: z.enum(['Cash', 'Voucher', 'Food', 'Capacity Strengthening', 'Mix']).nullable().optional(),
  beneficiaryNumber: z.number().int().min(0).max(10_000_000).nullable().optional(),
  security, synergies: crit01, newPartner: crit01, experiencedPartner: crit02,
});
router.post('/plan-board/sites', WRITE, body(addSiteSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await repo.addSite(t(req), req.valid));
}));

// Registre « Locations Management » au format du classeur du plan de suivi.
async function locationsWorkbook(req, { blank = false, prefillActivity = null } = {}) {
  const year = yearQ(req);
  const [data, mmr] = await Promise.all([repo.locationsExportData(t(req), { year }), settingsRepo.listMmr(t(req))]);
  const activities = [...new Set(mmr.map((m) => String(m.activityCategory || '').trim()).filter(Boolean))];
  return { year, wb: buildLocationsWorkbook({ year, offices: data.offices, sites: blank ? [] : data.sites, activities, prefillActivity, places: data.places }) };
}
const sendXlsx = async (res, wb, filename) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
};
router.get('/plan-board/locations.xlsx', asyncHandler(async (req, res) => {
  const { year, wb } = await locationsWorkbook(req);
  await sendXlsx(res, wb, `Plan_de_suivi_sites_${year}.xlsx`);
}));
// Gabarit d'activité : registre vierge, Activity Tag prérempli, à remplir hors ligne puis réimporter.
router.get('/plan-board/template.xlsx', asyncHandler(async (req, res) => {
  const activity = String(req.query.activity || '').trim().slice(0, 160) || null;
  const { year, wb } = await locationsWorkbook(req, { blank: true, prefillActivity: activity });
  const slug = activity ? `_${activity.normalize('NFD').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)}` : '';
  await sendXlsx(res, wb, `Gabarit_sites${slug}_${year}.xlsx`);
}));
// Import : ?commit=0 → aperçu (rien n'est écrit) ; ?commit=1 → enregistrement en une transaction.
router.post('/plan-board/locations/import', WRITE, express.raw({ type: '*/*', limit: '50mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  const [offices, mmr] = await Promise.all([settingsRepo.officeRefs(t(req)), settingsRepo.listMmr(t(req))]);
  const resolveOffice = officeResolver(offices);
  const activities = [...new Set(mmr.map((m) => m.activityCategory))];
  let parsed;
  try { parsed = await parseLocationsWorkbook(req.body, { resolveOffice, activities }); } catch (err) {
    if (err && err.code === 'NO_SHEET') throw badRequest('Aucune feuille « Locations Management » reconnue (en-têtes Point of Interest, Activity Tag, Sub Office).');
    throw badRequest('Fichier Excel illisible.');
  }
  const year = parsed.year || yearQ(req);
  const commit = req.query.commit === '1';
  const rejected = new Set(parsed.errors.map((e) => e.line)).size;
  // Lignes rejetées : l'enregistrement exige de les écarter explicitement (skipErrors=1).
  if (commit && rejected && req.query.skipErrors !== '1') throw badRequest(`${rejected} ligne(s) rejetée(s) : corrigez le fichier, ou enregistrez les lignes valides en les écartant.`, { errors: parsed.errors.slice(0, 200) });
  const result = await repo.importLocations(t(req), uid(req), { year, rows: parsed.rows }, { commit });
  res.json({ ...result, year, sheet: parsed.sheet, rejected, errors: parsed.errors.slice(0, 500), errorCount: parsed.errors.length,
    warnings: parsed.warnings.slice(0, 500), warningCount: parsed.warnings.length });
}));

router.post('/rbm/generate', WRITE, asyncHandler(async (req, res) => {
  const month = monthQ(req);
  if (!month) throw badRequest('Mois requis (?month=YYYY-MM).');
  res.json(await repo.generateFromRbm(t(req), uid(req), month, { risk: req.query.risk }));
}));
// Import du référentiel Master Data (Region | Code | District | Code | Communes |
// Code | Site name | Code sites | …) → sites.
router.post('/rbm/import', WRITE, express.raw({ type: '*/*', limit: '40mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let wb;
  try { wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.body); }
  catch { throw badRequest('Fichier illisible : fournissez un .xlsx.'); }
  const ws = wb.getWorksheet('Feuil1') || wb.worksheets[0];
  if (!ws) throw badRequest('Feuille introuvable.');
  const cell = (row, c) => {
    const v = row.getCell(c).value;
    if (v == null) return '';
    if (typeof v === 'object') { if (v.richText) return v.richText.map((x) => x.text).join(''); if (v.text) return v.text; if (v.result != null) return String(v.result); return ''; }
    return String(v);
  };
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const region = cell(row, 1).trim();   // adm1
    const district = cell(row, 3).trim(); // adm2
    const adm2Pcode = cell(row, 4).trim(); // code district
    const commune = cell(row, 5).trim();  // adm3
    const adm3Pcode = cell(row, 6).trim(); // code commune (clé de liaison données)
    const name = cell(row, 7).trim();
    const code = cell(row, 8).trim();
    if (!district || !commune || !name) return;
    rows.push({ region, district, commune, name, code, adm2Pcode, adm3Pcode });
  });
  if (rows.length === 0) throw badRequest('Aucun site valide trouvé (colonnes District/Communes/Site name).');
  res.json(await repo.importMasterData(t(req), rows));
}));

// Import complet du Plan de suivi (feuille « Risk-based site selection ») :
// géographie + critères + SCORE FINAL + GPS + activité + dernières visites.
router.post('/rbm/import-plan', WRITE, express.raw({ type: '*/*', limit: '60mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let parsed;
  try { parsed = await require('./planImport').parsePlanWorkbook(req.body); }
  catch { throw badRequest('Fichier illisible : fournissez un .xlsx du Plan de suivi.'); }
  if (!parsed.sheet) throw badRequest('Aucune feuille « Risk-based site selection » détectée (en-têtes Site name + FINAL SCORE).');
  if (parsed.sites.length === 0) throw badRequest(`Aucun site exploitable (district + commune requis). ${parsed.skipped} ligne(s) sans géographie ignorée(s).`);
  const result = await repo.importPlanSites(t(req), uid(req), parsed.sites);
  res.json({ ...result, sheet: parsed.sheet, skipped: parsed.skipped });
}));

// ---- Visits --------------------------------------------------------------
router.get('/visits', asyncHandler(async (req, res) => res.json(
  await repo.listVisits(t(req), { month: monthQ(req), providerId: req.query.providerId, status: req.query.status })
)));
router.get('/summary', asyncHandler(async (req, res) => res.json(await repo.summary(t(req), { month: monthQ(req) }))));

// Vue par mois (une ligne par mois de l'année, avec stats) — pour la navigation.
router.get('/months', asyncHandler(async (req, res) => res.json(await repo.monthsOverview(t(req), { year: req.query.year }))));
// Carte des sites : agrégation géographique + points GPS.
router.get('/map', asyncHandler(async (req, res) => res.json(await repo.mapData(t(req)))));
// Situation (workflow) du plan mensuel.
const monthStatusSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  status: z.enum(['draft', 'soumis', 'valide', 'annule', 'non_applicable']),
});
router.put('/months/status', WRITE, body(monthStatusSchema), asyncHandler(async (req, res) => {
  await repo.setMonthStatus(t(req), req.valid, uid(req));
  res.status(204).end();
}));

// Récap de couverture (sites visités 1/2/3/4+ fois vs MMR) — lecture seule.
router.get('/coverage-recap', asyncHandler(async (req, res) => {
  const om = Number(req.query.operationMonths);
  res.json(await repo.coverageRecapSummary(t(req), {
    district: req.query.district || undefined,
    operationMonths: Number.isFinite(om) && om > 0 ? Math.min(om, 60) : 12,
  }));
}));

// Matrice de couverture mensuelle par programme et par prestataire — lecture.
router.get('/coverage-matrix', asyncHandler(async (req, res) => {
  const y = Number(req.query.year);
  res.json(await repo.coverageMatrix(t(req), { year: Number.isFinite(y) && y > 2000 && y < 2100 ? y : undefined }));
}));

// Jours de collecte par prestataire (visites datées + jours de déplacement).
router.get('/collection-days', asyncHandler(async (req, res) => res.json(await repo.collectionDaysSummary(t(req), { month: monthQ(req) }))));
const travelSchema = z.object({
  providerId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  travelDays: z.number().int().min(0).max(366),
});
router.put('/collection-days', WRITE, body(travelSchema), asyncHandler(async (req, res) => {
  await repo.setTravelDays(t(req), req.valid);
  res.status(204).end();
}));

const visitSchema = z.object({
  siteId: z.string().uuid(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  activity: z.string().trim().max(160).optional().or(z.literal('').transform(() => undefined)),
  contractId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  providerId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  agent: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(['planifie', 'realise', 'annule']).optional(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
// Doublon (site + mois + activité) : le dépôt lève un conflit explicite (409).
router.post('/visits', WRITE, body(visitSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ id: await repo.createVisit(t(req), uid(req), req.valid) });
}));

// Champ absent = inchangé ; chaîne vide ou null = effacer (« Non affecté », date retirée…).
const clearable = (schema) => schema.nullable().optional().or(z.literal('').transform(() => null));
const patchSchema = z.object({
  providerId: clearable(z.string().uuid()),
  agent: clearable(z.string().trim().max(120)),
  contractId: clearable(z.string().uuid()),
  status: z.enum(['planifie', 'realise', 'annule']).optional(),
  visitDate: clearable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});
router.patch('/visits/:id', WRITE, body(patchSchema), asyncHandler(async (req, res) => {
  if (!(await repo.updateVisit(t(req), req.params.id, req.valid))) throw notFound('Visite introuvable');
  res.status(204).end();
}));
router.delete('/visits/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deleteVisit(t(req), req.params.id))) throw notFound('Visite introuvable');
  res.status(204).end();
}));

// ---- Import planning (.xlsx) — feuille « Planning » ----------------------
// Colonnes attendues : DISTRICT | PDF (fokontany) | COMMUNES | ETABLISSEMENT |
// ACTIVITE | agents… (les colonnes suivantes portent les agents affectés).
router.post('/import', WRITE, express.raw({ type: '*/*', limit: '40mb' }), asyncHandler(async (req, res) => {
  const month = monthQ(req);
  if (!month) throw badRequest('Mois requis (?month=YYYY-MM).');
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let wb;
  try { wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.body); }
  catch { throw badRequest('Fichier illisible : fournissez un .xlsx.'); }
  const ws = wb.getWorksheet('Planning') || wb.worksheets[0];
  if (!ws) throw badRequest('Feuille « Planning » introuvable.');

  const cell = (row, c) => {
    const v = row.getCell(c).value;
    if (v == null) return '';
    if (typeof v === 'object') { if (v.richText) return v.richText.map((x) => x.text).join(''); if (v.text) return v.text; if (v.result != null) return String(v.result); return ''; }
    return String(v);
  };
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return; // header
    const district = cell(row, 1).trim();
    const fokontany = cell(row, 2).trim();
    const commune = cell(row, 3).trim();
    const name = cell(row, 4).trim();
    const activity = cell(row, 5).trim();
    if (!district || !commune || !name) return;
    let agent = '';
    for (let c = 6; c <= 14; c++) { const a = cell(row, c).trim(); if (a) { agent = a; break; } }
    rows.push({ district, commune, fokontany, name, activity, agent });
  });
  if (rows.length === 0) throw badRequest('Aucune ligne de site valide trouvée.');
  const result = await repo.importPlanning(t(req), uid(req), month, rows);
  res.json(result);
}));

module.exports = router;
