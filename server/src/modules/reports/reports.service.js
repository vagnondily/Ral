const ExcelJS = require('exceljs');
const { badRequest } = require('../../middleware/errors');
const { parseReport, safeParseReport, periodLabel, variableValues, DATASETS, KPIS } = require('./reportModel');
const { buildDataset, computeKpis, repeatItems, bulletinDoc } = require('./reportData');
const { SYSTEM_TEMPLATES } = require('./reportTemplates');
const repo = require('./reports.repository');
const monitoringRepo = require('../monitoring/monitoring.repository');
const fieldRepo = require('../tpm/field.repository');
const pddRepo = require('../pdd/pdd.repository');
const consolidationRepo = require('../tpm/consolidation.repository');

/**
 * Concepteur de rapport — orchestration. Le rendu calcule UNE fois les sources
 * nécessaires aux blocs (en parallèle), puis met en forme chaque bloc (pure).
 * Un document finalisé renvoie ses données figées (snapshot).
 */
const MONITORING_SETS = new Set(['activity_coverage', 'activity_domains', 'bureau_domains', 'indicator_list', 'completeness_monthly', 'region_submissions']);
const FIELD_SETS = new Set(['bureau_coverage', 'plan_vs_actual']);

function validate(input) {
  const r = safeParseReport(input);
  if (!r.success) throw badRequest('Rapport invalide', r.error.flatten());
  return r.data;
}

// Variables insérées dans un texte riche ({ nodes: [{ c: [{ v }] | items: [[{ v }]] }] }).
function docVariables(doc) {
  const out = [];
  for (const n of (doc && doc.nodes) || []) {
    for (const s of [...(n.c || []), ...(n.items || []).flat()]) if (s && s.v) out.push(s.v);
  }
  return out;
}

/**
 * Sources requises par les blocs (dépliant les blocs répétés), y compris les
 * chiffres insérés comme variables dans les textes. La couverture a besoin du
 * terrain : sans catégorie d'activité sur les fiches, ses sites actifs
 * viennent des bureaux.
 */
function requiredSources(blocks) {
  const need = { monitoring: false, field: false, budget: false, pdd: false };
  const metrics = (m) => {
    if (m.some((k) => ['sites_active', 'sites_visited', 'coverage', 'submissions', 'conformity'].includes(k))) need.monitoring = true;
    if (m.some((k) => ['sites_active', 'coverage', 'visits_done', 'visits_planned', 'execution_rate'].includes(k))) need.field = true;
    if (m.some((k) => k.startsWith('budget') || k === 'consumption')) need.budget = true;
    if (m.some((k) => k.startsWith('pdd'))) need.pdd = true;
  };
  const walk = (b) => {
    if (b.type === 'repeat') { need.monitoring = true; need.field = true; b.params.blocks.forEach(walk); return; }
    if (b.params && b.params.doc) metrics(docVariables(b.params.doc));
    if (b.type === 'kpis') { metrics(b.params.metrics); return; }
    if (b.type === 'bulletin') { need.monitoring = true; need.field = true; return; }
    const ds = b.params && b.params.dataset;
    if (!ds) return;
    if (MONITORING_SETS.has(ds)) need.monitoring = true;
    if (FIELD_SETS.has(ds)) need.field = true;
    if (ds === 'budget_contracts') need.budget = true;
    if (ds.startsWith('pdd')) need.pdd = true;
  };
  blocks.forEach(walk);
  return need;
}

// `lang` : langue des libellés construits par le serveur (bureau non relié : « Code 7 (not linked) »).
async function loadSources(tenantId, period, need, lang = 'fr') {
  const [monitoring, field, budget, pdd] = await Promise.all([
    need.monitoring ? monitoringRepo.reportMonitoringData(tenantId, period, { lang }) : null,
    need.field ? fieldRepo.reportFieldData(tenantId, period, { lang }) : null,
    need.budget ? consolidationRepo.consolidation(tenantId, { today: period.to }) : null,
    need.pdd ? pddRepo.reportPddByMonth(tenantId, period) : null,
  ]);
  return { monitoring, field, budget, pdd };
}

function renderBlock(b, sources, filters, period, ptext, lang) {
  const f = { ...(b.params.filters || {}), ...filters };
  switch (b.type) {
    case 'table': case 'chart': {
      const d = buildDataset(b.params.dataset, sources, f, period);
      if (b.params.limit) d.rows = d.rows.slice(0, b.params.limit);
      return d;
    }
    case 'kpis': {
      const k = computeKpis(sources, f);
      return { values: Object.fromEntries(b.params.metrics.map((m) => [m, k[m] ?? null])) };
    }
    case 'bulletin': return { doc: b.params.doc || bulletinDoc(computeKpis(sources, f), sources, ptext, lang), generated: !b.params.doc };
    default: return null;
  }
}

/**
 * Données d'un rapport : { periodLabel, variables, blocks: { [id]: data },
 * repeats: { [id]: [{ key, label, blocks: { [childId]: data } }] } }.
 */
async function renderReport(tenantId, input, { lang = 'fr' } = {}) {
  const doc = validate(input);
  const period = doc.period;
  const sources = await loadSources(tenantId, period, requiredSources(doc.blocks), lang);
  const ptext = periodLabel(period, lang);
  const out = { periodLabel: ptext, blocks: {}, repeats: {} };
  for (const b of doc.blocks) {
    if (b.type === 'repeat') {
      out.repeats[b.id] = repeatItems(b.params.over, sources).map((it) => ({
        key: it.key, label: it.label,
        blocks: Object.fromEntries(b.params.blocks.map((c) => [c.id, renderBlock(c, sources, it.filters, period, ptext, lang)]).filter(([, v]) => v != null)),
      }));
    } else {
      const d = renderBlock(b, sources, {}, period, ptext, lang);
      if (d != null) out.blocks[b.id] = d;
    }
  }
  out.variables = variableValues(period, computeKpis(sources, {}), new Date(), lang);
  return out;
}

// ---- Documents ----------------------------------------------------------------------
async function documentData(tenantId, id, opts) {
  const d = await repo.getDocument(tenantId, id);
  if (d.status === 'final') return d.snapshot;
  return renderReport(tenantId, d.content, opts);
}

// Le snapshot figé garde la langue dans laquelle le rapport a été finalisé.
async function finalize(tenantId, id, version, userId, opts) {
  const d = await repo.getDocument(tenantId, id);
  const snapshot = await renderReport(tenantId, d.content, opts);
  return repo.finalizeDocument(tenantId, id, { version, snapshot }, userId);
}

function catalog() {
  return {
    datasets: Object.fromEntries(Object.entries(DATASETS).map(([k, d]) => [k, { label: d.label, scope: d.scope, columns: d.columns.map(([key, label, type]) => ({ key, label, type })), dynamicColumns: d.dynamicColumns || null }])),
    kpis: KPIS,
    templates: SYSTEM_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, system: true, content: { title: t.name, page: t.page, blocks: t.blocks } })),
  };
}

// ---- Export Excel : une feuille par bloc de données (tableaux, graphiques, chiffres clés) --
function sheetName(wb, raw) {
  const base = String(raw || 'Données').replace(/[\\/*?:[\]]/g, ' ').slice(0, 28).trim() || 'Données';
  let name = base; let i = 2;
  while (wb.getWorksheet(name)) { name = `${base.slice(0, 25)} ${i}`; i += 1; }
  return name;
}

function addTable(wb, title, data) {
  const ws = wb.addWorksheet(sheetName(wb, title));
  ws.addRow([title]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const header = ws.addRow(data.columns.map((c) => c.label));
  header.font = { bold: true }; header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E9EF' } }; });
  for (const r of data.rows) ws.addRow(data.columns.map((c) => (r[c.key] == null ? '' : r[c.key])));
  data.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.type === 'text' ? 34 : 14;
    if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0';
    if (c.type === 'dec') ws.getColumn(i + 1).numFmt = '#,##0.000';
  });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

async function exportXlsx(tenantId, input, opts) {
  const doc = validate(input);
  const data = await renderReport(tenantId, doc, opts);
  const wb = new ExcelJS.Workbook(); wb.creator = 'MEMS 2.0';
  // 1re passe : chiffres clés et tableaux à écrire (dans l'ordre du rapport).
  const kpiRows = []; const tables = [];
  const visit = (b, d, prefix = '') => {
    if (!d) return;
    if (b.type === 'table' || b.type === 'chart') tables.push([`${prefix}${b.params.title || DATASETS[b.params.dataset].label}`, d]);
    if (b.type === 'kpis') Object.entries(d.values).forEach(([k, v]) => kpiRows.push([prefix.replace(/ — $/, '') || doc.title, KPIS[k], v]));
  };
  for (const b of doc.blocks) {
    if (b.type === 'repeat') {
      for (const item of data.repeats[b.id] || []) b.params.blocks.forEach((c) => visit(c, item.blocks[c.id], `${item.label} — `));
    } else visit(b, data.blocks[b.id]);
  }
  if (kpiRows.length) {
    const ws = wb.addWorksheet('Chiffres clés', { properties: { tabColor: { argb: 'FF0F6CBD' } } });
    ws.addRow([`${doc.title} — ${data.periodLabel}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    ws.addRow(['Périmètre', 'Indicateur', 'Valeur']).font = { bold: true };
    kpiRows.forEach((r) => ws.addRow(r));
    ws.columns = [{ width: 40 }, { width: 34 }, { width: 16 }];
  }
  tables.forEach(([title, d]) => addTable(wb, title, d));
  if (!wb.worksheets.length) wb.addWorksheet('Rapport').addRow(['Ce rapport ne contient pas de bloc de données.']);
  return wb;
}

module.exports = { renderReport, documentData, finalize, catalog, exportXlsx, validate, requiredSources, parseReport };
