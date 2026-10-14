const express = require('express');
const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest, notFound, conflict } = require('../../middleware/errors');
const repo = require('./monitoring.repository');
const mapping = require('./mapping.service');
const { parseSubmissions } = require('./submissionsImport');
const { parseXlsformRows } = require('./xlsformImport');
const { readXls, XlsError } = require('./xlsReader');
const { sniffFile } = require('../common/fileSniff');
const { zipLimitsFromEnv } = require('../common/zipGuard');
const { validateExpression, functionCatalog } = require('./calcFields');
const dataLinks = require('./dataLinks.service');
const periodsService = require('./periods.service');
const settingsRepo = require('../settings/settings.repository');
const { loadWorkbook, isRefusal } = require('../common/xlsxGuard');
const { sheetTable } = require('../common/sheetRows');
const { readPeriod } = require('../../middleware/period');
const { stripGps, seesPreciseGps } = require('../map/submissionGps');
const { PERIOD_CAPS } = require('../common/periodCaps');

// Durées maximales d'une période (lot 1b, mesurées au banc — common/periodCaps, la même table
// que les écrans) : l'analyse des soumissions relit les réponses de la période (12 mois) ; une
// liste de soumissions se lit sur 12 mois au plus.
const ANALYSIS_MAX_SPAN = PERIOD_CAPS.analysis;
const LIST_MAX_SPAN = PERIOD_CAPS.list;

/**
 * Suivi de processus — forms, configurable indicators (mapping) and real
 * submissions (CSV / XLSX now; Kobo v2 API pull; SPSS .sav next). Read for any
 * authenticated user of the tenant; writes for admin/manager.
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');
const uuidParam = (v) => { if (!z.string().uuid().safeParse(v).success) throw badRequest('Identifiant invalide'); return v; };
const t = (req) => req.auth.tenantId;

function body(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      // Règle métier codée (refine avec params.code) : son message français et son code,
      // pour que l'interface refasse la phrase dans la langue de l'utilisateur.
      const coded = parsed.error.issues.find((i) => i.params && i.params.code);
      if (coded) return next(badRequest(coded.message, { ...parsed.error.flatten(), code: coded.params.code, field: coded.path.join('.') }));
      return next(badRequest('Données invalides', parsed.error.flatten()));
    }
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

router.patch('/forms/:id', WRITE, body(z.object({
  label: z.string().trim().min(1).max(160).optional(), active: z.boolean().optional(),
  activityCategory: z.string().trim().max(160).nullable().optional(),
})), asyncHandler(async (req, res) => {
  const patch = { ...req.valid };
  // Activité = une catégorie du MMR (libellé canonique) : c'est elle qui relie la fiche aux sites,
  // à la couverture et au plan de suivi.
  if (patch.activityCategory) {
    const cats = [...new Set((await settingsRepo.listMmr(t(req))).map((m) => String(m.activityCategory || '').trim()).filter(Boolean))];
    const hit = cats.find((c) => c.toLowerCase().replace(/\s+/g, ' ') === patch.activityCategory.toLowerCase().replace(/\s+/g, ' '));
    if (!hit) throw badRequest(`Activité inconnue du MMR : « ${patch.activityCategory} ».`);
    patch.activityCategory = hit;
  }
  if (patch.activityCategory === '') patch.activityCategory = null;
  if (!(await repo.updateForm(t(req), uuidParam(req.params.id), patch))) throw notFound('Formulaire introuvable');
  res.status(204).end();
}));

router.delete('/forms/:id', WRITE, asyncHandler(async (req, res) => {
  res.json(await repo.deleteForm(t(req), uuidParam(req.params.id), { isAdmin: req.auth.role === 'admin', confirm: req.query.confirm ? String(req.query.confirm) : null }));
}));

router.get('/forms/:id/fields', asyncHandler(async (req, res) => res.json(await repo.formFields(t(req), req.params.id))));

// ---- Indicators (mapping) ------------------------------------------------
router.get('/forms/:id/indicators', asyncHandler(async (req, res) => res.json(await repo.listIndicators(t(req), req.params.id))));

// Texte effaçable : '' (ou espaces) et null effacent la valeur ; absent = inchangé (PATCH).
const clearable = (max) => z.string().trim().max(max).nullable().optional().transform((v) => (v === '' ? null : v));
const AGGS = ['percent_yes', 'mean', 'sum', 'count', 'percent_value'];
const indicatorFields = {
  code: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(200),
  module: clearable(80),
  sourceField: z.string().trim().min(1).max(200),
  agg: z.enum(AGGS).optional(),
  // Valeur(s) comptée(s) comme positives, séparées par « | » (ex. « 1|2 »).
  positiveValue: clearable(80),
  target: z.number().finite().nullable().optional(),
  direction: z.enum(['higher_better', 'lower_better']).optional(),
  sortOrder: z.number().int().min(-100000).max(100000).optional(),
  active: z.boolean().optional(),
  // Réponses « hors base » (Sans objet 9999, Ne sait pas 888…) ; compte dans l'indice.
  naValues: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  scored: z.boolean().optional(),
};
const indicatorSchema = z.object(indicatorFields)
  .refine((v) => v.agg !== 'percent_value' || Boolean(v.positiveValue), {
    message: 'Méthode « % = valeur » : précisez la valeur comptée.', path: ['positiveValue'], params: { code: 'positive_required' },
  });
// PATCH : modification partielle — seules les clés envoyées sont écrites (règles croisées contrôlées par le dépôt).
const indicatorPatchSchema = z.object(indicatorFields).partial().strict();
const DUP_CODE = 'Un indicateur avec ce code existe déjà sur cette fiche.';
// Code déjà pris : 409, message français + détails structurés (l'interface refait la phrase dans sa langue).
const dupCode = (code) => conflict(DUP_CODE, { code: 'duplicate_code', field: 'code', ...(code ? { value: code } : {}) });

router.post('/forms/:id/indicators', WRITE, body(indicatorSchema), asyncHandler(async (req, res) => {
  let id;
  try { id = await repo.createIndicator(t(req), uuidParam(req.params.id), req.valid); }
  catch (err) { if (err.code === '23505') throw dupCode(req.valid.code); throw err; }
  if (!id) throw notFound('Fiche introuvable');
  res.status(201).json({ id });
}));
router.patch('/indicators/:id', WRITE, body(indicatorPatchSchema), asyncHandler(async (req, res) => {
  let ok;
  try { ok = await repo.updateIndicator(t(req), uuidParam(req.params.id), req.valid); }
  catch (err) { if (err.code === '23505') throw dupCode(req.valid.code); throw err; }
  if (!ok) throw notFound('Indicateur introuvable');
  res.status(204).end();
}));

// « Comment c'est calculé » : une définition (enregistrée ou en cours de saisie) appliquée aux
// soumissions réelles de la période. Lecture seule (aucune écriture), pour tout utilisateur.
// Période : { from, to } ou l'ancien { month } (null = absent), lue par readPeriod (codes period_*).
const periodField = z.any().optional();
const previewSchema = z.object({
  sourceField: indicatorFields.sourceField,
  agg: indicatorFields.agg,
  positiveValue: indicatorFields.positiveValue,
  naValues: indicatorFields.naValues,
  target: indicatorFields.target,
  direction: indicatorFields.direction,
  month: periodField, from: periodField, to: periodField,
});
router.post('/forms/:id/indicators/preview', body(previewSchema), asyncHandler(async (req, res) => {
  const { month, from, to, ...def } = req.valid;
  const period = readPeriod({ month, from, to }, { maxSpan: ANALYSIS_MAX_SPAN });
  // Vie privée (lot 6a) : coordonnées des ménages retirées pour les rôles autres qu'admin / gestionnaire.
  const out = await repo.indicatorPreview(t(req), uuidParam(req.params.id), { agg: 'percent_yes', ...def }, period, { precise: seesPreciseGps(req.auth.role) });
  if (!out) throw notFound('Fiche introuvable');
  res.json(out);
}));
// Mois ayant des données (période par défaut des résultats : le dernier, jamais un mois vide).
router.get('/forms/:id/months', asyncHandler(async (req, res) => {
  const out = await repo.formMonths(t(req), uuidParam(req.params.id));
  if (!out) throw notFound('Fiche introuvable');
  res.json(out);
}));
// Modèle d'indicateurs de l'activité de la fiche : variable proposée pour chaque indicateur,
// puis création groupée des indicateurs choisis (retour n° 12).
router.get('/forms/:id/template', asyncHandler(async (req, res) => {
  const r = await repo.formTemplate(t(req), uuidParam(req.params.id));
  if (!r) throw notFound('Formulaire introuvable');
  res.json(r);
}));
router.post('/forms/:id/template/apply', WRITE, body(z.object({
  items: z.array(z.object({
    code: z.string().trim().min(1).max(60),
    sourceField: z.string().trim().min(1).max(200),
    positiveValue: z.string().trim().max(80).nullable().optional(),
  })).min(1).max(400),
})), asyncHandler(async (req, res) => {
  const r = await repo.applyTemplate(t(req), uuidParam(req.params.id), req.valid.items);
  if (!r) throw notFound('Formulaire introuvable');
  res.json(r);
}));

router.delete('/indicators/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deleteIndicator(t(req), req.params.id))) throw notFound('Indicateur introuvable');
  res.status(204).end();
}));

// ---- Submissions ---------------------------------------------------------
// Import d'un export CSV / XLSX / SPSS .sav, ou d'un .zip SPSS de Kobo (data.sav).
// Le format est reconnu par le CONTENU (submissionsImport → fileSniff) : HTML,
// PDF, Word, .zsav, .xls ou XLSForm sont refusés (400, format nommé) et un zip
// trop gros une fois décompressé l'est AVANT décompression (413) — dans tous
// ces cas, rien n'est écrit.
/** Lit le fichier envoyé (même règle pour la vérification et l'import) ; 400 / 413 explicites. */
async function readSubmissionsFile(req) {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let parsed;
  try {
    parsed = await parseSubmissions(req.body, { zipLimits: zipLimitsFromEnv(process.env) });
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) throw err; // AppError explicite : 400 (format, date) ou 413 (taille)
    req.log?.warn({ err }, 'import de soumissions : fichier illisible');
    throw badRequest('Fichier illisible : fournissez un CSV, XLSX, SPSS .sav ou un .zip Kobo.');
  }
  if (!parsed.submissions.length) throw badRequest('Aucune soumission trouvée dans le fichier.');
  return parsed;
}

// ---- Correspondances des valeurs codées (bureau, partenaire, agent) — retour n° 3 -------
const CORR_DIMENSIONS = ['field_office', 'partner', 'agent'];
router.get('/forms/:id/correspondences', asyncHandler(async (req, res) => {
  const dimension = String(req.query.dimension || '');
  if (!CORR_DIMENSIONS.includes(dimension)) throw badRequest('Dimension inconnue (field_office, partner ou agent).');
  const out = await repo.formCorrespondences(t(req), uuidParam(req.params.id), dimension);
  if (!out) throw notFound('Fiche introuvable');
  res.json(out);
}));
const correspondenceSchema = z.object({
  dimension: z.enum(['field_office', 'partner', 'agent']),
  raw: z.string().min(1).max(200),
  mode: z.enum(['link', 'ignore', 'auto']),
  targetId: z.string().uuid().optional(),
}).refine((v) => (v.mode === 'link') === Boolean(v.targetId), { message: 'Choisissez l\'élément MEMS à relier.' });
router.put('/forms/:id/correspondences', WRITE, body(correspondenceSchema), asyncHandler(async (req, res) => {
  const out = await repo.setCorrespondence(t(req), req.auth.userId, uuidParam(req.params.id), req.valid);
  if (!out) throw notFound('Fiche introuvable');
  res.json(out);
}));

// Vérification avant import (assistant « Importation ») : ce que contient le fichier, rien n'est écrit.
// Même préparation que l'import (colonnes choisies dans « Mapping MEMS » comprises) : mêmes mois, mêmes comptes.
router.post('/forms/:id/import/preview', WRITE, express.raw({ type: '*/*', limit: '80mb' }), asyncHandler(async (req, res) => {
  const { submissions, headers, variables, source } = await readSubmissionsFile(req);
  const analysis = await repo.importPreview(t(req), uuidParam(req.params.id), submissions, variables ? variables.map((v) => v.name) : headers);
  if (!analysis) throw notFound('Formulaire introuvable');
  res.json({ source, fields: variables ? variables.length : headers.length, ...analysis });
}));

router.post('/forms/:id/import', WRITE, express.raw({ type: '*/*', limit: '80mb' }), asyncHandler(async (req, res) => {
  const { submissions, headers, variables } = await readSubmissionsFile(req);
  // Les variables du .sav nomment les colonnes (sans XLSForm) ou complètent les listes codées (avec).
  const result = await repo.importSubmissions(t(req), req.params.id, submissions,
    { variables, headers: variables ? variables.map((v) => v.name) : headers });
  if (!result) throw notFound('Formulaire introuvable');
  res.json({ ...result, fields: variables ? variables.length : headers.length });
}));

// ---- Import par LIEN (un seul point d'entrée, sécurisé) ----------------------
// Lien Tableau WDC / open-data Ona-MoDA, API Kobo v2, ou export CSV/XLSX/JSON :
// reconnu automatiquement (dataLinks.classifyLink), lu via safeFetch (anti-SSRF,
// délai, taille), importé par le pipeline commun ; source + curseur mémorisés.
const linkSchema = z.object({
  url: z.string().url().max(1000),
  token: z.string().trim().max(300).optional().or(z.literal('').transform(() => undefined)),
  full: z.boolean().optional(),
});
router.post('/forms/:id/link-pull', WRITE, body(linkSchema), asyncHandler(async (req, res) =>
  res.json(await dataLinks.importFromLink(t(req), req.params.id, req.valid))));

// Compatibilité : anciens points d'entrée, même implémentation.
const urlPullSchema = z.object({
  url: z.string().url().max(1000),
  token: z.string().trim().max(300).optional().or(z.literal('').transform(() => undefined)),
});
router.post('/forms/:id/url-pull', WRITE, body(urlPullSchema), asyncHandler(async (req, res) =>
  res.json(await dataLinks.importFromLink(t(req), req.params.id, req.valid))));
const koboSchema = z.object({
  baseUrl: z.string().url().max(200),
  assetUid: z.string().trim().regex(/^[A-Za-z0-9]{10,40}$/, 'UID Kobo invalide'),
  token: z.string().trim().min(6).max(200),
});
router.post('/forms/:id/kobo-pull', WRITE, body(koboSchema), asyncHandler(async (req, res) => {
  const { baseUrl, assetUid, token } = req.valid;
  const url = new URL(`/api/v2/assets/${assetUid}/data.json`, baseUrl).href;
  res.json(await dataLinks.importFromLink(t(req), req.params.id, { url, token }));
}));

// Computed indicator values for the dashboard.
router.get('/forms/:id/values', asyncHandler(async (req, res) => {
  const period = readPeriod(req.query, { maxSpan: ANALYSIS_MAX_SPAN });
  res.json(await repo.computeValues(t(req), uuidParam(req.params.id), { period }));
}));

// Dashboard restitution: coverage + per-bureau + indicator values + index.
router.get('/forms/:id/dashboard', asyncHandler(async (req, res) => {
  const period = readPeriod(req.query, { maxSpan: ANALYSIS_MAX_SPAN });
  res.json(await repo.dashboard(t(req), uuidParam(req.params.id), { period }));
}));

// Catalogue détaillé d'une fiche (champs + listes de choix issus du XLSForm).
router.get('/forms/:id/catalog', asyncHandler(async (req, res) => res.json(await repo.formCatalog(t(req), req.params.id))));

// Mapping « formulaire ↔ référentiels MEMS » : auto-détecté, surchargeable, avec son cycle de vie
// (brouillon → soumis → validé ; mapping.service + mappingWorkflow) et les actions permises.
router.get('/forms/:id/mems-mapping', asyncHandler(async (req, res) =>
  res.json(await mapping.getMapping(t(req), uuidParam(req.params.id), req.auth))));

// Surcharge manuelle d'une dimension (column '' = « non reliée ») — 409 hors brouillon.
router.put('/forms/:id/mems-mapping', WRITE,
  body(z.object({ dimension: z.string().trim().min(1).max(40), column: z.string().trim().max(200).optional().default('') })),
  asyncHandler(async (req, res) => {
    res.json(await mapping.setDimension(t(req), uuidParam(req.params.id), req.valid.dimension, req.valid.column));
  }));

// Rétablit la détection automatique d'une dimension — 409 hors brouillon.
router.delete('/forms/:id/mems-mapping/:dimension', WRITE, asyncHandler(async (req, res) => {
  await mapping.resetDimension(t(req), uuidParam(req.params.id), String(req.params.dimension));
  res.status(204).end();
}));

// Cycle de vie : soumettre, valider (par une autre personne que le soumetteur), réinitialiser.
const noBody = body(z.object({}).strict().optional());
for (const action of ['submit', 'validate', 'reset']) {
  router.post(`/forms/:id/mapping/${action}`, WRITE, noBody, asyncHandler(async (req, res) =>
    res.json(await mapping.transition(t(req), uuidParam(req.params.id), action, req.auth))));
}

// Réapplique le mapping en vigueur aux soumissions déjà importées (à tout statut du mapping).
router.post('/forms/:id/mems-mapping/apply', WRITE, asyncHandler(async (req, res) => {
  res.json(await repo.applyMappingToSubmissions(t(req), uuidParam(req.params.id)));
}));

// ---- Nettoyage : champs calculés + exclusion -----------------------------
router.get('/forms/:id/calc-fields', asyncHandler(async (req, res) => res.json(await repo.listCalcFields(t(req), req.params.id))));

const calcDefinition = {
  kind: z.enum(['expression', 'recode']),
  expression: z.string().trim().max(500).optional(),
  sourceField: z.string().trim().max(120).optional(),
  mapping: z.record(z.string(), z.any()).optional(),
  defaultValue: z.any().optional(),
};
const calcSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Nom : lettres/chiffres/_ , sans espace').max(60),
  label: z.string().trim().max(120).optional(),
  ...calcDefinition,
});
/**
 * Formule ou recodage invalide : 400 avec la cause précise (et sa position), jamais enregistré.
 * La formule vérifiée est celle SAISIE (avant suppression des espaces) : la position annoncée
 * est celle que l'utilisateur voit dans l'éditeur.
 */
function assertCalcValid(v, typed) {
  if (v.kind === 'recode') { if (!v.sourceField) throw badRequest('Choisissez la variable à recoder.'); return; }
  const err = validateExpression(typeof typed === 'string' && typed.trim() === v.expression ? typed : v.expression);
  if (err) throw badRequest(`Formule invalide : ${err}`);
}

// Variables d'une fiche (catalogue + colonnes des données + champs calculés) pour l'éditeur de formule.
router.get('/forms/:id/variables', asyncHandler(async (req, res) => {
  const out = await repo.formVariables(t(req), uuidParam(req.params.id));
  if (!out) throw notFound('Fiche introuvable');
  res.json(out);
}));
// Catalogue des fonctions et opérateurs (éditeur de formule, page « Comment les calculs sont faits »).
router.get('/calc-functions', (req, res) => res.json(functionCatalog()));
// Aperçu d'un champ calculé sur les soumissions réelles de la fiche (rien n'est enregistré).
router.post('/forms/:id/calc-fields/preview', body(z.object({ ...calcDefinition, excludeId: z.string().uuid().optional() })), asyncHandler(async (req, res) => {
  const { excludeId, ...def } = req.valid;
  // Vie privée (lot 6a) : coordonnées des ménages retirées pour les rôles autres qu'admin / gestionnaire.
  const out = await repo.calcPreview(t(req), uuidParam(req.params.id), def, { excludeId, precise: seesPreciseGps(req.auth.role) });
  if (!out) throw notFound('Fiche introuvable');
  res.json(out);
}));

router.post('/forms/:id/calc-fields', WRITE, body(calcSchema), asyncHandler(async (req, res) => {
  assertCalcValid(req.valid, req.body?.expression);
  try { res.status(201).json({ id: await repo.createCalcField(t(req), req.params.id, req.valid) }); }
  catch (err) { if (err.code === '23505') throw badRequest('Un champ calculé porte déjà ce nom.'); throw err; }
}));
router.patch('/calc-fields/:id', WRITE, body(calcSchema), asyncHandler(async (req, res) => {
  assertCalcValid(req.valid, req.body?.expression);
  if (!(await repo.updateCalcField(t(req), req.params.id, req.valid))) throw notFound('Champ calculé introuvable');
  res.status(204).end();
}));
router.delete('/calc-fields/:id', WRITE, asyncHandler(async (req, res) => {
  if (!(await repo.deleteCalcField(t(req), req.params.id))) throw notFound('Champ calculé introuvable');
  res.status(204).end();
}));

// Exclusion / réintégration de soumissions (curation avant analyse).
const exclSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  excluded: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});
router.post('/forms/:id/exclude', WRITE, body(exclSchema), asyncHandler(async (req, res) => {
  res.json(await repo.setExclusion(t(req), req.params.id, req.valid));
}));

// Soumissions brutes d'une fiche (données importées) — visualisation par fiche.
// Vie privée (lot 6a) : les coordonnées GPS des réponses sont celles des ménages enquêtés ;
// un lecteur ne les reçoit jamais (map/submissionGps.stripGps), seuls admin / gestionnaire.
router.get('/forms/:id/submissions', asyncHandler(async (req, res) => {
  const period = readPeriod(req.query, { maxSpan: LIST_MAX_SPAN });
  const limit = Number(req.query.limit);
  const precise = seesPreciseGps(req.auth.role);
  // Le dépôt retire les coordonnées avant les champs calculés ; second filet ici, sur la réponse.
  const out = await repo.formSubmissions(t(req), uuidParam(req.params.id), { period, limit: Number.isFinite(limit) ? limit : undefined, precise });
  if (!precise) {
    const rows = Array.isArray(out) ? out : (out && out.rows);
    for (const r of rows || []) if (r && r.data) r.data = stripGps(r.data);
  }
  res.json(out);
}));

// Import d'une DÉFINITION XLSForm (.xlsx Kobo/ODK : feuilles survey/choices/
// settings) → crée/MAJ la fiche + son catalogue de champs et listes de choix.
router.post('/import-definition', WRITE, express.raw({ type: '*/*', limit: '60mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  // .xls (Excel 97-2003, encore produit par Kobo/ODK) : lecteur intégré ; .xlsx : ExcelJS,
  // après la garde de décompression. Format reconnu par le contenu, pas par le nom.
  const sniff = sniffFile(req.body);
  if (sniff.kind !== 'ole' && sniff.kind !== 'xlsx') {
    const data = ['text', 'sav', 'zsav', 'zip'].includes(sniff.kind)
      ? ' Pour des données collectées, ouvrez la fiche puis « Importer un fichier ».' : '';
    throw badRequest(`Ce fichier n'est pas un XLSForm (format reconnu : ${sniff.label}). `
      + `Fournissez la définition du formulaire : un .xlsx ou .xls avec les feuilles « survey » et « choices ».${data}`);
  }
  let sheetRows;
  if (sniff.kind === 'ole') {
    let xls;
    try { xls = readXls(req.body); } catch (err) { throw badRequest(err instanceof XlsError ? err.message : 'Fichier .xls illisible.'); }
    const byName = new Map(Object.entries(xls.sheets).map(([k, v]) => [k.trim().toLowerCase(), v]));
    sheetRows = (name) => byName.get(name) || [];
  } else {
    let wb;
    try { wb = await loadWorkbook(req.body, { zipLimits: zipLimitsFromEnv(process.env) }); }
    catch (err) { if (isRefusal(err)) throw err; throw badRequest('Fichier illisible : fournissez un XLSForm .xlsx ou .xls (feuilles survey/choices/settings).'); }
    sheetRows = (name) => {
      const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === name);
      return ws ? sheetTable(ws) : [];
    };
  }
  const survey = sheetRows('survey');
  if (survey.length < 2) {
    throw badRequest('Feuille « survey » introuvable ou vide — ce n\'est pas un XLSForm. '
      + 'Pour des données collectées, ouvrez la fiche puis « Importer un fichier ».');
  }
  const parsed = parseXlsformRows(survey, sheetRows('choices'), sheetRows('settings'));
  if (parsed.fields.length === 0) throw badRequest('Aucun champ de données trouvé dans la feuille survey.');
  // Sans form_id (fréquent dans les .xls), code stable tiré du titre : un réimport met la fiche à jour au lieu d'en créer une autre.
  const slug = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const code = (parsed.formId || slug(parsed.title) || `form_${Date.now()}`).slice(0, 60);
  const label = parsed.title || code;
  const result = await repo.importDefinition(t(req), { code, label }, parsed.fields, parsed.choices);
  res.json({ ...result, code, label });
}));

// Synthèse transversale « Suivi de processus » (toutes fiches agrégées).
// Période : ?from=AAAA-MM&to=AAAA-MM (bornes incluses), ou ?month=AAAA-MM (= from = to) ;
// sans paramètre : toutes les périodes. Période mal formée : 400 avec details.code.
const analysisPeriod = (req) => readPeriod(req.query, { maxSpan: ANALYSIS_MAX_SPAN });
router.get('/overview', asyncHandler(async (req, res) => res.json(await repo.processOverview(t(req), analysisPeriod(req)))));

// Volume de données par mois + période par défaut des écrans d'analyse (retour n° 16).
// `today` = mois courant du navigateur (sinon celui du serveur, UTC) : la règle ignore les mois futurs.
const periodsQuery = z.object({ today: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
router.get('/periods', asyncHandler(async (req, res) => {
  const parsed = periodsQuery.safeParse(req.query);
  if (!parsed.success) throw badRequest('Mois invalide (attendu : AAAA-MM)', parsed.error.flatten());
  const todayMonth = parsed.data.today || new Date().toISOString().slice(0, 7);
  res.json(await periodsService.periods(t(req), { todayMonth }));
}));

// Tableau de bord « Couverture & performance » — détail conformité par activité
// (fiche) : bandes, dimensions, top/flop, tendance, bureaux + régions.
router.get('/coverage-dashboard', asyncHandler(async (req, res) => res.json(await repo.coverageDashboard(t(req), analysisPeriod(req)))));

// Données réelles brutes (soumissions), filtrables par mois — alimente la
// « table des données actuelles » rattachée au plan de suivi.
router.get('/submissions', asyncHandler(async (req, res) => {
  const period = readPeriod(req.query, { maxSpan: LIST_MAX_SPAN });
  const limit = Number(req.query.limit);
  res.json(await repo.listSubmissions(t(req), { period, limit: Number.isFinite(limit) ? limit : undefined }));
}));

module.exports = router;
