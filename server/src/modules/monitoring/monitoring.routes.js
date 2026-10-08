const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound } = require('../../middleware/errors');
const repo = require('./monitoring.repository');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const { parseSubmissions, submissionsFromObjects } = require('./submissionsImport');
const { parseXlsformRows } = require('./xlsformImport');
const { parseSav } = require('./savParser');

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
// Donne un identifiant stable (dé-duplication) aux soumissions sans _uuid,
// à partir du contenu — pour que ré-importer le même .sav soit idempotent.
function withStableIds(subs) {
  for (const s of subs) {
    if (!s.externalId) s.externalId = `sav:${crypto.createHash('sha1').update(JSON.stringify(s.data)).digest('hex').slice(0, 24)}`;
  }
  return subs;
}

// Extrait les lignes d'un .sav (SPSS) → soumissions normalisées.
function savToSubmissions(buf) {
  const { rows } = parseSav(buf);
  if (!rows.length) throw badRequest('Aucune donnée dans le fichier .sav.');
  return withStableIds(submissionsFromObjects(rows, 'sav'));
}

// Import a CSV / XLSX / SPSS .sav export, ou un .zip Kobo (contenant data.sav).
router.post('/forms/:id/import', WRITE, express.raw({ type: '*/*', limit: '80mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  const name = String(req.headers['x-filename'] || '');
  const buf = req.body;
  const isZip = /\.zip$/i.test(name) || (buf[0] === 0x50 && buf[1] === 0x4b && /\.zip$/i.test(name));
  const isSav = /\.sav$/i.test(name) || buf.toString('latin1', 0, 4) === '$FL2';

  let submissions; let fields = 0;
  try {
    if (isZip) {
      const zip = new AdmZip(buf);
      const entry = zip.getEntries().find((e) => /(^|\/)data\.sav$/i.test(e.entryName))
        || zip.getEntries().find((e) => /\.sav$/i.test(e.entryName));
      if (!entry) throw badRequest('Archive Kobo sans fichier .sav (data.sav attendu).');
      submissions = savToSubmissions(entry.getData());
    } else if (isSav) {
      submissions = savToSubmissions(buf);
    } else {
      const parsed = await parseSubmissions(buf, { filename: name });
      submissions = parsed.submissions; fields = parsed.headers.length;
    }
  } catch (err) {
    if (err.status === 400) throw err; // badRequest explicite
    throw badRequest(`Fichier illisible : fournissez un CSV, XLSX, SPSS .sav ou un .zip Kobo (${err.message}).`);
  }
  if (!submissions.length) throw badRequest('Aucune soumission trouvée dans le fichier.');
  const result = await repo.importSubmissions(t(req), req.params.id, submissions);
  if (!result) throw notFound('Formulaire introuvable');
  res.json({ ...result, fields });
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

// Catalogue détaillé d'une fiche (champs + listes de choix issus du XLSForm).
router.get('/forms/:id/catalog', asyncHandler(async (req, res) => res.json(await repo.formCatalog(t(req), req.params.id))));

// Mapping « formulaire ↔ référentiels MEMS » (dérivé, aucun stockage).
router.get('/forms/:id/mems-mapping', asyncHandler(async (req, res) => res.json(await repo.memsMappingForForm(t(req), req.params.id))));

// Import d'une DÉFINITION XLSForm (.xlsx Kobo/ODK : feuilles survey/choices/
// settings) → crée/MAJ la fiche + son catalogue de champs et listes de choix.
router.post('/import-definition', WRITE, express.raw({ type: '*/*', limit: '60mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let wb;
  try { wb = new ExcelJS.Workbook(); await wb.xlsx.load(req.body); }
  catch { throw badRequest('Fichier illisible : fournissez un XLSForm .xlsx (feuilles survey/choices/settings).'); }
  const sheetRows = (name) => {
    const ws = wb.getWorksheet(name);
    if (!ws) return [];
    const rows = [];
    ws.eachRow((row) => { rows.push(row.values.slice(1)); });
    return rows;
  };
  const survey = sheetRows('survey');
  if (survey.length < 2) throw badRequest('Feuille « survey » introuvable ou vide — ce n\'est pas un XLSForm.');
  const parsed = parseXlsformRows(survey, sheetRows('choices'), sheetRows('settings'));
  if (parsed.fields.length === 0) throw badRequest('Aucun champ de données trouvé dans la feuille survey.');
  const code = (parsed.formId || `form_${Date.now()}`).slice(0, 60);
  const label = parsed.title || code;
  const result = await repo.importDefinition(t(req), { code, label }, parsed.fields, parsed.choices);
  res.json({ ...result, code, label });
}));

// Synthèse transversale « Suivi de processus » (toutes fiches agrégées).
router.get('/overview', asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}/.test(req.query.month || '') ? req.query.month : undefined;
  res.json(await repo.processOverview(t(req), { month }));
}));

// Données réelles brutes (soumissions), filtrables par mois — alimente la
// « table des données actuelles » rattachée au plan de suivi.
router.get('/submissions', asyncHandler(async (req, res) => {
  const month = /^\d{4}-\d{2}/.test(req.query.month || '') ? req.query.month : undefined;
  const limit = Number(req.query.limit);
  res.json(await repo.listSubmissions(t(req), { month, limit: Number.isFinite(limit) ? limit : undefined }));
}));

module.exports = router;
