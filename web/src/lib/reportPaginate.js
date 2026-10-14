// Pagination EXACTE du concepteur de rapport (lot 7a, C7) — logique PURE (sans DOM), testée
// depuis le serveur (server/test/reportPaginate.test.js). Calculée UNE fois à partir des hauteurs
// mesurées, elle sert telle quelle à l'aperçu, au PDF (feuilles pré-découpées) et plus tard au
// PowerPoint (une diapositive par page) : ce qui s'affiche est ce qui s'imprime.
//
// Règles :
//  - une section commence une nouvelle page, avec sa géométrie (format, orientation) ;
//  - un titre reste avec le bloc qui le suit (keepWithNext) ;
//  - un tableau se coupe entre deux lignes et RÉPÈTE son en-tête ; un texte se coupe entre deux
//    paragraphes ; jamais un en-tête de tableau seul en bas de page ;
//  - un bloc insécable plus haut qu'une page est réduit à l'échelle (graphiques, cartes) ou
//    signalé « Bloc plus haut qu'une page » (tooTall) ;
//  - un saut de page force une nouvelle page ;
//  - numéros de page « n / N » exacts, sommaire (page de chaque bloc).
// Unités : quelconques mais COHÉRENTES (px mesurés à l'écran ou mm).

/** Formats de page en millimètres (16:9 = taille par défaut de PowerPoint). */
export const PAGE_MM = {
  A4: { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } },
  '16:9': { portrait: { w: 190.5, h: 338.67 }, landscape: { w: 338.67, h: 190.5 } },
};
/** Nom de page CSS (`@page a4p`…) d'un format et d'une orientation. */
export const pageName = (size, orientation) => `${size === '16:9' ? 's169' : 'a4'}${orientation === 'landscape' ? 'l' : 'p'}`;

export function pageSize(size = 'A4', orientation = 'portrait') {
  const s = PAGE_MM[size] || PAGE_MM.A4;
  return s[orientation === 'landscape' ? 'landscape' : 'portrait'];
}

const bandH = (band) => (band && Array.isArray(band.elements) && band.elements.length ? Number(band.height) || 0 : 0);

/**
 * Géométrie d'une page (mm) : dimensions, marges, hauteurs d'en-tête et de pied, zone utile.
 * @param {object} page mise en page du document ; @param {object} section { size, orientation, header, footer }
 * @param {{ first?: boolean }} opts première page du document (règle `firstPage` : same / none / own)
 */
export function pageGeometry(page = {}, section = {}, { first = false } = {}) {
  const size = section.size || page.size || 'A4';
  const orientation = section.orientation || page.orientation || 'portrait';
  const { w, h } = pageSize(size, orientation);
  const m = { top: 16, right: 14, bottom: 16, left: 14, ...(page.margins || {}) };
  const fp = page.firstPage || 'same';
  let header = section.header === 'none' ? 0 : bandH(page.header);
  let footer = section.footer === 'none' ? 0 : bandH(page.footer);
  if (first && fp === 'none') { header = 0; footer = 0; }
  if (first && fp === 'own') { header = section.header === 'none' ? 0 : bandH(page.firstHeader); footer = section.footer === 'none' ? 0 : bandH(page.firstFooter); }
  return {
    size, orientation, w, h, margins: m, headerH: header, footerH: footer,
    bodyW: Math.max(10, w - m.left - m.right), bodyH: Math.max(10, h - m.top - m.bottom - header - footer),
  };
}

const sum = (list, i, j) => { let s = 0; for (let k = i; k < j; k += 1) s += list[k]; return s; };
const partsOf = (split) => (split ? (split.rows || split.nodes || split.parts || []) : []);

/** Hauteur minimale du premier morceau d'un élément (pour garder un titre avec la suite). */
function minFirst(item) {
  if (!item || item.break) return 0;
  const parts = partsOf(item.split);
  if (item.split && parts.length) return (item.split.headH || 0) + parts[0] + (parts.length === 1 ? (item.split.footH || 0) : 0);
  return item.h || 0;
}

/**
 * Pagination.
 * @param {{ id, size, orientation, bodyH, firstBodyH?, items: { iid, h, keepWithNext?, scalable?, break?,
 *   split?: { kind: 'rows'|'nodes', headH, repeatH?, footH?, rows?|nodes?: number[] } }[] }[]} sections
 * @param {{ gap?: number }} opts écart vertical entre deux blocs d'une même page
 * @returns {{ pages: { n, sectionId, sectionIndex, size, orientation, used, items: { iid, part?: [number, number], first?, last?, scale?, tooTall? }[] }[],
 *   total: number, pageOf: Object<string, number> }}
 */
export function paginate(sections, { gap = 0 } = {}) {
  const pages = [];
  let page = null;
  const capOf = (sec) => (pages.length === 0 && sec.firstBodyH != null ? sec.firstBodyH : sec.bodyH);
  const open = (sec, si) => {
    page = { n: pages.length + 1, sectionId: sec.id, sectionIndex: si, size: sec.size, orientation: sec.orientation, cap: capOf(sec), used: 0, items: [] };
    pages.push(page);
  };
  const avail = () => page.cap - page.used - (page.items.length ? gap : 0);
  const place = (entry, h) => { page.used += (page.items.length ? gap : 0) + h; page.items.push(entry); };

  (sections || []).forEach((sec, si) => {
    const items = (sec.items || []).filter(Boolean);
    if (!items.length) return; // section vide : aucune page blanche
    open(sec, si);
    items.forEach((it, i) => {
      if (it.break) { if (page.items.length) open(sec, si); return; }
      // Titre gardé avec le bloc suivant.
      if (it.keepWithNext && page.items.length) {
        const next = items.slice(i + 1).find((x) => !x.break);
        if (next && (it.h || 0) + gap + minFirst(next) > avail()) open(sec, si);
      }
      const parts = partsOf(it.split);
      if (!it.split || !parts.length) {
        const h = it.h || 0;
        if (h > avail() && page.items.length) open(sec, si);
        if (h > page.cap + 1e-6) {
          if (it.scalable) place({ iid: it.iid, scale: page.cap / h }, page.cap);
          else place({ iid: it.iid, tooTall: true }, h);
        } else place({ iid: it.iid }, h);
        return;
      }
      // Bloc sécable : lignes d'un tableau (en-tête répété) ou paragraphes d'un texte.
      const { headH = 0, footH = 0 } = it.split;
      const repeatH = it.split.repeatH != null ? it.split.repeatH : headH;
      let k = 0;
      while (k < parts.length) {
        const head = k === 0 ? headH : repeatH;
        const room = avail();
        let j = k;
        while (j < parts.length) {
          const isLast = j + 1 === parts.length;
          const need = head + sum(parts, k, j + 1) + (isLast ? footH : 0);
          if (need > room + 1e-6) break;
          j += 1;
        }
        if (j === k) {
          // Pas même une ligne : nouvelle page, ou (page vide) une ligne de force, signalée.
          if (page.items.length) { open(sec, si); continue; }
          j = k + 1;
          const isLast = j === parts.length;
          place({ iid: it.iid, part: [k, j], first: k === 0, last: isLast, tooTall: true }, head + parts[k] + (isLast ? footH : 0));
        } else {
          const isLast = j === parts.length;
          place({ iid: it.iid, part: [k, j], first: k === 0, last: isLast }, head + sum(parts, k, j) + (isLast ? footH : 0));
        }
        k = j;
        if (k < parts.length) open(sec, si);
      }
    });
  });
  if (!pages.length && sections && sections.length) {
    const s = sections[0];
    pages.push({ n: 1, sectionId: s.id, sectionIndex: 0, size: s.size, orientation: s.orientation, cap: capOf(s), used: 0, items: [] });
  }
  const pageOf = {};
  for (const p of pages) for (const it of p.items) if (pageOf[it.iid] == null) pageOf[it.iid] = p.n;
  return { pages: pages.map(({ cap, ...p }) => p), total: pages.length, pageOf };
}

// Mêmes règles que le plan du serveur (server/src/modules/reports/renderPlan.js).
const TABLE_VIEWS = new Set(['table', 'heat']);
const FIGURE_VIEWS = new Set(['bar', 'column', 'line', 'donut', 'stacked', 'map', 'gauge']);
const ITEM_VAR = { activity: 'activite', bureau: 'bureau', partner: 'partenaire' };
const DATA_TYPES = new Set(['data', 'kpis', 'bulletin']);
const subst = (text, vars) => String(text == null ? '' : text).replace(/\{([a-z_]{2,40})\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

/**
 * Plan LOCAL, toujours à jour avec le document affiché (le plan du serveur arrive après un court
 * délai) : sections, instances avec les MÊMES identifiants que le serveur (`blocId`, ou
 * `répétition~élément~blocId`), figures et tableaux numérotés dans l'ordre du document, textes des
 * titres remplis. Les éléments des sections répétées viennent du dernier plan du serveur
 * (`expansions`). Permet d'afficher et de paginer la page tout de suite (jamais de page blanche).
 * @param {object} doc @param {{ expansions?: object, vars?: object, defaultView?: (dataset) => string }} opts
 */
export function localPlan(doc, { expansions = {}, vars = {}, defaultView = () => 'table' } = {}) {
  const page = (doc && doc.page) || {};
  const sections = [{ id: '_doc', index: 0, size: page.size || 'A4', orientation: page.orientation || 'portrait', header: 'inherit', footer: 'inherit', title: null }];
  const instances = [];
  const counters = { table: 0, figure: 0 };
  let cur = sections[0];
  const visit = (b, { repeat = null, item = null, column = null } = {}) => {
    const iid = repeat ? `${repeat.id}~${item.key}~${b.id}` : b.id;
    const iv = repeat && item ? { [ITEM_VAR[repeat.params.over]]: item.label } : {};
    const p = b.params || {};
    const base = {
      iid, blockId: b.id, type: b.type, sectionId: cur.id, repeatId: repeat ? repeat.id : null, repeatKey: item ? item.key : null,
      repeatLabel: item ? item.label : null, column: column ? column.iid : null, columnIndex: column ? column.index : null, needsData: false,
    };
    if (b.type === 'section') {
      cur = { id: iid, index: sections.length, size: p.size || page.size || 'A4', orientation: p.orientation || page.orientation || 'portrait', header: p.header || 'inherit', footer: p.footer || 'inherit', title: p.title ? subst(p.title, { ...vars, ...iv }) : null };
      sections.push(cur);
      instances.push({ ...base, sectionId: cur.id });
      return;
    }
    if (b.type === 'columns') {
      instances.push(base);
      p.cols.forEach((col, c) => col.forEach((cb) => visit(cb, { repeat, item, column: { iid, index: c } })));
      return;
    }
    if (b.type === 'repeat') {
      const items = expansions[b.id] || [];
      instances.push({ ...base, count: items.length });
      for (const it of items) for (const c of p.blocks) visit(c, { repeat: b, item: it });
      return;
    }
    const inst = { ...base, needsData: DATA_TYPES.has(b.type) };
    if (b.type === 'data') {
      const view = p.view || defaultView(p.dataset);
      inst.dataset = p.dataset;
      inst.view = view;
      const numbered = !(p.figure && p.figure.numbered === false);
      const kind = !numbered ? null : TABLE_VIEWS.has(view) ? 'table' : FIGURE_VIEWS.has(view) ? 'figure' : null;
      if (kind) { counters[kind] += 1; inst.figure = { kind, n: counters[kind] }; }
    }
    if (b.type === 'heading') { inst.level = p.level || 2; inst.text = subst(p.text, { ...vars, ...iv }); }
    instances.push(inst);
  };
  for (const b of (doc && doc.blocks) || []) visit(b);
  return { sections, instances, expansions, local: true };
}

/**
 * Éléments à paginer d'une section, dans l'ordre du plan : blocs de la racine, colonnes (un
 * bloc insécable), enfants des sections répétées ; les sections et conteneurs n'en sont pas.
 * @returns {{ id, size, orientation, header, footer, title, items: object[] }[]}
 */
export function sectionsOfPlan(plan) {
  const out = (plan.sections || []).map((s) => ({ ...s, items: [] }));
  const byId = Object.fromEntries(out.map((s) => [s.id, s]));
  for (const inst of plan.instances || []) {
    if (inst.type === 'section' || inst.type === 'repeat' || inst.column) continue;
    const s = byId[inst.sectionId] || out[out.length - 1];
    if (s) s.items.push(inst);
  }
  return out;
}

/** Sommaire : titres (niveau ≤ profondeur) avec leur page. */
export function tocEntries(plan, pageOf, depth = 2) {
  return (plan.instances || []).filter((i) => i.type === 'heading' && (i.level || 2) <= depth && pageOf[i.iid] != null)
    .map((i) => ({ iid: i.iid, level: i.level || 2, text: i.text || '', page: pageOf[i.iid] }));
}
