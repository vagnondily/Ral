import { bandImageCount, layoutImageCount } from '../../lib/reportBands.js';

/**
 * Document de rapport v2 (lot 7a) — opérations PURES de l'éditeur (aucun DOM, aucune
 * requête) : création des blocs, parcours, recherche, modification, déplacement,
 * insertion et suppression, y compris dans une section répétée ou dans des colonnes.
 * Mêmes règles que le serveur (server/src/modules/reports/reportSchema.js) : identifiants
 * uniques, pas de colonnes dans des colonnes, pas de section répétée dans une autre.
 * Identifiant d'instance (iid) : `blocId` à la racine, `répétition~élément~blocId` dans une
 * section répétée — le même que le plan du serveur (renderPlan.js).
 */

let seq = 0;
export const newId = (type) => `${type}-${Date.now().toString(36)}${(seq += 1).toString(36)}`;
export const emptyRich = () => ({ nodes: [{ t: 'p', c: [{ x: '' }] }] });

const STYLE = { font: 'Inter', size: 8, bold: false, italic: false, color: '#616a7a', align: 'left', padding: 0, radius: 0 };
export const textElement = (id, text, { x = 0, w = 100, align = 'left' } = {}) => ({ id, kind: 'text', x, y: 4, w, h: 6, text, style: { ...STYLE, align } });
export const pageNumberElement = () => ({ id: 'f-pageno', kind: 'pageNumber', x: 70, y: 4, w: 30, h: 6, format: 'Page n / N', style: { ...STYLE, align: 'right' } });

/** Mise en page par défaut d'un nouveau rapport. */
export const defaultPage = () => ({
  size: 'A4', orientation: 'portrait', firstPage: 'same', draftWatermark: true,
  header: { height: 14, elements: [textElement('h-text', '{titre} — {periode}')] },
  footer: { height: 12, elements: [textElement('f-text', 'Suivi & évaluation', { w: 66 }), pageNumberElement()] },
});

/**
 * Bloc par défaut d'un type (dataset : jeu choisi dans le catalogue, avec sa vue par défaut).
 * `t` traduit les textes d'exemple dans la langue de l'interface (ils deviennent du contenu).
 */
export function defaultBlock(type, { dataset, catalog, t = (x) => x } = {}) {
  const id = newId(type);
  switch (type) {
    case 'heading': return { id, type, params: { text: t('Nouveau titre'), level: 2 } };
    case 'text': return { id, type, params: { doc: emptyRich(), filters: {} } };
    case 'callout': return { id, type, params: { tone: 'info', title: t('À retenir'), doc: emptyRich(), filters: {} } };
    case 'kpis': return { id, type, params: { metrics: ['sites_realised', 'coverage', 'conformity'], filters: {} } };
    case 'bulletin': return { id, type, params: { filters: {} } };
    case 'data': {
      const key = dataset || 'cov.by_office';
      const def = catalog && catalog.datasets[key];
      return { id, type, params: { dataset: key, view: def ? def.defaultView : 'table', filters: {}, args: {}, figure: {}, palette: 'sober' } };
    }
    case 'section': return { id, type, params: { orientation: 'landscape', header: 'inherit', footer: 'inherit' } };
    case 'columns': return { id, type, params: { ratio: '1:1', cols: [[], []] } };
    case 'repeat': return { id, type, params: { over: 'activity', blocks: [{ id: newId('heading'), type: 'heading', params: { text: '{activite}', level: 2 } }, { id: newId('kpis'), type: 'kpis', params: { metrics: ['sites_realised', 'coverage', 'conformity'], filters: {} } }] } };
    case 'spacer': return { id, type, params: { height: 8 } };
    default: return { id, type, params: {} };
  }
}

/** Copie d'un bloc avec de NOUVEAUX identifiants (enfants compris). */
export function cloneWithIds(b) {
  const c = JSON.parse(JSON.stringify(b));
  const renew = (x) => {
    x.id = newId(x.type);
    if (x.type === 'repeat') x.params.blocks.forEach(renew);
    if (x.type === 'columns') x.params.cols.forEach((col) => col.forEach(renew));
    return x;
  };
  return renew(c);
}

/** Parcourt tous les blocs : visit(bloc, { parent, list, index, colIndex }). */
export function walk(blocks, visit, parent = null, colIndex = null) {
  (blocks || []).forEach((b, index) => {
    visit(b, { parent, list: blocks, index, colIndex });
    if (b.type === 'repeat') walk(b.params.blocks, visit, b);
    if (b.type === 'columns') b.params.cols.forEach((col, c) => walk(col, visit, b, c));
  });
}

/** Bloc d'identifiant `id` (n'importe où), avec son parent. */
export function findBlock(blocks, id) {
  let found = null;
  walk(blocks, (b, at) => { if (!found && b.id === id) found = { block: b, ...at }; });
  return found;
}

/** Copie des blocs où `fn` remplace le bloc `id`. */
export function mapBlock(blocks, id, fn) {
  return (blocks || []).map((b) => {
    if (b.id === id) return fn(b);
    if (b.type === 'repeat') return { ...b, params: { ...b.params, blocks: mapBlock(b.params.blocks, id, fn) } };
    if (b.type === 'columns') return { ...b, params: { ...b.params, cols: b.params.cols.map((col) => mapBlock(col, id, fn)) } };
    return b;
  });
}

/** Copie des blocs où la LISTE qui contient `id` est transformée par `fn(list, index)`. */
export function mapContainer(blocks, id, fn) {
  const i = (blocks || []).findIndex((b) => b.id === id);
  if (i >= 0) return fn(blocks, i);
  return (blocks || []).map((b) => {
    if (b.type === 'repeat') return { ...b, params: { ...b.params, blocks: mapContainer(b.params.blocks, id, fn) } };
    if (b.type === 'columns') return { ...b, params: { ...b.params, cols: b.params.cols.map((col) => mapContainer(col, id, fn)) } };
    return b;
  });
}

export const updateParams = (blocks, id, patch) => mapBlock(blocks, id, (b) => ({ ...b, params: { ...b.params, ...patch } }));
export const removeBlock = (blocks, id) => mapContainer(blocks, id, (list, i) => list.filter((_, k) => k !== i));
export const duplicateBlock = (blocks, id) => mapContainer(blocks, id, (list, i) => [...list.slice(0, i + 1), cloneWithIds(list[i]), ...list.slice(i + 1)]);
export const moveBlock = (blocks, id, dir) => mapContainer(blocks, id, (list, i) => {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; return n;
});
export const moveBlockTo = (blocks, id, toIndex) => mapContainer(blocks, id, (list, i) => {
  const n = [...list]; const [it] = n.splice(i, 1); n.splice(Math.min(toIndex, n.length), 0, it); return n;
});

/**
 * Insère `block` après le bloc `afterId` ou avant le bloc `beforeId` (dans la même liste), ou
 * à la fin de la section répétée / de la colonne `into` ({ id, col }), ou à la fin du document.
 * Refuse ce que le serveur refuserait : répétition dans une répétition, colonnes ou section
 * dans des colonnes, colonnes dans… des colonnes. Renvoie { blocks, error }.
 */
export function insertBlock(blocks, block, { afterId = null, beforeId = null, into = null } = {}) {
  if (beforeId && !into) {
    const at = findBlock(blocks, beforeId);
    if (at) {
      const c = at.parent;
      if (c && c.type === 'repeat' && block.type === 'repeat') return { blocks, error: 'Une section répétée ne peut pas en contenir une autre.' };
      if (c && c.type === 'columns' && ['columns', 'section', 'repeat'].includes(block.type)) return { blocks, error: 'Une colonne ne contient que des blocs simples.' };
      return { blocks: mapContainer(blocks, beforeId, (list, i) => [...list.slice(0, i), block, ...list.slice(i)]), error: null };
    }
  }
  const target = into ? findBlock(blocks, into.id) : afterId ? findBlock(blocks, afterId) : null;
  const container = into ? target && target.block : target && target.parent;
  if (container && container.type === 'repeat' && block.type === 'repeat') return { blocks, error: 'Une section répétée ne peut pas en contenir une autre.' };
  if (container && container.type === 'columns' && ['columns', 'section', 'repeat'].includes(block.type)) return { blocks, error: 'Une colonne ne contient que des blocs simples.' };
  if (into && target) {
    const b = target.block;
    if (b.type === 'repeat') return { blocks: mapBlock(blocks, b.id, (x) => ({ ...x, params: { ...x.params, blocks: [...x.params.blocks, block] } })), error: null };
    if (b.type === 'columns') return { blocks: mapBlock(blocks, b.id, (x) => ({ ...x, params: { ...x.params, cols: x.params.cols.map((col, c) => (c === (into.col || 0) ? [...col, block] : col)) } })), error: null };
  }
  if (afterId && target) return { blocks: mapContainer(blocks, afterId, (list, i) => [...list.slice(0, i + 1), block, ...list.slice(i + 1)]), error: null };
  return { blocks: [...(blocks || []), block], error: null };
}

/**
 * « Mettre ce bloc sur une page paysage » (tableau trop large) : une section paysage AVANT le bloc
 * (ou la section qui le précède directement, réorientée) et une section de l'orientation
 * précédente APRÈS lui, sauf s'il est le dernier de sa liste ou déjà suivi d'une section. Refusé
 * dans des colonnes (une colonne ne contient pas de section). Renvoie { blocks, error }.
 */
export function landscapeAround(blocks, id, previous = 'portrait') {
  const at = findBlock(blocks, id);
  if (!at) return { blocks, error: null };
  if (at.parent && at.parent.type === 'columns') return { blocks, error: 'Une colonne ne contient que des blocs simples.' };
  const section = (orientation) => ({ id: newId('section'), type: 'section', params: { orientation, header: 'inherit', footer: 'inherit' } });
  return {
    error: null,
    blocks: mapContainer(blocks, id, (list, i) => {
      const out = [...list];
      const after = out[i + 1];
      if (after && after.type !== 'section') out.splice(i + 1, 0, section(previous === 'landscape' ? 'portrait' : previous));
      const before = out[i - 1];
      if (before && before.type === 'section') out[i - 1] = { ...before, params: { ...before.params, orientation: 'landscape' } };
      else out.splice(i, 0, section('landscape'));
      return out;
    }),
  };
}

/** Liste de blocs qui contient les blocs d'une page : la racine, ou les blocs d'une section répétée. */
const listOf = (blocks, container) => {
  if (!container) return blocks || [];
  const c = findBlock(blocks, container);
  return c && c.block.type === 'repeat' ? c.block.params.blocks : null;
};
const withList = (blocks, container, fn) => (container
  ? mapBlock(blocks, container, (r) => ({ ...r, params: { ...r.params, blocks: fn(r.params.blocks) } }))
  : fn(blocks));
const sectionBlock = (params) => ({ id: newId('section'), type: 'section', params: { header: 'inherit', footer: 'inherit', ...params } });
/** Réglages d'une section sans ses valeurs « absentes » (absente = celle du document). */
const cleanParams = (p) => Object.fromEntries(Object.entries(p || {}).filter(([, v]) => v !== undefined));

/**
 * Mise en page d'UNE page (onglet Pages, retour 88) : orientation, format, en-tête et pied de
 * CETTE page seulement. Son contenu — les blocs [firstId … lastId] d'une même liste (racine, ou
 * section répétée `container`) — passe dans une section propre, et une section de RÉTABLISSEMENT
 * après lui rend aux pages suivantes la mise en page d'avant : les autres pages ne changent pas.
 * Si une section commence déjà exactement au 1er bloc de la page, elle est modifiée (et rétablie
 * après la page si elle allait plus loin). `patch` : { orientation, size, header, footer,
 * headerBand, footerBand } (undefined = celle du document).
 * @returns {{ blocks: object[], sectionId: string|null }}
 */
export function setPageLayout(blocks, { container = null, firstId, lastId, patch }) {
  const list = listOf(blocks, container);
  if (!list) return { blocks, sectionId: null };
  const i = list.findIndex((b) => b.id === firstId);
  const j = list.findIndex((b) => b.id === lastId);
  if (i < 0 || j < i) return { blocks, sectionId: null };
  let k = i - 1;
  while (k >= 0 && list[k].type !== 'section') k -= 1;
  const prev = k >= 0 ? list[k] : null; // section en vigueur avant la page (null = le document)
  const next = list.findIndex((b, x) => x > i && b.type === 'section');
  const end = next < 0 ? list.length : next; // fin de la section qui contient la page
  let sectionId = null;
  const out = withList(blocks, container, (l) => {
    const n = [...l];
    const restoreAfter = (params) => { if (j + 1 < n.length && n[j + 1].type !== 'section') n.splice(j + 1, 0, sectionBlock(params)); };
    if (prev && k === i - 1) {
      // Une section commence au 1er bloc de la page : on la modifie ; si elle continue après la page, on rétablit.
      const old = prev.params || {};
      n[k] = { ...prev, params: cleanParams({ ...old, ...patch }) };
      sectionId = prev.id;
      if (end - 1 > j) restoreAfter(cleanParams(old));
    } else {
      const base = prev ? cleanParams(prev.params) : {};
      restoreAfter(base);
      const s = sectionBlock(cleanParams({ ...base, ...patch }));
      sectionId = s.id;
      n.splice(i, 0, s);
    }
    return n;
  });
  return { blocks: out, sectionId };
}

/** Identifiant d'instance d'un bloc (racine ou section répétée). */
export const iidOf = (blockId, repeat = null) => (repeat ? `${repeat.id}~${repeat.key}~${blockId}` : blockId);

/** Textes d'en-tête / pied : remplace les {variables} connues ; une inconnue reste telle quelle. */
export const substitute = (text, vars) => String(text == null ? '' : text).replace(/\{([a-z_]{2,40})\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

/**
 * Images COMPTÉES d'un document (limite MAX_REPORT_IMAGES du serveur) — jumelle de server
 * reportSchema.countedImageRefs : blocs image, bandes d'une section qui a les siennes, bandes
 * affichées de la page (1re page si « propre »). Parité testée (reportBands.test.js).
 */
export function docImageCount(doc) {
  let n = 0;
  walk((doc && doc.blocks) || [], (b) => {
    const p = b.params || {};
    if (b.type === 'image' && p.assetId) n += 1;
    if (b.type === 'section') n += (p.header === 'own' ? bandImageCount(p.headerBand) : 0) + (p.footer === 'own' ? bandImageCount(p.footerBand) : 0);
  });
  return n + layoutImageCount((doc && doc.page) || {});
}
