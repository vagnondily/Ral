const { periodLabel } = require('../common/period');

/**
 * PLAN de rendu d'un rapport v2 (lot 7a) — PUR, sans I/O, testé
 * (test/reportRenderPlan.test.js). Calculé avant toute donnée, il sert à afficher
 * tout de suite le contenu fixe, puis à demander les blocs de données un par un :
 *  - sections répétées dépliées (éléments fournis par le serveur : fiches, bureaux,
 *    partenaires) ; identifiants d'instance STABLES : `blocId` à la racine,
 *    `répétition~élément~blocId` dans une section répétée ;
 *  - figures et tableaux numérotés dans l'ordre du document (« Figure 1 », « Tableau 1 »),
 *    sections répétées et colonnes comprises ; un bloc placé en annexe n'est pas numéroté dans
 *    le corps : il devient « Annexe A, B, C… » (retour 88) ;
 *  - filtres EFFECTIFS de chaque instance (bloc, élément répété, rapport ; « all » = aucun) ;
 *  - sections (géométrie de page) et variables simples remplies.
 */

const MAX_INSTANCES = 300;
const MAX_REPEAT_ITEMS = 30;
const FILTER_FIELDS = ['office', 'activity', 'formId', 'partnerId'];
/** Vues numérotées « Tableau n » ; les graphiques et cartes sont des « Figure n ». */
const TABLE_VIEWS = new Set(['table', 'heat']);
const FIGURE_VIEWS = new Set(['bar', 'column', 'line', 'donut', 'stacked', 'map', 'gauge']);

class PlanError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

/**
 * Filtres effectifs d'un bloc : période = bloc ?? rapport ; pour chaque clé, `'all'` sur le
 * bloc = aucun filtre, sinon bloc ?? élément répété ?? rapport ; le domaine (module) est
 * propre au bloc.
 * @param {{period, filters}} doc
 * @param {object} blockFilters filtres du bloc (params.filters)
 * @param {{filters?: object}|null} item élément de la section répétée
 */
function effectiveFilters(doc, blockFilters = {}, item = null) {
  const bf = blockFilters || {};
  const out = { period: bf.period || doc.period };
  for (const k of FILTER_FIELDS) {
    const b = bf[k];
    if (b === 'all') continue;
    const v = b != null ? b : (item && item.filters && item.filters[k] != null ? item.filters[k] : (doc.filters || {})[k]);
    if (v != null) out[k] = v;
  }
  if (bf.module) out.module = bf.module;
  return out;
}

/** Variables d'un texte riche ({ nodes: [{ c: [{ v }] | items: [[{ v }]] }] }). */
function richVariables(doc) {
  const out = new Set();
  for (const n of (doc && doc.nodes) || []) for (const s of [...(n.c || []), ...(n.items || []).flat()]) if (s && s.v) out.add(s.v);
  return [...out];
}

/** Remplace les {variables} connues ; une variable inconnue reste telle quelle (signalée dans l'éditeur). */
function substitute(text, vars) {
  return String(text == null ? '' : text).replace(/\{([a-z_]{2,40})\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/** Lettre d'une annexe : 0 → A, 25 → Z, 26 → AA (même règle que web/src/lib/reportPaginate.js). */
function annexLetter(i) {
  let s = ''; let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/** Le bloc a-t-il besoin de données calculées ? */
function needsData(b, kpiKeys) {
  if (b.type === 'data' || b.type === 'kpis' || b.type === 'bulletin') return true;
  if (b.type === 'text' || b.type === 'callout') return richVariables(b.params.doc).some((v) => kpiKeys.has(v));
  return false;
}

/** Numérotation : 'table', 'figure' ou null. */
function figureKind(b) {
  if (b.type !== 'data') return null;
  const fig = b.params.figure || {};
  if (fig.numbered === false) return null;
  const view = b.params.view || b.params.defaultView || 'table';
  if (TABLE_VIEWS.has(view)) return 'table';
  if (FIGURE_VIEWS.has(view)) return 'figure';
  return null;
}

/**
 * Plan d'un document v2 validé.
 * @param {object} doc
 * @param {{ expansions?: Object<string, {key,label,filters}[]>, kpiKeys?: Set<string>, lang?: 'fr'|'en',
 *           today?: string, defaultView?: (dataset) => string, simpleVars?: object, maxInstances?: number }} opts
 * @returns {{ periodLabel, vars, sections, instances, expansions }}
 */
function buildPlan(doc, opts = {}) {
  const { expansions = {}, kpiKeys = new Set(), lang = 'fr', today = new Date().toISOString().slice(0, 10), defaultView = () => 'table', maxInstances = MAX_INSTANCES } = opts;
  const page = doc.page || {};
  const pLabel = periodLabel(doc.period, lang);
  // {date} : date d'édition au format jj/mm/aaaa (en-têtes et pieds) ; {date_edition} reste l'ISO.
  const vars = { titre: doc.title, periode: pLabel, date_edition: today, date: String(today).split('-').reverse().join('/'), ...(opts.simpleVars || {}) };
  const sections = [{ id: '_doc', index: 0, size: page.size || 'A4', orientation: page.orientation || 'portrait', header: 'inherit', footer: 'inherit', title: null }];
  const instances = [];
  const counters = { table: 0, figure: 0 };
  const annexed = []; // instances placées en annexe (retour 88), dans l'ordre du document
  let section = sections[0];

  const startSection = (b, iid, repeat, item) => {
    const p = b.params || {};
    section = {
      id: iid, index: sections.length, size: p.size || page.size || 'A4', orientation: p.orientation || page.orientation || 'portrait',
      header: p.header || 'inherit', footer: p.footer || 'inherit',
      headerBand: p.header === 'own' ? p.headerBand || null : null, footerBand: p.footer === 'own' ? p.footerBand || null : null,
      title: p.title ? substitute(p.title, { ...vars, ...itemVars(repeat, item) }) : null,
    };
    sections.push(section);
  };

  const visit = (b, { repeat = null, item = null, column = null } = {}) => {
    const iid = repeat ? `${repeat.id}~${item.key}~${b.id}` : b.id;
    if (b.type === 'section') { startSection(b, iid, repeat, item); instances.push({ iid, blockId: b.id, type: 'section', sectionId: section.id, repeatId: repeat && repeat.id, repeatKey: item && item.key, needsData: false }); return; }
    if (b.type === 'columns') {
      instances.push({ iid, blockId: b.id, type: 'columns', sectionId: section.id, repeatId: repeat && repeat.id, repeatKey: item && item.key, needsData: false });
      b.params.cols.forEach((col, c) => col.forEach((cb) => visit(cb, { repeat, item, column: { iid, index: c } })));
      return;
    }
    if (b.type === 'repeat') {
      const items = expansions[b.id] || [];
      if (items.length > MAX_REPEAT_ITEMS) {
        throw new PlanError('too_many_items', `Section répétée « ${b.id} » : ${items.length} éléments (${MAX_REPEAT_ITEMS} au plus) — ajoutez un filtre.`, { blockId: b.id, count: items.length });
      }
      instances.push({ iid, blockId: b.id, type: 'repeat', sectionId: section.id, needsData: false, count: items.length });
      for (const it of items) for (const c of b.params.blocks) visit(c, { repeat: b, item: it });
      return;
    }
    const inst = {
      iid, blockId: b.id, type: b.type, sectionId: section.id,
      repeatId: repeat ? repeat.id : null, repeatKey: item ? item.key : null, repeatLabel: item ? item.label : null,
      column: column ? column.iid : null, columnIndex: column ? column.index : null,
      needsData: needsData(b, kpiKeys),
    };
    if (inst.needsData || b.type === 'data' || b.type === 'kpis') inst.filters = effectiveFilters(doc, b.params.filters, item);
    if (b.type === 'data') {
      const view = b.params.view || defaultView(b.params.dataset);
      inst.dataset = b.params.dataset;
      inst.view = view;
      // En annexe (demandé sur le bloc ; le seuil de lignes du document est appliqué par l'éditeur,
      // qui connaît les lignes) : hors de la numérotation du corps, lettré A, B, C… à la fin.
      if (b.params.annex === true && !column) annexed.push(inst);
      else {
        const kind = figureKind({ ...b, params: { ...b.params, view } });
        if (kind) { counters[kind] += 1; inst.figure = { kind, n: counters[kind] }; }
      }
    }
    if (b.type === 'heading') {
      inst.level = b.params.level || 2;
      inst.text = substitute(b.params.text, { ...vars, ...itemVars(repeat, item) });
    }
    instances.push(inst);
    if (instances.length > maxInstances) {
      throw new PlanError('too_many_instances', `Rapport trop grand une fois déplié : plus de ${maxInstances} blocs — ajoutez un filtre ou réduisez les sections répétées.`, { max: maxInstances });
    }
  };
  for (const b of doc.blocks) visit(b);
  annexed.forEach((inst, k) => { const letter = annexLetter(k); inst.annex = { letter }; inst.figure = { kind: 'annex', letter }; });

  // En-tête et pied de chaque section : textes remplis (variables simples + {section}).
  const bandTexts = (bandDef, sec) => Object.fromEntries(((bandDef && bandDef.elements) || [])
    .filter((e) => e.kind === 'text').map((e) => [e.id, substitute(e.text, { ...vars, section: sec.title || '' })]));
  // En-tête / pied PROPRES d'une section (dessinés pour ses pages) : priment sur ceux du document.
  const bandOf = (mode, own, doc) => (mode === 'none' ? null : mode === 'own' ? own : doc);
  for (const sec of sections) {
    sec.headerText = bandTexts(bandOf(sec.header, sec.headerBand, page.header), sec);
    sec.footerText = bandTexts(bandOf(sec.footer, sec.footerBand, page.footer), sec);
    if (page.firstPage === 'own') {
      sec.firstHeaderText = bandTexts(page.firstHeader, sec);
      sec.firstFooterText = bandTexts(page.firstFooter, sec);
    }
  }
  return { periodLabel: pLabel, vars, sections, instances, expansions, annexes: annexed.map((i) => ({ letter: i.annex.letter, iid: i.iid })) };
}

/** Variables d'un élément répété : {activite}, {bureau} ou {partenaire} = son libellé. */
function itemVars(repeat, item) {
  if (!repeat || !item) return {};
  const name = { activity: 'activite', bureau: 'bureau', partner: 'partenaire' }[repeat.params.over];
  return { [name]: item.label };
}

/** Bloc d'une instance (racine, section répétée ou colonne) ; null si inconnu. */
function blockOfInstance(doc, iid) {
  const parts = String(iid).split('~');
  const blockId = parts[parts.length - 1];
  let found = null;
  const walk = (blocks) => {
    for (const b of blocks || []) {
      if (found) return;
      if (b.id === blockId) { found = b; return; }
      if (b.type === 'repeat') walk(b.params.blocks);
      if (b.type === 'columns') b.params.cols.forEach(walk);
    }
  };
  walk(doc.blocks);
  return found;
}

module.exports = {
  buildPlan, effectiveFilters, richVariables, substitute, itemVars, blockOfInstance, figureKind, annexLetter,
  PlanError, MAX_INSTANCES, MAX_REPEAT_ITEMS,
};
