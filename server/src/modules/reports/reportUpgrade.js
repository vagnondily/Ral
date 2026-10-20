/**
 * Mise à niveau d'un rapport v1 → v2 (lot 7a, C3) — PURE, testée
 * (test/reportUpgrade.test.js). Appliquée à la LECTURE (documents, modèles) et à la
 * validation de toute entrée v1 (anciens onglets ouverts) ; aucune migration de données :
 * l'enregistrement suivant écrit du v2. Idempotente sur un document v2.
 *
 *  - en-tête / pied (une ligne de texte) → éléments texte placés ; numéros de page →
 *    élément « n° de page » à droite ; {periode} conservé ;
 *  - blocs « table » et « chart » → bloc « data » (vue table, barres, courbes, matrice) ;
 *  - jeux de données et chiffres clés renommés (catalogue v2) ;
 *  - filtre bureau par NOM → clé 'id:<uuid>' via la table des bureaux du client ; un nom
 *    introuvable retire le filtre et laisse un avertissement sur le bloc (jamais un
 *    filtre silencieusement faux).
 * Aussi sur un document v2 (rekeyBlocks), UNE FOIS : les constats (annotations) d'un jeu dont la
 * clé de ligne a changé sont remis sur la nouvelle clé — « Couverture par activité » (retour 110) :
 * du libellé brut du registre (« School meal activities ») à la clé d'activité des tableaux de bord
 * (coverageDefinitions.activityKey) ; deux anciennes clés de même activité sont réunies, rien
 * n'est perdu. Le document mis à niveau porte `rowKeys: 2` (enregistré avec lui) : une clé écrite
 * sous le nouveau schéma n'est plus jamais déplacée. Un document FINALISÉ n'est jamais réenregistré :
 * ses constats sont remis sur la nouvelle clé à chaque lecture, et ses lignes figées de la même
 * façon (rekeySnapshotBlocks, appelé par documentData) — les deux côtés se retrouvent toujours.
 */
const { activityKey } = require('../dashboards/coverageDefinitions');

const DATASET_RENAMES = {
  activity_coverage: 'cov.by_activity',
  activity_domains: 'mon.domains_by_activity',
  bureau_domains: 'mon.domains_by_bureau',
  indicator_list: 'mon.indicators',
  bureau_coverage: 'cov.by_office',
  plan_vs_actual: 'cov.monthly',
  completeness_monthly: 'cov.completeness_monthly',
  region_submissions: 'mon.by_region',
  budget_contracts: 'bud.by_contract',
  pdd_by_month: 'pdd.by_month',
};

const KPI_RENAMES = { sites_visited: 'sites_realised', visits_done: 'visits_realised', sites_visited_all: 'sites_with_data' };
const renameKpi = (k) => KPI_RENAMES[k] || k;

const CHART_VIEWS = { bar: 'bar', line: 'line', matrix: 'heat' };

/** Avertissements de la mise à niveau (français ; l'interface refait la phrase depuis code + paramètres). */
const WARNINGS = {
  office_removed: ({ name }) => `Filtre bureau « ${name} » retiré : aucun bureau MEMS de ce nom (choisissez-le à nouveau).`,
  view_replaced: ({ from, to }) => `Présentation « ${from} » remplacée par « ${to} » (non proposée pour ces données).`,
};

/** Texte riche : variables de chiffres clés renommées. */
function upgradeRichDoc(doc) {
  if (!doc || !Array.isArray(doc.nodes)) return doc;
  const seg = (s) => (s && s.v ? { ...s, v: renameKpi(s.v) } : s);
  return {
    nodes: doc.nodes.map((n) => ({
      ...n,
      ...(n.c ? { c: n.c.map(seg) } : {}),
      ...(n.items ? { items: n.items.map((it) => it.map(seg)) } : {}),
    })),
  };
}

/** Filtres d'un bloc v1 ({ formId, bureau (nom), module }) → v2 ({ formId, office, module }). */
function upgradeFilters(f, officeIdByName, warn) {
  const out = {};
  if (!f) return out;
  if (f.formId) out.formId = f.formId;
  if (f.module) out.module = f.module;
  if (f.bureau) {
    const idOf = officeIdByName && officeIdByName.get(String(f.bureau).trim().toLowerCase());
    if (idOf) out.office = `id:${idOf}`;
    else warn('office_removed', { name: String(f.bureau) });
  }
  return out;
}

function upgradeBlock(b, officeIdByName, warnings, viewsOf) {
  // Avertissement : code + paramètres (phrase refaite dans la langue de l'interface) et texte français.
  const warn = (code, params) => warnings.push({ blockId: b.id, code, params, message: WARNINGS[code](params) });
  const p = b.params || {};
  switch (b.type) {
    case 'table':
    case 'chart': {
      const dataset = DATASET_RENAMES[p.dataset] || p.dataset;
      let view = b.type === 'table' ? 'table' : (CHART_VIEWS[p.kind] || 'bar');
      // Vue d'un graphique v1 non proposée par le jeu v2 : sa vue par défaut, avec un avertissement.
      const allowed = viewsOf ? viewsOf(dataset) : null;
      if (allowed && !allowed.views.includes(view)) {
        warn('view_replaced', { from: view, to: allowed.defaultView });
        view = allowed.defaultView;
      }
      const params = {
        dataset, view, filters: upgradeFilters(p.filters, officeIdByName, warn), args: {},
        figure: p.title ? { title: p.title } : {}, palette: 'sober',
      };
      if (p.columns && p.columns.length) params.columns = p.columns;
      if (p.limit) params.limit = p.limit;
      if (p.metric) params.measure = p.metric;
      return { id: b.id, type: 'data', params };
    }
    case 'kpis':
      return { id: b.id, type: 'kpis', params: { metrics: [...new Set((p.metrics || []).map(renameKpi))], filters: upgradeFilters(p.filters, officeIdByName, warn) } };
    case 'bulletin':
      return { id: b.id, type: 'bulletin', params: { ...(p.doc ? { doc: upgradeRichDoc(p.doc) } : {}), filters: upgradeFilters(p.filters, officeIdByName, warn) } };
    case 'text':
      return { id: b.id, type: 'text', params: { doc: upgradeRichDoc(p.doc), filters: {} } };
    case 'callout':
      return { id: b.id, type: 'callout', params: { ...p, doc: upgradeRichDoc(p.doc), filters: {} } };
    case 'repeat':
      return { id: b.id, type: 'repeat', params: { over: p.over, blocks: (p.blocks || []).map((c) => upgradeBlock(c, officeIdByName, warnings, viewsOf)) } };
    default:
      return { id: b.id, type: b.type, params: { ...p } };
  }
}

/** Une ligne de texte v1 (en-tête ou pied) → élément placé sur la bande. */
const textEl = (elId, text, { x = 0, w = 100, align = 'left' } = {}) => ({
  id: elId, kind: 'text', x, y: 4, w, h: 6, text: String(text).slice(0, 300),
  style: { font: 'Inter', size: 8, bold: false, italic: false, color: '#616a7a', align, padding: 0, radius: 0 },
});

function upgradePage(page = {}) {
  const header = { height: 14, elements: [] };
  const footer = { height: 14, elements: [] };
  if (page.header) header.elements.push(textEl('h-text', page.header));
  if (page.footer) footer.elements.push(textEl('f-text', page.footer, { w: page.showPageNumbers === false ? 100 : 66 }));
  if (page.showPageNumbers !== false) {
    footer.elements.push({
      id: 'f-pageno', kind: 'pageNumber', x: 70, y: 4, w: 30, h: 6, format: 'Page n / N',
      style: { font: 'Inter', size: 8, bold: false, italic: false, color: '#616a7a', align: 'right', padding: 0, radius: 0 },
    });
  }
  return {
    size: 'A4', orientation: page.orientation === 'landscape' ? 'landscape' : 'portrait',
    header, footer, firstPage: 'same', draftWatermark: true,
  };
}

// ---- Clés de ligne des constats (v2) --------------------------------------------------------
/** Jeux dont la clé de ligne a changé : jeu → nouvelle clé d'une ancienne clé. */
const ROW_KEY_UPGRADES = { 'cov.by_activity': activityKey };
const MAX_NOTE_NODES = 400; // reportSchema.richDoc

/** Constats d'un bloc sur leurs nouvelles clés ; deux constats sur la même clé sont mis bout à bout. Même objet si rien ne change. */
function rekeyNotes(annotations, keyOf) {
  if (!annotations || typeof annotations !== 'object' || Array.isArray(annotations)) return annotations;
  const entries = Object.entries(annotations);
  if (entries.every(([k]) => keyOf(k) === k)) return annotations;
  const out = {};
  for (const [k, note] of entries) {
    const nk = keyOf(k);
    if (!out[nk]) { out[nk] = note; continue; }
    const nodes = (n) => (n && Array.isArray(n.nodes) ? n.nodes : []);
    out[nk] = { nodes: [...nodes(out[nk]), ...nodes(note)].slice(0, MAX_NOTE_NODES) };
  }
  return out;
}

/** Blocs (récursif : répétitions, colonnes) avec les constats remis sur leurs clés ; même tableau si rien ne change. */
function rekeyBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  let changed = false;
  const out = blocks.map((b) => {
    const p = b && b.params;
    if (!p || typeof p !== 'object') return b;
    let next = b;
    if (b.type === 'data' && ROW_KEY_UPGRADES[p.dataset] && p.annotations) {
      const a = rekeyNotes(p.annotations, ROW_KEY_UPGRADES[p.dataset]);
      if (a !== p.annotations) next = { ...b, params: { ...p, annotations: a } };
    } else if (b.type === 'repeat' && Array.isArray(p.blocks)) {
      const inner = rekeyBlocks(p.blocks);
      if (inner !== p.blocks) next = { ...b, params: { ...p, blocks: inner } };
    } else if (b.type === 'columns' && Array.isArray(p.cols)) {
      const cols = p.cols.map((c) => rekeyBlocks(c));
      if (cols.some((c, i) => c !== p.cols[i])) next = { ...b, params: { ...p, cols } };
    }
    if (next !== b) changed = true;
    return next;
  });
  return changed ? out : blocks;
}

/** Schéma des clés de ligne des constats : 2 = clés d'activité des tableaux de bord (retour 110). */
const ROW_KEYS = 2;

/**
 * Lignes FIGÉES d'un document finalisé (snapshot.blocks) remises sur les nouvelles clés, comme ses
 * constats : pour chaque instance d'un jeu de ROW_KEY_UPGRADES, `_key` de chaque ligne → nouvelle clé
 * (idempotent : une clé déjà nouvelle ne change pas). Même objet si rien ne change.
 * @param {object} blocks { [iid]: { ok, data: { rows } } }  @param {{iid, dataset?}[]} instances plan du document
 */
function rekeySnapshotBlocks(blocks, instances) {
  if (!blocks || typeof blocks !== 'object') return blocks;
  let out = blocks;
  for (const inst of instances || []) {
    const keyOf = inst && ROW_KEY_UPGRADES[inst.dataset];
    const b = keyOf && blocks[inst.iid];
    const rows = b && b.ok && b.data && Array.isArray(b.data.rows) ? b.data.rows : null;
    if (!rows || rows.every((r) => !r || r._key == null || keyOf(String(r._key)) === r._key)) continue;
    if (out === blocks) out = { ...blocks };
    out[inst.iid] = { ...b, data: { ...b.data, rows: rows.map((r) => (r && r._key != null ? { ...r, _key: keyOf(String(r._key)) } : r)) } };
  }
  return out;
}

/**
 * Document v1 (ou v2) → v2.
 * @param {object} input contenu enregistré ou reçu
 * @param {{ officeIdByName?: Map<string,string>, viewsOf?: (dataset) => ({views, defaultView}|null) }} [ctx]
 *   officeIdByName : bureaux du client (nom en minuscules → id) ; viewsOf : vues permises d'un jeu v2
 * @returns {{ doc: object, warnings: {blockId:string, message:string}[], upgraded: boolean, rekeyed: boolean }}
 *   rekeyed : les constats viennent d'être remis sur les nouvelles clés (document sans `rowKeys: 2`) —
 *   documentData remet alors les lignes figées sur les mêmes clés
 */
function upgradeDoc(input, { officeIdByName, viewsOf } = {}) {
  if (!input || typeof input !== 'object') return { doc: input, warnings: [], upgraded: false, rekeyed: false };
  if (input.schemaVersion === 2) {
    // v2 déjà sur les nouvelles clés : rendu tel quel (même objet), jamais re-clé.
    if (input.rowKeys === ROW_KEYS) return { doc: input, warnings: [], upgraded: false, rekeyed: false };
    return { doc: { ...input, blocks: rekeyBlocks(input.blocks), rowKeys: ROW_KEYS }, warnings: [], upgraded: false, rekeyed: true };
  }
  const warnings = [];
  const doc = {
    schemaVersion: 2,
    title: input.title,
    period: input.period,
    filters: {},
    page: upgradePage(input.page),
    blocks: rekeyBlocks((input.blocks || []).map((b) => upgradeBlock(b, officeIdByName, warnings, viewsOf))),
    rowKeys: ROW_KEYS,
  };
  return { doc, warnings, upgraded: true, rekeyed: true };
}

/** Vrai si le contenu est un document v1 (sans schemaVersion). */
const isV1 = (input) => !!input && typeof input === 'object' && input.schemaVersion !== 2;

/**
 * Données FIGÉES d'un document finalisé avant le lot 7a → forme du rendu v2, sans rien
 * recalculer : { blocks: { [iid]: { ok, data } }, expansions, vars }. Un bloc v1
 * (tableau, graphique) devient { columns, rows, meta } ; les chiffres clés sont renommés.
 */
function upgradeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.format === 2) return snapshot;
  const renameValues = (values) => Object.fromEntries(Object.entries(values || {}).map(([k, val]) => [renameKpi(k), val]));
  const conv = (d) => {
    if (d && Array.isArray(d.rows)) return { ok: true, data: { columns: d.columns || [], rows: d.rows, meta: { note: d.note || null, n: d.rows.length } } };
    if (d && d.values) return { ok: true, data: { values: renameValues(d.values) } };
    return { ok: true, data: d };
  };
  const blocks = {};
  for (const [blockId, d] of Object.entries(snapshot.blocks || {})) blocks[blockId] = conv(d);
  const expansions = {};
  for (const [rid, items] of Object.entries(snapshot.repeats || {})) {
    expansions[rid] = (items || []).map((it) => ({ key: it.key, label: it.label, filters: {} }));
    for (const it of items || []) for (const [cid, d] of Object.entries(it.blocks || {})) blocks[`${rid}~${it.key}~${cid}`] = conv(d);
  }
  return { format: 2, frozen: true, periodLabel: snapshot.periodLabel || null, vars: renameValues(snapshot.variables), expansions, blocks };
}

module.exports = { upgradeDoc, upgradeSnapshot, isV1, renameKpi, rekeyBlocks, rekeySnapshotBlocks, DATASET_RENAMES, KPI_RENAMES, ROW_KEY_UPGRADES, ROW_KEYS };
