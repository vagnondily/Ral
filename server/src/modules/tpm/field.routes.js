const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const ExcelJS = require('exceljs');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const repo = require('./field.repository');

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
router.post('/sites', WRITE, body(siteSchema), asyncHandler(async (req, res) => {
  try { res.status(201).json({ id: await repo.createSite(t(req), req.valid) }); }
  catch (err) { if (err.code === '23505') throw badRequest('Ce site existe déjà (district + commune + nom).'); throw err; }
}));
router.patch('/sites/:id', WRITE, body(siteSchema.partial().extend({ active: z.boolean().optional() })), asyncHandler(async (req, res) => {
  if (!(await repo.updateSite(t(req), req.params.id, req.valid))) throw notFound('Site introuvable');
  res.status(204).end();
}));

// ---- Visits --------------------------------------------------------------
router.get('/visits', asyncHandler(async (req, res) => res.json(
  await repo.listVisits(t(req), { month: monthQ(req), providerId: req.query.providerId, status: req.query.status })
)));
router.get('/summary', asyncHandler(async (req, res) => res.json(await repo.summary(t(req), { month: monthQ(req) }))));

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
router.post('/visits', WRITE, body(visitSchema), asyncHandler(async (req, res) => {
  try { res.status(201).json({ id: await repo.createVisit(t(req), uid(req), req.valid) }); }
  catch (err) { if (err.status === 409) throw badRequest(err.message); throw err; }
}));

const patchSchema = z.object({
  providerId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  agent: z.string().trim().max(120).optional(),
  contractId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(['planifie', 'realise', 'annule']).optional(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
