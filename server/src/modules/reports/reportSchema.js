const { z } = require('zod');
const { periodSchema } = require('../common/period');

/**
 * Concepteur de rapport — MODÈLE DE DOCUMENT v2 (lot 7a, C3). Schéma zod PUR,
 * sans I/O, testé (test/reportSchemaV2.test.js).
 *
 * Un rapport = { schemaVersion: 2, title, period {from,to}, filters, page, blocks[] }.
 *  - page : format, orientation, marges, en-tête et pied DESSINÉS (éléments placés :
 *    texte avec variables, image, n° de page, trait, rectangle), 1re page, filigrane ;
 *  - blocs : titres, textes riches (JSON structuré, JAMAIS de HTML), encadrés,
 *    bulletin, chiffres clés, bloc « données » (jeu du catalogue + vue), section
 *    (nouvelle page, orientation propre), colonnes, image, sommaire, cartouche de
 *    validation, espace, saut de page, séparateur, section répétée ;
 *  - filtres : au niveau du rapport et du bloc (« all » = ignorer le filtre du rapport).
 * Les paramètres propres à un jeu de données (vue, args, colonnes) sont contrôlés
 * contre le catalogue (catalog/index.validateBlockParams) : ce module ne connaît pas
 * le catalogue, il fixe la FORME.
 */

// ---- Briques -------------------------------------------------------------------------
const id = z.string().regex(/^[A-Za-z0-9_~-]{1,60}$/);
const mm = z.number().finite().min(0).max(400);
const pct = z.number().finite().min(0).max(100);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #RRGGBB');
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** Polices proposées : livrées par l'application (Inter) ou présentes partout (Arial, Georgia). */
const FONTS = ['Inter', 'Arial', 'Georgia'];
const MAX_BLOCKS = 200;
const MAX_IMAGES = 12;
/** Taille maximale du document (octets UTF-8 du JSON) : le corps, le jsonb et l'enveloppe tiennent sous 1 Mo. */
const MAX_DOC_BYTES = 900 * 1024;

// ---- Texte riche (inchangé depuis la v1) ----------------------------------------------
const MAX_TEXT = 20000;
const inline = z.object({
  x: z.string().max(MAX_TEXT),
  b: z.boolean().optional(), i: z.boolean().optional(), u: z.boolean().optional(),
  v: z.string().regex(/^[a-z_]{2,40}$/).optional(), // variable : rendue depuis le contexte
});
const richNode = z.object({
  t: z.enum(['p', 'h2', 'h3', 'ul', 'ol', 'quote']),
  c: z.array(inline).max(400).optional(),
  items: z.array(z.array(inline).max(200)).max(200).optional(),
});
const richDoc = z.object({ nodes: z.array(richNode).max(400) });

// ---- En-tête et pied dessinés -----------------------------------------------------------
const textStyle = z.object({
  font: z.enum(FONTS).default('Inter'),
  size: z.number().min(6).max(36).default(9),
  bold: z.boolean().default(false), italic: z.boolean().default(false),
  color: color.default('#616a7a'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  background: color.optional(),
  padding: z.number().min(0).max(10).default(0),
  radius: z.number().min(0).max(6).default(0),
}).default({});
const el = { id, x: pct, y: mm, w: pct.min(1), h: mm.min(2) };
const bandElement = z.discriminatedUnion('kind', [
  z.object({ ...el, kind: z.literal('text'), text: z.string().max(300), style: textStyle }),
  z.object({ ...el, kind: z.literal('image'), assetId: z.string().uuid() }),
  z.object({ ...el, kind: z.literal('pageNumber'), format: z.enum(['n', 'n / N', 'Page n', 'Page n / N']).default('Page n / N'), style: textStyle }),
  z.object({ ...el, kind: z.literal('line'), thickness: z.number().min(0.25).max(3).default(0.5), color: color.default('#e7e9ef') }),
  z.object({ ...el, kind: z.literal('rect'), fill: color.default('#eff6fc'), border: color.optional(), radius: z.number().min(0).max(6).default(0), opacity: z.number().min(0.1).max(1).default(1) }),
]);
const band = z.object({
  height: z.number().min(0).max(60).default(14),
  elements: z.array(bandElement).max(20).default([]),
}).superRefine((b, ctx) => b.elements.forEach((e, i) => {
  if (e.x + e.w > 100.001) ctx.addIssue({ code: 'custom', path: ['elements', i, 'w'], message: 'Élément hors de la largeur de la bande' });
  if (e.y + e.h > b.height + 0.001) ctx.addIssue({ code: 'custom', path: ['elements', i, 'h'], message: 'Élément hors de la hauteur de la bande' });
}));
const margin = (d) => z.number().finite().min(5).max(40).default(d);
const margins = z.object({ top: margin(16), right: margin(14), bottom: margin(16), left: margin(14) }).default({});
const pageSetup = z.object({
  size: z.enum(['A4', '16:9']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margins,
  header: band.default({}),
  footer: band.default({}),
  firstPage: z.enum(['same', 'none', 'own']).default('same'),
  firstHeader: band.optional(),
  firstFooter: band.optional(),
  draftWatermark: z.boolean().default(true), // « BROUILLON — non validé » sur les exports non validés
}).default({});

// ---- Filtres -----------------------------------------------------------------------------
/**
 * Bureau : clé de codeLabel — 'id:<uuid>' (bureau MEMS), 'lib:<libellé>' (libellé d'une fiche),
 * 'code:<fiche>:<code>' (code non relié, propre à SA fiche), 'unlinked' (aucun bureau MEMS
 * relié). Jamais un nom libre : un nom change, une clé non.
 */
const officeKey = z.string().max(200).regex(/^(id:[0-9a-fA-F-]{36}|lib:.{1,160}|code:[0-9a-fA-F-]{36}:.{1,80}|unlinked)$/, 'Bureau invalide');
const ALL = z.literal('all');
const reportFilters = z.object({
  office: officeKey.optional(),
  activity: z.string().trim().min(1).max(160).optional(), // catégorie d'activité (sites.activity / fiche.activity_category)
  formId: z.string().uuid().optional(),
  partnerId: z.string().uuid().optional(),
}).strict().default({});
const blockFilters = z.object({
  period: z.object({ from: monthStr, to: monthStr }).superRefine((p, ctx) => {
    const r = periodSchema.safeParse(p);
    if (!r.success) ctx.addIssue({ code: 'custom', message: r.error.issues[0].message });
  }).optional(),
  office: z.union([officeKey, ALL]).optional(),
  activity: z.union([z.string().trim().min(1).max(160), ALL]).optional(),
  formId: z.union([z.string().uuid(), ALL]).optional(),
  partnerId: z.union([z.string().uuid(), ALL]).optional(),
  module: z.string().max(120).optional(),
}).strict().default({});

const figure = z.object({
  title: z.string().max(200).optional(), subtitle: z.string().max(300).optional(),
  source: z.string().max(300).optional(), // vide = source automatique du jeu de données
  note: z.string().max(500).optional(),
  numbered: z.boolean().default(true), showN: z.boolean().default(true), labels: z.boolean().default(true),
}).default({});

const VIEWS = ['table', 'bar', 'column', 'line', 'donut', 'stacked', 'heat', 'kpi', 'list', 'card', 'explain', 'map', 'gauge'];
const argValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

// ---- Blocs -------------------------------------------------------------------------------
const level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const textBlocks = [
  z.object({ id, type: z.literal('heading'), params: z.object({ text: z.string().min(1).max(300), level: level.default(2) }) }),
  z.object({ id, type: z.literal('text'), params: z.object({ doc: richDoc, filters: blockFilters }) }),
  z.object({ id, type: z.literal('callout'), params: z.object({ tone: z.enum(['info', 'success', 'warning', 'critical']).default('info'), title: z.string().max(200).optional(), doc: richDoc, filters: blockFilters }) }),
  z.object({ id, type: z.literal('bulletin'), params: z.object({ doc: richDoc.optional(), filters: blockFilters }) }),
];
const leafVariants = [
  ...textBlocks,
  z.object({ id, type: z.literal('kpis'), params: z.object({ metrics: z.array(z.string().regex(/^[a-z_0-9]{2,40}$/)).min(1).max(8), filters: blockFilters }) }),
  z.object({
    id, type: z.literal('data'),
    params: z.object({
      dataset: z.string().regex(/^[a-z]+\.[a-z_0-9]+$/),
      view: z.enum(VIEWS).optional(),
      measure: z.string().max(60).optional(),
      columns: z.array(z.string().max(80)).max(40).optional(),
      sort: z.object({ key: z.string().max(80), dir: z.enum(['asc', 'desc']).default('desc') }).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      args: z.record(z.string().regex(/^[a-zA-Z]{1,40}$/), argValue).default({}),
      filters: blockFilters,
      figure,
      palette: z.enum(['sober', 'status', 'categorical']).default('sober'),
      // Constat saisi par ligne (clé stable de la ligne → texte riche) ; une note dont la ligne a
      // disparu est gardée (orpheline), jamais perdue.
      annotations: z.record(z.string().max(200), richDoc).optional(),
    }),
  }),
  z.object({ id, type: z.literal('image'), params: z.object({ assetId: z.string().uuid(), width: z.number().min(10).max(100).default(100), align: z.enum(['left', 'center', 'right']).default('center'), caption: z.string().max(300).optional() }) }),
  z.object({ id, type: z.literal('toc'), params: z.object({ depth: z.union([z.literal(1), z.literal(2)]).default(2) }).default({}) }),
  z.object({ id, type: z.literal('approval'), params: z.object({}).default({}) }),
  z.object({ id, type: z.literal('spacer'), params: z.object({ height: z.number().min(1).max(200).default(8) }).default({}) }),
  z.object({ id, type: z.literal('pagebreak'), params: z.object({}).default({}) }),
  z.object({ id, type: z.literal('divider'), params: z.object({}).default({}) }),
];
const leafBlock = z.discriminatedUnion('type', leafVariants);
const sectionBlock = z.object({
  id, type: z.literal('section'),
  params: z.object({
    orientation: z.enum(['portrait', 'landscape']).optional(), // absent = celle du document
    size: z.enum(['A4', '16:9']).optional(),
    header: z.enum(['inherit', 'none']).default('inherit'),
    footer: z.enum(['inherit', 'none']).default('inherit'),
    title: z.string().max(200).optional(), // pour le plan et le sommaire
  }).default({}),
});
const columnsBlock = z.object({
  id, type: z.literal('columns'),
  params: z.object({
    ratio: z.enum(['1:1', '2:1', '1:2', '1:1:1']).default('1:1'),
    cols: z.array(z.array(leafBlock).max(10)).min(2).max(3),
  }).superRefine((p, ctx) => {
    if (p.cols.length !== p.ratio.split(':').length) ctx.addIssue({ code: 'custom', path: ['cols'], message: 'Nombre de colonnes différent de la répartition' });
  }),
});
const repeatBlock = z.object({
  id, type: z.literal('repeat'),
  params: z.object({
    over: z.enum(['activity', 'bureau', 'partner']),
    blocks: z.array(z.union([leafBlock, sectionBlock, columnsBlock])).min(1).max(40),
  }),
});
const block = z.union([leafBlock, sectionBlock, columnsBlock, repeatBlock]);

/** Tous les blocs d'un document, à plat (répétitions et colonnes comprises), avec leur chemin. */
function walkBlocks(blocks, visit, path = ['blocks'], parent = null) {
  (blocks || []).forEach((b, i) => {
    const p = [...path, i];
    visit(b, p, parent);
    if (b.type === 'repeat') walkBlocks(b.params.blocks, visit, [...p, 'params', 'blocks'], b);
    if (b.type === 'columns') b.params.cols.forEach((col, c) => walkBlocks(col, visit, [...p, 'params', 'cols', c], b));
  });
}

/** Images citées (blocs image et éléments d'en-tête / pied). */
function imageRefs(doc) {
  const out = [];
  walkBlocks(doc.blocks, (b) => { if (b.type === 'image') out.push(b.params.assetId); });
  const page = doc.page || {};
  for (const bd of [page.header, page.footer, page.firstHeader, page.firstFooter]) {
    for (const e of (bd && bd.elements) || []) if (e.kind === 'image') out.push(e.assetId);
  }
  return out;
}

const reportDocV2 = z.object({
  schemaVersion: z.literal(2),
  title: z.string().trim().min(1).max(200),
  period: periodSchema,
  filters: reportFilters,
  page: pageSetup,
  blocks: z.array(block).max(MAX_BLOCKS),
  lang: z.enum(['fr', 'en']).optional(),
}).superRefine((d, ctx) => {
  const seen = new Set();
  let count = 0;
  walkBlocks(d.blocks, (b, path) => {
    count += 1;
    if (seen.has(b.id)) ctx.addIssue({ code: 'custom', path, message: `Identifiant de bloc en double : ${b.id}` });
    seen.add(b.id);
  });
  if (count > MAX_BLOCKS) ctx.addIssue({ code: 'custom', path: ['blocks'], message: `Trop de blocs : ${count} (${MAX_BLOCKS} au plus).` });
  const images = imageRefs(d).length;
  if (images > MAX_IMAGES) ctx.addIssue({ code: 'custom', path: ['blocks'], message: `Trop d'images : ${images} (${MAX_IMAGES} au plus).` });
  const bytes = Buffer.byteLength(JSON.stringify(d), 'utf8');
  if (bytes > MAX_DOC_BYTES) ctx.addIssue({ code: 'custom', path: ['blocks'], message: `Rapport trop volumineux : ${Math.round(bytes / 1024)} Ko (900 Ko au plus).`, params: { code: 'doc_too_large' } });
});

/** Valide un document v2 (normalisé, valeurs par défaut posées) ; lève une ZodError lisible. */
const parseDocV2 = (input) => reportDocV2.parse(input);
const safeParseDocV2 = (input) => reportDocV2.safeParse(input);

module.exports = {
  parseDocV2, safeParseDocV2, walkBlocks, imageRefs,
  FONTS, VIEWS, MAX_BLOCKS, MAX_IMAGES, MAX_DOC_BYTES,
  schemas: { richDoc, block, leafBlock, sectionBlock, columnsBlock, repeatBlock, band, pageSetup, reportFilters, blockFilters, figure, reportDocV2, officeKey },
};
