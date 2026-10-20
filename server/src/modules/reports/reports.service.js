const ExcelJS = require('exceljs');
const { badRequest, payloadTooLarge, AppError } = require('../../middleware/errors');
const { withQueryTimeout } = require('../../config/db');
const { createSemaphore } = require('./semaphore');
const { upgradeDoc, upgradeSnapshot, rekeySnapshotBlocks, isV1 } = require('./reportUpgrade');
const { safeParseDocV2, walkBlocks, imageRefs } = require('./reportSchema');
const assetsRepo = require('./reportAssets.repository');
const { DATASETS, KPIS, GROUPS, datasetDef, kpiDef, validateBlockParams, catalogForClient } = require('./catalog');
const { loadFor } = require('./sources');
const { dashScope } = require('./catalog/coverage');
const { buildPlan, blockOfInstance, PlanError, richVariables } = require('./renderPlan');
const { VARIABLES } = require('./reportModel');
const { SYSTEM_TEMPLATES } = require('./reportTemplates');
const { bulletinDoc, bulletinFindings, BULLETIN_METRICS } = require('./reportData');
const { periodLabel } = require('../common/period');
const { phrases } = require('./phrases');
const repo = require('./reports.repository');

/**
 * Concepteur de rapport — orchestration (lot 7a).
 *  1. normalisation : document v1 mis à niveau (reportUpgrade), schéma v2 (reportSchema),
 *     paramètres de chaque bloc contre le catalogue (jeu connu, vue permise, args) ;
 *  2. plan (renderPlan, pur) : sections répétées dépliées, instances, figures numérotées ;
 *  3. données : chaque instance calculée par son jeu de données (catalogue → source → mise
 *     en forme), l'une après l'autre ; une erreur reste celle de SON bloc.
 * Un document finalisé renvoie ses données figées (jamais recalculées).
 */

const today = () => new Date().toISOString().slice(0, 10);
const langOf = (opts) => (opts && opts.lang === 'en' ? 'en' : 'fr');

/** Bureaux du client : nom (minuscules) → id, id → nom, id → bureau parent. */
async function officeIndex(tenantId) {
  const rows = await repo.listOffices(tenantId);
  return {
    idByName: new Map(rows.map((o) => [String(o.name).trim().toLowerCase(), o.id])),
    nameById: new Map(rows.map((o) => [o.id, o.name])),
    parentById: new Map(rows.map((o) => [o.id, o.parentId || null])),
  };
}

const viewsOf = (key) => { const d = datasetDef(key); return d ? { views: d.views, defaultView: d.defaultView } : null; };

/** Paramètres de chaque bloc contre le catalogue (jeu connu et disponible, vue, args, chiffres clés). */
function catalogIssues(doc) {
  const issues = [];
  walkBlocks(doc.blocks, (b, path) => {
    if (b.type === 'data') {
      for (const i of validateBlockParams(datasetDef(b.params.dataset), b.params)) issues.push({ path: [...path, 'params', ...i.path], message: i.message });
    }
    if (b.type === 'kpis') {
      b.params.metrics.forEach((m, i) => { if (!kpiDef(m)) issues.push({ path: [...path, 'params', 'metrics', i], message: `Chiffre clé inconnu : ${m}` }); });
    }
  });
  return issues;
}

/**
 * Document reçu ou enregistré (v1 ou v2) → v2 validé.
 * @returns {Promise<{ doc, warnings, upgraded, offices }>}
 */
async function normalizeDoc(tenantId, input, { offices } = {}) {
  const idx = offices || await officeIndex(tenantId);
  const up = upgradeDoc(input, { officeIdByName: idx.idByName, viewsOf });
  const r = safeParseDocV2(up.doc);
  if (!r.success) {
    const big = r.error.issues.find((i) => i.params && i.params.code === 'doc_too_large');
    if (big) throw payloadTooLarge(big.message, { code: 'doc_too_large' });
    throw badRequest('Rapport invalide', r.error.flatten());
  }
  const issues = catalogIssues(r.data);
  if (issues.length) throw badRequest('Rapport invalide', { issues });
  // Images citées (logos des bandes, blocs image) : celles du compte seulement, jamais prises pour vraies.
  const refs = [...new Set(imageRefs(r.data))];
  if (refs.length) {
    const known = await assetsRepo.existingAssetIds(tenantId, refs);
    const missing = refs.filter((id) => !known.has(id));
    if (missing.length) throw badRequest('Image introuvable dans ce compte : téléversez-la à nouveau.', { code: 'asset_missing', ids: missing });
  }
  return { doc: r.data, warnings: up.warnings, upgraded: up.upgraded, offices: idx };
}

/** Éléments des sections répétées (plan) : fiches, bureaux ou partenaires ayant des données. */
async function expandRepeats(tenantId, doc, lang) {
  const out = {};
  const T = phrases(lang);
  for (const b of doc.blocks) {
    if (b.type !== 'repeat') continue;
    const f = doc.filters || {};
    if (b.params.over === 'activity') {
      const rows = await repo.repeatCandidates(tenantId, 'activity', doc.period);
      out[b.id] = rows.filter((r) => !f.formId || r.id === f.formId)
        .filter((r) => !f.activity || (r.activityCategory || '').toLowerCase() === f.activity.toLowerCase())
        .map((r) => ({ key: r.id, label: r.label, filters: { formId: r.id } }));
    } else if (b.params.over === 'bureau') {
      const { offices, unlinked } = await repo.repeatCandidates(tenantId, 'bureau', doc.period);
      const items = offices.map((o) => ({ key: `id:${o.id}`, label: o.name, filters: { office: `id:${o.id}` } }));
      if (unlinked) items.push({ key: 'unlinked', label: T.unlinkedOffice, filters: { office: 'unlinked' } });
      out[b.id] = items.filter((it) => !f.office || it.key === f.office);
    } else {
      const rows = await repo.repeatCandidates(tenantId, 'partner', doc.period);
      out[b.id] = rows.filter((r) => !f.partnerId || r.id === f.partnerId)
        .map((r) => ({ key: r.id, label: r.name, filters: { partnerId: r.id } }));
    }
  }
  return out;
}

const kpiKeys = () => new Set(Object.keys(KPIS));
/**
 * {bureau} des en-têtes et pieds : le bureau filtré par le rapport (nom MEMS, libellé d'une fiche,
 * « Soumissions sans bureau MEMS relié »), sinon « Tous les bureaux ».
 */
function officeVar(doc, offices, lang) {
  const o = (doc.filters || {}).office;
  const T = phrases(lang);
  if (!o) return T.allOffices;
  if (o === 'unlinked') return T.unlinkedOffice;
  if (o.startsWith('id:')) return (offices && offices.nameById && offices.nameById.get(o.slice(3))) || T.allOffices;
  if (o.startsWith('lib:')) return o.slice(4);
  return o.split(':').slice(2).join(':') || T.allOffices; // code:<fiche>:<code>
}
const planOf = (doc, expansions, lang, offices = null) => {
  try {
    return buildPlan(doc, { expansions, kpiKeys: kpiKeys(), lang, today: today(), defaultView: (k) => (datasetDef(k) || {}).defaultView || 'table', simpleVars: { bureau: officeVar(doc, offices, lang) } });
  } catch (e) {
    if (e instanceof PlanError) throw badRequest(e.message, { code: e.code, ...e.details });
    throw e;
  }
};

// Filtre effectif → filtre déclaré par un jeu, et note quand il n'est pas pris en charge.
const FILTER_OF = { office: ['office', 'notByOffice'], activity: ['activity', 'notByActivity'], partnerId: ['partner', 'notByPartner'], formId: ['form', 'notByForm'], module: ['module', 'notByModule'] };
function unsupportedNote(def, eff, lang) {
  for (const [k, [name, phrase]] of Object.entries(FILTER_OF)) {
    if (eff[k] != null && !(def.filters || []).includes(name)) return phrases(lang)[phrase];
  }
  // Clé de bureau non filtrable par cette source (ex. libellé d'une fiche pour des faits de sites).
  if (eff.office && def.officeKinds) {
    const kind = eff.office === 'unlinked' ? 'unlinked' : eff.office.split(':')[0];
    if (!def.officeKinds.includes(kind)) return phrases(lang).notByUnlinkedOffice;
  }
  return null;
}

/** Tri (valeurs vides en dernier) et nombre de lignes au plus. */
function sortAndLimit(rows, { sort, limit } = {}) {
  let out = rows;
  if (sort && sort.key) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    out = [...rows].sort((a, b) => {
      const x = a[sort.key]; const y = b[sort.key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) * dir;
    });
  }
  return limit ? out.slice(0, limit) : out;
}

/** Données d'un bloc « données ». */
async function dataBlock(tenantId, block, eff, ctx) {
  const T = phrases(ctx.lang);
  const def = datasetDef(block.params.dataset);
  if (!def) return { columns: [], rows: [], meta: { note: T.unknownDataset } };
  if (def.available === false) return { columns: def.columns, rows: [], meta: { note: def.reason, unavailable: true } };
  const note = unsupportedNote(def, eff, ctx.lang);
  if (note) return { columns: def.columns, rows: [], meta: { note, unsupported: true } };
  const args = withDefaults(def, block.params.args);
  const raw = await loadFor(def, tenantId, eff, args, ctx);
  const shaped = def.shape(raw, eff, { ...ctx, args });
  const rows = sortAndLimit(shaped.rows || [], block.params);
  const groupLabel = (GROUPS.find((g) => g.key === def.group) || {}).label || '';
  const m = shaped.meta || {};
  return {
    columns: shaped.columns || def.columns,
    rows,
    meta: {
      ...m,
      n: m.n != null ? m.n : (shaped.rows || []).length,
      nLabel: m.nLabel || null,
      total: (shaped.rows || []).length,
      source: m.source || T.source(def.sourceLabel || groupLabel),
      asOf: m.asOf || null,
      note: m.note || ((shaped.rows || []).length ? null : T.noData),
      definition: m.definition || null,
      warnings: m.warnings || [],
      periodMode: def.periodMode,
      period: eff.period,
      dataPeriod: m.dataPeriod || dataPeriodOf(def.periodMode, eff),
    },
  };
}

/**
 * Période réellement couverte quand elle diffère de la plage du bloc (dite dans la légende de la
 * figure, retour 87) : l'exercice entier d'un jeu « année ». Un jeu « situation au » porte déjà sa
 * date (`asOf`) ; un jeu « plage » couvre la plage.
 */
function dataPeriodOf(mode, eff) {
  if (mode !== 'year' || !eff.period) return null;
  const y = String(eff.period.to).slice(0, 4);
  return { from: `${y}-01`, to: `${y}-12` };
}

/** Arguments d'un bloc complétés par les valeurs par défaut déclarées par le jeu. */
function withDefaults(def, args) {
  const out = { ...(args || {}) };
  for (const [k, spec] of Object.entries(def.args || {})) if (out[k] == null && spec.default != null) out[k] = spec.default;
  return out;
}

/** Valeurs de chiffres clés (bloc « kpis » et variables des textes). */
async function kpiValues(tenantId, metrics, eff, ctx) {
  const values = {}; const notes = {};
  for (const m of metrics) {
    const def = kpiDef(m);
    if (!def || def.available === false) { values[m] = null; notes[m] = def ? def.reason : null; continue; }
    const note = unsupportedNote(def, eff, ctx.lang);
    if (note) { values[m] = null; notes[m] = note; continue; }
    const raw = await loadFor(def, tenantId, eff, {}, ctx);
    const r = def.pick(raw, eff, ctx) || {};
    values[m] = r.value == null ? null : r.value;
    if (r.note) notes[m] = r.note;
  }
  return { values, notes };
}


/** Données d'une instance (selon le type de bloc). */
async function computeData(tenantId, doc, inst, block, ctx) {
  const eff = inst.filters || { period: doc.period };
  switch (block.type) {
    case 'data': return dataBlock(tenantId, block, eff, ctx);
    case 'kpis': return kpiValues(tenantId, block.params.metrics, eff, ctx);
    case 'bulletin': {
      if (block.params.doc) return { doc: block.params.doc, generated: false };
      // Mêmes chiffres que les blocs « chiffres clés » (catalogue), mêmes sources.
      const { values } = await kpiValues(tenantId, BULLETIN_METRICS, eff, ctx);
      const monDef = datasetDef('mon.forms_index');
      const covDef = datasetDef('cov.by_activity');
      const mon = unsupportedNote(monDef, eff, ctx.lang) ? null : await loadFor(monDef, tenantId, eff, {}, ctx);
      const cov = unsupportedNote(covDef, eff, ctx.lang) ? null : await loadFor(covDef, tenantId, eff, {}, ctx);
      return { doc: bulletinDoc(values, bulletinFindings(mon, cov && dashScope(cov, eff)), periodLabel(eff.period, ctx.lang), ctx.lang), generated: true };
    }
    case 'text': case 'callout': {
      const metrics = richVariables(block.params.doc).filter((v) => KPIS[v]);
      const { values } = await kpiValues(tenantId, metrics, eff, ctx);
      return { vars: values };
    }
    default: return null;
  }
}

/** Instance calculée, son erreur isolée : { ok, data, meta: { ms } } | { ok: false, error }. */
async function computeInstance(tenantId, doc, inst, ctx) {
  const block = blockOfInstance(doc, inst.iid);
  const t0 = Date.now();
  try {
    if (!block) return { ok: false, error: { code: 'unknown_block', message: `Bloc inconnu : ${inst.iid}` } };
    const data = await computeData(tenantId, doc, inst, block, ctx);
    return { ok: true, data, meta: { ms: Date.now() - t0 } };
  } catch (e) {
    const T = phrases(ctx.lang);
    const timeout = e && e.code === '57014';
    if (!timeout && !(e instanceof AppError)) ctx.log && ctx.log.error({ err: e, iid: inst.iid }, 'report.block');
    return {
      ok: false, meta: { ms: Date.now() - t0 },
      error: { code: timeout ? 'timeout' : (e && e.statusCode ? 'invalid' : 'failed'), message: timeout ? T.tooLong : (e instanceof AppError ? e.message : T.failed) },
    };
  }
}

// Rendu par blocs (lot 7a) : 8 instances au plus par appel ; au plus REPORT_HEAVY_MAX (4) calculs
// simultanés par processus, attente 20 s au plus (503 « réessayez ») ; 15 s par requête SQL.
const MAX_IIDS = 8;
const QUERY_TIMEOUT = '15s';
const heavy = createSemaphore(Math.max(1, Number(process.env.REPORT_HEAVY_MAX) || 4));

/** Calcul d'une instance sous le sémaphore et le délai par requête. */
async function computeGuarded(tenantId, doc, inst, ctx) {
  let release;
  try {
    release = await heavy.acquire(20000);
  } catch (e) {
    if (e.code === 'queue_timeout') throw new AppError(503, e.message, { code: 'queue_timeout' });
    throw e;
  }
  try {
    return await withQueryTimeout(QUERY_TIMEOUT, () => computeInstance(tenantId, doc, inst, ctx));
  } finally {
    release();
  }
}

/** Contexte de rendu : langue, jour, bureaux, calculs partagés. */
const renderCtx = (offices, opts) => ({
  lang: langOf(opts), today: today(), officeNames: offices.nameById, officeParents: offices.parentById || new Map(), memo: new Map(), log: opts && opts.log,
});

/**
 * Rendu complet (compatibilité, exports, soumission) : plan + données de toutes les instances.
 * @returns {Promise<{ periodLabel, vars, sections, instances, expansions, blocks, warnings, upgraded }>}
 */
async function renderReport(tenantId, input, opts = {}) {
  const lang = langOf(opts);
  const { doc, warnings, upgraded, offices } = await normalizeDoc(tenantId, input);
  const expansions = await expandRepeats(tenantId, doc, lang);
  const plan = planOf(doc, expansions, lang, offices);
  const ctx = renderCtx(offices, opts);
  const blocks = {};
  for (const inst of plan.instances) if (inst.needsData) blocks[inst.iid] = await computeGuarded(tenantId, doc, inst, ctx); // une à la fois
  return { ...plan, blocks, warnings, upgraded };
}

/**
 * PLAN seul (rendu progressif) : document validé, sections répétées dépliées par des
 * comptages, instances, figures numérotées, variables — sans calcul lourd.
 */
async function renderPlanFor(tenantId, input, opts = {}) {
  const t0 = Date.now();
  const lang = langOf(opts);
  const { doc, warnings, upgraded, offices } = await normalizeDoc(tenantId, input);
  const expansions = await expandRepeats(tenantId, doc, lang);
  const plan = planOf(doc, expansions, lang, offices);
  return { ...plan, warnings, upgraded, computedAt: new Date().toISOString(), ms: Date.now() - t0 };
}

/**
 * Données de quelques instances (8 au plus), l'une après l'autre ; l'erreur d'un bloc
 * reste celle de ce bloc. Un identifiant inconnu (document modifié entre-temps) → 400.
 * @returns {Promise<{ blocks: Object<string, object>, timings: {iid, ms, ok}[], planMs: number }>}
 */
async function renderBlocks(tenantId, input, iids, opts = {}) {
  if (!Array.isArray(iids) || !iids.length || iids.length > MAX_IIDS || iids.some((x) => typeof x !== 'string' || x.length > 400)) {
    throw badRequest(`Demandez de 1 à ${MAX_IIDS} blocs à la fois.`, { code: 'bad_iids', max: MAX_IIDS });
  }
  const t0 = Date.now();
  const lang = langOf(opts);
  const { doc, offices } = await normalizeDoc(tenantId, input);
  const expansions = await expandRepeats(tenantId, doc, lang);
  const plan = planOf(doc, expansions, lang, offices);
  const byIid = new Map(plan.instances.map((i) => [i.iid, i]));
  const unknown = iids.filter((x) => !byIid.has(x));
  if (unknown.length) throw badRequest('Bloc inconnu : rechargez le plan du rapport.', { code: 'unknown_iid', iids: unknown });
  const planMs = Date.now() - t0;
  const ctx = renderCtx(offices, opts);
  const blocks = {}; const timings = [];
  for (const iid of [...new Set(iids)]) {
    const inst = byIid.get(iid);
    blocks[iid] = inst.needsData ? await computeGuarded(tenantId, doc, inst, ctx) : { ok: true, data: null, meta: { ms: 0 } };
    timings.push({ iid, ms: blocks[iid].meta ? blocks[iid].meta.ms : 0, ok: blocks[iid].ok });
  }
  return { blocks, timings, planMs };
}

// ---- Documents ----------------------------------------------------------------------------
/** Document enregistré, contenu mis à niveau (v2) ; les données figées ne sont pas renvoyées ici. */
async function getDocument(tenantId, id) {
  const d = await repo.getDocument(tenantId, id);
  const { snapshot: _snapshot, content, ...rest } = d;
  const offices = await officeIndex(tenantId);
  const up = upgradeDoc(content, { officeIdByName: offices.idByName, viewsOf });
  return { ...rest, content: up.doc, upgradedFrom: isV1(content) ? 1 : null, warnings: up.warnings };
}

/** Données d'un document : figées s'il est finalisé (jamais recalculées), sinon calculées. */
async function documentData(tenantId, id, opts) {
  const d = await repo.getDocument(tenantId, id);
  if (d.status !== 'final') return renderReport(tenantId, d.content, opts);
  const frozen = upgradeSnapshot(d.snapshot) || {};
  const offices = await officeIndex(tenantId);
  const up = upgradeDoc(d.content, { officeIdByName: offices.idByName, viewsOf });
  const parsed = safeParseDocV2(up.doc);
  if (!parsed.success) return { frozen: true, blocks: frozen.blocks || {}, instances: [], sections: [], expansions: {}, periodLabel: frozen.periodLabel };
  const lang = (d.snapshot && d.snapshot.lang) || langOf(opts);
  const plan = buildPlan(parsed.data, { expansions: frozen.expansions || {}, kpiKeys: kpiKeys(), lang, defaultView: (k) => (datasetDef(k) || {}).defaultView || 'table' });
  // Constats remis sur les nouvelles clés à cette lecture (document finalisé avant `rowKeys: 2`) :
  // ses lignes figées le sont de la même façon — sinon le « Constat » ne retrouve plus sa ligne.
  const blocks = { ...((up.rekeyed ? rekeySnapshotBlocks(frozen.blocks, plan.instances) : frozen.blocks) || {}) };
  // Texte avec chiffres clés (v1) : les valeurs figées du rapport.
  for (const inst of plan.instances) {
    if (inst.needsData && !blocks[inst.iid] && (inst.type === 'text' || inst.type === 'callout')) blocks[inst.iid] = { ok: true, data: { vars: frozen.vars || {} } };
  }
  return { ...plan, periodLabel: frozen.periodLabel || plan.periodLabel, blocks, frozen: true };
}

// Les données figées gardent la langue dans laquelle le rapport a été finalisé.
async function finalize(tenantId, id, version, userId, opts) {
  const d = await repo.getDocument(tenantId, id);
  const r = await renderReport(tenantId, d.content, opts);
  const snapshot = { format: 2, frozen: true, lang: langOf(opts), periodLabel: r.periodLabel, expansions: r.expansions, blocks: r.blocks };
  return repo.finalizeDocument(tenantId, id, { version, snapshot }, userId);
}

/** Modèles d'équipe : contenu mis à niveau à la lecture. */
async function listTemplates(tenantId) {
  const rows = await repo.listTemplates(tenantId);
  const offices = await officeIndex(tenantId);
  return rows.map((t) => {
    const up = upgradeDoc(t.content, { officeIdByName: offices.idByName, viewsOf });
    return { ...t, content: up.doc };
  });
}

function catalog() {
  return {
    catalogVersion: 2,
    ...catalogForClient(),
    variables: VARIABLES,
    templates: SYSTEM_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, system: true, content: t.content })),
    pageSizes: { A4: { portrait: [210, 297], landscape: [297, 210] }, '16:9': { portrait: [190.5, 338.67], landscape: [338.67, 190.5] } },
  };
}

// ---- Export Excel : une feuille par bloc de données, plus « Lisez-moi » -------------------
function sheetName(wb, raw) {
  const base = String(raw || 'Données').replace(/[\\/*?:[\]]/g, ' ').slice(0, 28).trim() || 'Données';
  let name = base; let i = 2;
  while (wb.getWorksheet(name)) { name = `${base.slice(0, 25)} ${i}`; i += 1; }
  return name;
}

function addTable(wb, title, data) {
  const ws = wb.addWorksheet(sheetName(wb, title));
  ws.addRow([title]).font = { bold: true, size: 13 };
  if (data.meta && data.meta.source) ws.addRow([data.meta.source]).font = { italic: true, color: { argb: 'FF616A7A' } };
  ws.addRow([]);
  const header = ws.addRow(data.columns.map((c) => c.label));
  header.font = { bold: true }; header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E9EF' } }; });
  const headRow = header.number;
  if (!data.rows.length && data.meta && data.meta.note) ws.addRow([data.meta.note]);
  for (const r of data.rows) ws.addRow(data.columns.map((c) => (r[c.key] == null ? '' : r[c.key])));
  data.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.type === 'text' ? 34 : 14;
    if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0';
    if (c.type === 'dec') ws.getColumn(i + 1).numFmt = '#,##0.000';
  });
  ws.views = [{ state: 'frozen', ySplit: headRow }];
}

async function exportXlsx(tenantId, input, opts) {
  const r = await renderReport(tenantId, input, opts);
  const { doc } = await normalizeDoc(tenantId, input);
  const wb = new ExcelJS.Workbook(); wb.creator = 'MEMS 2.0';
  const readme = wb.addWorksheet('Lisez-moi', { properties: { tabColor: { argb: 'FF0F6CBD' } } });
  readme.addRow([doc.title]).font = { bold: true, size: 14 };
  readme.addRow(['Période', r.periodLabel]);
  const f = doc.filters || {};
  readme.addRow(['Filtres du rapport', Object.entries(f).map(([k, v]) => `${k} = ${v}`).join(' · ') || '—']);
  readme.addRow(['Édité le', today()]);
  readme.addRow(['Statut', 'Brouillon — non validé']);
  readme.addRow([]);
  readme.addRow(['Feuille', 'Source']).font = { bold: true };
  readme.columns = [{ width: 36 }, { width: 80 }];

  const kpiRows = [];
  for (const inst of r.instances) {
    const res = r.blocks[inst.iid];
    if (!res || !res.ok || !res.data) continue;
    const block = blockOfInstance(doc, inst.iid);
    const prefix = inst.repeatLabel ? `${inst.repeatLabel} — ` : '';
    if (block.type === 'data') {
      const def = DATASETS[block.params.dataset];
      const title = `${prefix}${(block.params.figure && block.params.figure.title) || (def ? def.label : block.params.dataset)}`;
      addTable(wb, title, res.data);
      readme.addRow([title, (res.data.meta && res.data.meta.source) || '']);
    }
    if (block.type === 'kpis') {
      for (const [k, v] of Object.entries(res.data.values || {})) kpiRows.push([prefix.replace(/ — $/, '') || doc.title, (KPIS[k] || {}).label || k, v]);
    }
  }
  if (kpiRows.length) {
    const ws = wb.addWorksheet('Chiffres clés');
    ws.addRow([`${doc.title} — ${r.periodLabel}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    ws.addRow(['Périmètre', 'Indicateur', 'Valeur']).font = { bold: true };
    kpiRows.forEach((row) => ws.addRow(row));
    ws.columns = [{ width: 40 }, { width: 34 }, { width: 16 }];
  }
  return wb;
}

module.exports = {
  renderReport, renderPlanFor, renderBlocks, MAX_IIDS, normalizeDoc, expandRepeats, computeInstance, renderCtx, planOf, officeIndex,
  getDocument, documentData, finalize, listTemplates, catalog, exportXlsx, catalogIssues, unsupportedNote, officeVar,
};
