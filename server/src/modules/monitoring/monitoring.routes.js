const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const repo = require('./monitoring.repository');
const { parseSubmissions, submissionsFromObjects } = require('./submissionsImport');

/**
 * Suivi de processus — forms, configurable indicators (mapping) and real
 * submissions (CSV / XLSX now; Kobo v2 API pull; SPSS .sav next). Read for any
 * authenticated user of the tenant; writes for admin/manager.
 */
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

// ---- Forms ---------------------------------------------------------------
router.get('/forms', asyncHandler(async (req, res) => res.json(await repo.listForms(t(req)))));

const formSchema = z.object({
  code: z.string().trim().min(2).max(40),
  label: z.string().trim().min(2).max(160),
});
router.post('/forms', WRITE, body(formSchema), asyncHandler(async (req, res) => {
  try { res.status(201).json({ id: await repo.createForm(t(req), req.valid) }); }
  catch (err) { if (err.code === '23505') throw badRequest('Un formulaire avec ce code existe déjà.'); throw err; }
}));

router.patch('/forms/:id', WRITE, body(z.object({ label: z.string().trim().max(160).optional(), active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    if (!(await repo.updateForm(t(req), req.params.id, req.valid))) throw notFound('Formulaire introuvable');
    res.status(204).end();
  }));

router.get('/forms/:id/fields', asyncHandler(async (req, res) => res.json(await repo.formFields(t(req), req.params.id))));

// ---- Indicators (mapping) ------------------------------------------------
router.get('/forms/:id/indicators', asyncHandler(async (req, res) => res.json(await repo.listIndicators(t(req), req.params.id))));

const indicatorSchema = z.object({
  code: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(200),
  module: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)),
  sourceField: z.string().trim().min(1).max(200),
  agg: z.enum(['percent_yes', 'mean', 'sum', 'count', 'percent_value']).optional(),
  positiveValue: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)),
  target: z.number().optional().nullable(),
  direction: z.enum(['higher_better', 'lower_better']).optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});
router.post('/forms/:id/indicators', WRITE, body(indicatorSchema), asyncHandler(async (req, res) => {
  try { res.status(201).json({ id: await repo.createIndicator(t(req), req.params.id, req.valid) }); }
  catch (err) { if (err.code === '23505') throw badRequest('Un indicateur avec ce code existe déjà sur ce formulaire.'); throw err; }
}));
router.patch('/indicators/:id', WRITE, body(indicatorSchema.partial()), asyncHandler(async (req, res) => {
  if (!(await repo.updateIndicator(t(req), req.params.id, req.valid))) throw notFound('Indicateur introuvable');
  res.status(204).end();
}));
router.delete('/indicators/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deleteIndicator(t(req), req.params.id))) throw notFound('Indicateur introuvable');
  res.status(204).end();
}));

// ---- Submissions ---------------------------------------------------------
// Import a CSV / XLSX export (Kobo download or any tabular export).
router.post('/forms/:id/import', WRITE, express.raw({ type: '*/*', limit: '60mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  const name = String(req.headers['x-filename'] || '');
  if (/\.sav$/i.test(name)) throw badRequest('Format SPSS .sav pas encore pris en charge : exportez en CSV ou XLSX depuis SPSS/Kobo pour l\'instant.');
  let parsed;
  try { parsed = await parseSubmissions(req.body, { filename: name }); }
  catch { throw badRequest('Fichier illisible : fournissez un CSV ou un XLSX.'); }
  if (!parsed.submissions.length) throw badRequest('Aucune soumission trouvée dans le fichier.');
  const result = await repo.importSubmissions(t(req), req.params.id, parsed.submissions);
  if (!result) throw notFound('Formulaire introuvable');
  res.json({ ...result, fields: parsed.headers.length });
}));

// Pull submissions from a Kobo v2 API (KoboToolbox / ONA). Needs the asset uid
// and an API token; the same normalization + insert path as the file import.
const koboSchema = z.object({
  baseUrl: z.string().url().max(200),
  assetUid: z.string().trim().min(3).max(80),
  token: z.string().trim().min(6).max(200),
});
router.post('/forms/:id/kobo-pull', WRITE, body(koboSchema), asyncHandler(async (req, res) => {
  const { baseUrl, assetUid, token } = req.valid;
  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/assets/${assetUid}/data.json?limit=30000`;
  let data;
  try {
    const r = await fetch(url, { headers: { Authorization: `Token ${token}`, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (err) {
    throw badRequest(`Connexion Kobo impossible (${err.message}). Vérifiez l'URL, l'UID et le token.`);
  }
  const records = Array.isArray(data) ? data : (data.results || []);
  const submissions = submissionsFromObjects(records, 'kobo');
  if (!submissions.length) throw badRequest('Aucune soumission renvoyée par Kobo.');
  const result = await repo.importSubmissions(t(req), req.params.id, submissions);
  if (!result) throw notFound('Formulaire introuvable');
  res.json(result);
}));

// Computed indicator values for the dashboard.
router.get('/forms/:id/values', asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}/.test(req.query.month || '') ? req.query.month : undefined;
  res.json(await repo.computeValues(t(req), req.params.id, { month }));
}));

// Dashboard restitution: coverage + per-bureau + indicator values + index.
router.get('/forms/:id/dashboard', asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}/.test(req.query.month || '') ? req.query.month : undefined;
  res.json(await repo.dashboard(t(req), req.params.id, { month }));
}));

// Synthèse transversale « Suivi de processus » (toutes fiches agrégées).
router.get('/overview', asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}/.test(req.query.month || '') ? req.query.month : undefined;
  res.json(await repo.processOverview(t(req), { month }));
}));

module.exports = router;
