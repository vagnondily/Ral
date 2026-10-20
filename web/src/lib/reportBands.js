// En-tête et pied de page LIBRES du concepteur de rapport (lot 7a C8, retours 51 et 88) — logique
// PURE (sans DOM), testée depuis le serveur (server/test/reportBands.test.js, qui valide aussi chaque
// modèle contre le schéma zod du serveur) :
//  - modèles prédéfinis sobres (jetons du système de design, aucune marque) ;
//  - placement sur une grille : déplacer, redimensionner (8 poignées), aimanter aux bords et centres
//    des autres éléments et de la bande, flèches du clavier ;
//  - un élément reste toujours DANS sa bande (mêmes règles que le serveur : x + l ≤ 100 %, y + h ≤ hauteur).
// Unités : x et l en % de la largeur imprimable (l'en-tête suit l'orientation de chaque page), y et h en mm.

/** Couleurs proposées : jetons du système de design (« Enterprise sobre »). Un code #RRGGBB reste possible. */
export const BAND_COLORS = [
  ['#14181f', 'Encre'], ['#3a4150', 'Texte'], ['#616a7a', 'Texte discret'], ['#8b93a1', 'Gris'],
  ['#ccd2dc', 'Filet appuyé'], ['#e7e9ef', 'Filet'], ['#f6f8fb', 'Gris très clair'], ['#ffffff', 'Blanc'],
  ['#0b5394', 'Bleu foncé'], ['#0f6cbd', 'Bleu'], ['#eff6fc', 'Bleu très clair'], ['#0f7b40', 'Vert'], ['#c77700', 'Ambre'],
];
/** Variables utiles dans un en-tête ou un pied ({page} et {pages} : posées par la pagination). */
export const BAND_VARIABLES = ['titre', 'periode', 'bureau', 'date', 'page', 'pages', 'section'];
export const MIN_W_MM = 4;
export const MIN_H_MM = 3;
const MIN_LINE_H = 2;

/** Interligne d'un texte « sur plusieurs lignes » (reports.css, .rd-el-text.is-wrap) ; 1 pt = 0,3528 mm. */
export const WRAP_LINE_HEIGHT = 1.12;
const PT_MM = 0.3528;

/**
 * Lignes d'un texte « sur plusieurs lignes » (grand titre) qui tiennent ENTIÈRES dans son cadre :
 * floor(h_mm ÷ (taille_pt × 0,3528 × 1,12)), au moins 1. Posé en -webkit-line-clamp : au-delà, la
 * dernière ligne visible finit par « … » — jamais la PREMIÈRE ligne coupée (le texte part du haut).
 * @param {number} hMm hauteur du cadre (mm) @param {number} sizePt taille du texte (pt)
 */
export function wrapLines(hMm, sizePt, lineHeight = WRAP_LINE_HEIGHT) {
  const line = Number(sizePt) * PT_MM * lineHeight;
  if (!(line > 0) || !(Number(hMm) > 0)) return 1;
  return Math.max(1, Math.floor(Number(hMm) / line + 1e-9));
}

export const toMm = (pct, bodyW) => (Number(pct) * bodyW) / 100;
export const toPct = (mm, bodyW) => (Number(mm) / bodyW) * 100;
export const snap = (v, step = 1) => (step > 0 ? Math.round(v / step) * step : v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 100) / 100;
const minH = (e, bandH) => Math.min(e.kind === 'line' ? MIN_LINE_H : MIN_H_MM, Math.max(MIN_LINE_H, bandH));

/**
 * Élément gardé DANS sa bande, arrondi au centième sans jamais dépasser (règles du serveur :
 * x + l ≤ 100 %, y + h ≤ hauteur, l ≥ 1 %, h ≥ 2 mm). Un geste de redimensionnement impose en
 * plus 4 mm × 3 mm (resizeBy) ; un filet d'accent plus fin, posé par un modèle, reste possible.
 * @param {object} e @param {{ bandH: number, bodyW: number }} ctx
 */
export function clampElement(e, { bandH }) {
  const w = r2(clamp(Number(e.w) || 0, 1, 100));
  const h = r2(clamp(Number(e.h) || 0, MIN_LINE_H, Math.max(MIN_LINE_H, bandH)));
  const x = Math.min(r2(clamp(Number(e.x) || 0, 0, 100)), r2(100 - w));
  const y = Math.min(r2(clamp(Number(e.y) || 0, 0, bandH)), r2(Math.max(0, bandH - h)));
  return { ...e, x: Math.max(0, x), y: Math.max(0, y), w, h };
}

/** Repères d'aimantation : bords et centre de la bande et des autres éléments (mm). */
function targets(others, { bodyW, bandH }) {
  const v = [0, bodyW / 2, bodyW]; const h = [0, bandH / 2, bandH];
  for (const o of others || []) {
    const ox = toMm(o.x, bodyW); const ow = toMm(o.w, bodyW);
    v.push(ox, ox + ow / 2, ox + ow);
    h.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { v, h };
}
/** Meilleure position d'un segment [pos, pos + size] : sur un repère (bord ou centre) à moins de `tol`, sinon sur la grille. */
function snapSegment(pos, size, list, { grid, tol }) {
  let best = null;
  for (const off of [0, size / 2, size]) {
    for (const t of list) {
      const d = Math.abs(pos + off - t);
      if (d <= tol && (!best || d < best.d)) best = { d, pos: t - off, line: t };
    }
  }
  return best ? { pos: best.pos, line: best.line } : { pos: snap(pos, grid), line: null };
}

/**
 * DÉPLACER (glisser) : position voulue (mm, coin haut gauche) → position aimantée sur les repères
 * (bords et centres des autres éléments et de la bande, à moins de `tol` mm) ou sur la grille, puis
 * gardée dans la bande. Renvoie aussi les repères à afficher (traits bleus).
 * @returns {{ element: object, guides: { v: number[], h: number[] } }} repères en mm
 */
export function moveTo(e, xMm, yMm, { others = [], bodyW, bandH, grid = 1, tol = 1.2 } = {}) {
  const t = targets(others, { bodyW, bandH });
  const sx = snapSegment(xMm, toMm(e.w, bodyW), t.v, { grid, tol });
  const sy = snapSegment(yMm, e.h, t.h, { grid, tol });
  const element = clampElement({ ...e, x: toPct(sx.pos, bodyW), y: sy.pos }, { bandH, bodyW });
  return { element, guides: { v: sx.line == null ? [] : [sx.line], h: sy.line == null ? [] : [sy.line] } };
}

/**
 * REDIMENSIONNER par une poignée (n, s, e, w, ne, nw, se, sw) : le bord tiré bouge de (dx, dy) mm,
 * aimanté sur la grille ; le bord opposé ne bouge pas ; tailles minimales ; reste dans la bande.
 * @param {object} start élément au début du geste
 */
export function resizeBy(start, handle, dxMm, dyMm, { bodyW, bandH, grid = 1 } = {}) {
  let left = toMm(start.x, bodyW); let right = left + toMm(start.w, bodyW);
  let top = start.y; let bottom = top + start.h;
  const mw = MIN_W_MM; const mh = minH(start, bandH);
  if (handle.includes('w')) left = clamp(snap(left + dxMm, grid), 0, right - mw);
  if (handle.includes('e')) right = clamp(snap(right + dxMm, grid), left + mw, bodyW);
  if (handle.includes('n')) top = clamp(snap(top + dyMm, grid), 0, bottom - mh);
  if (handle.includes('s')) bottom = clamp(snap(bottom + dyMm, grid), top + mh, bandH);
  return clampElement({ ...start, x: toPct(left, bodyW), w: toPct(right - left, bodyW), y: top, h: bottom - top }, { bandH, bodyW });
}

/**
 * CLAVIER : flèches = déplacer de 1 mm (Maj : 5 mm) ; Alt + flèches = redimensionner (droite / bas).
 * @returns {object|null} élément modifié, ou null si la touche n'est pas une flèche
 */
export function nudge(e, key, { shift = false, alt = false } = {}, { bodyW, bandH }) {
  const step = shift ? 5 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
  if (!d) return null;
  if (alt) return resizeBy(e, `${d[1] ? 's' : ''}${d[0] ? 'e' : ''}`, d[0], d[1], { bodyW, bandH, grid: 0 });
  return clampElement({ ...e, x: e.x + toPct(d[0], bodyW), y: e.y + d[1] }, { bandH, bodyW });
}

/** Nouvel identifiant d'élément, unique dans la bande. */
export function nextElementId(kind, elements) {
  const used = new Set((elements || []).map((x) => x.id));
  let i = 1;
  while (used.has(`${kind}-${i}`)) i += 1;
  return `${kind}-${i}`;
}

const STYLE = { font: 'Inter', size: 8, bold: false, italic: false, color: '#616a7a', align: 'left', padding: 0, radius: 0 };
const st = (o = {}) => ({ ...STYLE, ...o });

/**
 * Élément ajouté depuis la palette, de taille raisonnable, centré dans la bande.
 * @param {'text'|'image'|'rect'|'line'|'pageNumber'|'band'} kind  'band' = bandeau pleine largeur
 */
export function newElement(kind, { elements = [], bodyW, bandH, assetId = null, text = '{titre}' } = {}) {
  const id = nextElementId(kind === 'band' ? 'rect' : kind, elements);
  const mid = (h) => Math.max(0, (bandH - h) / 2);
  const make = (e) => clampElement(e, { bandH, bodyW });
  switch (kind) {
    case 'text': return make({ id, kind, x: 30, y: mid(6), w: 40, h: 6, text, style: st({ color: '#3a4150', size: 9 }) });
    case 'image': { const h = Math.min(14, Math.max(MIN_H_MM, bandH - 2)); return make({ id, kind, x: 0, y: mid(h), w: toPct(h * 2.6, bodyW), h, assetId: assetId || null, align: 'left' }); }
    case 'rect': return make({ id, kind, x: 35, y: mid(8), w: 30, h: 8, fill: '#eff6fc', radius: 1.5, opacity: 1 });
    // Bandeau : barre FINE sur la largeur du texte (jamais un aplat lourd par défaut) ; « bord à bord » et hauteur se règlent ensuite.
    case 'band': return make({ id, kind: 'rect', x: 0, y: 0, w: 100, h: 2, fill: '#0b5394', radius: 0, opacity: 1 });
    case 'line': return make({ id, kind, x: 0, y: Math.max(0, bandH - 2), w: 100, h: 2, thickness: 0.5, color: '#ccd2dc' });
    case 'pageNumber': return make({ id, kind, x: 70, y: mid(6), w: 30, h: 6, format: 'Page n / N', style: st({ align: 'right' }) });
    default: return null;
  }
}

/** Ordre d'empilement (le dernier est au premier plan) : 'up', 'down', 'front', 'back'. */
export function reorder(elements, id, where) {
  const list = [...(elements || [])];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return list;
  const [it] = list.splice(i, 1);
  const j = where === 'front' ? list.length : where === 'back' ? 0 : where === 'up' ? Math.min(list.length, i + 1) : Math.max(0, i - 1);
  list.splice(j, 0, it);
  return list;
}

/** Nouvelle hauteur de bande (0 à 60 mm ; 4 mm au moins si elle a des éléments) : les éléments restent dedans (remontés ou réduits). */
export function setBandHeight(band, height, { bodyW }) {
  const elements = (band && band.elements) || [];
  const h = r2(clamp(Number(height) || 0, elements.length ? 4 : 0, 60));
  return { height: h, elements: elements.map((e) => clampElement(e, { bandH: h, bodyW })) };
}

// ---- Modèles prédéfinis ------------------------------------------------------------------
const B = (x, y, w, h) => ({ x, y, w, h });
const text = (id, t, box, style) => ({ id, kind: 'text', ...box, text: t, style: st(style) });
const pageNo = (id, format, box, style) => ({ id, kind: 'pageNumber', ...box, format, style: st(style) });
const line = (id, box, thickness, color, dir) => ({ id, kind: 'line', ...box, thickness, color, ...(dir ? { dir } : {}) });
const rect = (id, box, fill, extra = {}) => ({ id, kind: 'rect', ...box, fill, radius: 0, opacity: 1, ...extra });
const image = (id, box, assetId, align = 'left') => ({ id, kind: 'image', ...box, assetId: assetId || null, align });
const INK = '#14181f'; const TEXT = '#3a4150'; const MUTED = '#616a7a'; const FAINT = '#8b93a1';
const RULE = '#e7e9ef'; const RULE2 = '#ccd2dc'; const BLUE = '#0f6cbd'; const BLUE_DK = '#0b5394';
/** Millimètres de la largeur imprimable d'une page A4 portrait (182 mm) → % (les modèles se dessinent en mm). */
const P = (mm) => Math.round((mm / 182) * 10000) / 100;
const clone = (b) => JSON.parse(JSON.stringify(b));

/** Pied commun : filet fin, mention à gauche (date d'édition ou diffusion), « Page x sur y » à droite. */
const footerOf = (left, { center = null, italic = false } = {}) => ({ height: 9, elements: [
  line('f-rule', B(0, 0, 100, 2), 0.5, RULE),
  text('f-left', left, B(0, 3, center ? 30 : 68, 5), { size: 7.5, color: MUTED, italic: italic && !center }),
  ...(center ? [text('f-center', center, B(30, 3, 42, 5), { size: 7.5, color: MUTED, italic: true, align: 'center' })] : []),
  pageNo('f-page', 'Page n sur N', B(72, 3, 28, 5), { size: 7.5, color: MUTED, align: 'right' }),
] });

/**
 * Modèles prédéfinis = PAIRES 1re page / pages suivantes, d'après les rapports de référence de
 * l'utilisateur (rapport de suivi de performances, fiche 2 pages) et les règles des rapports
 * institutionnels (ONU, ONG) :
 *  - 1re page : logo CONTENU (proportions gardées) ou cadre neutre à remplir, organisation et bureau,
 *    grand titre (18 à 24 pt, sur deux lignes au besoin), période en sous-titre, filet d'accent fin ;
 *    aucun aplat saturé (au plus une barre fine en tête) ;
 *  - pages suivantes : en-tête courant discret (organisation ou petit logo, titre court, période) sur
 *    un filet fin, 7,5 à 8 pt ;
 *  - pied : filet fin, date d'édition ou mention de diffusion, « Page x sur y » ;
 *  - tout est aligné sur les marges du texte (x = 0 et 100 % de la largeur imprimable), en Inter.
 * Textes en français, traduits à l'application (localizeBand) ; les emplacements de logo prennent les
 * logos déjà choisis (`logo1`, `logo2`), sinon restent vides. build({ logo1, logo2 }) → paire.
 */
export const BAND_TEMPLATES = [
  {
    key: 'institutional', name: 'Institutionnel sobre',
    description: 'Logo, organisation et bureau, grand titre et période, filet d\'accent ; pages suivantes : en-tête courant sur filet fin.',
    build: ({ logo1 } = {}) => {
      const footer = footerOf('Édité le {date}', { center: 'Document de travail — diffusion restreinte' });
      return {
        firstPage: 'own',
        firstHeader: { height: 48, elements: [
          image('h-logo', B(0, 0, P(46), 13), logo1, 'left'),
          text('h-org', 'Suivi & évaluation', B(50, 1, 50, 4.5), { size: 7, bold: true, caps: true, color: MUTED, align: 'right' }),
          text('h-office', '{bureau}', B(50, 6.5, 50, 4.5), { size: 8.5, color: TEXT, align: 'right' }),
          line('h-rule', B(0, 16, 100, 2), 0.5, RULE2),
          text('h-title', '{titre}', B(0, 19, 100, 19), { size: 21, bold: true, color: INK, wrap: true }),
          text('h-sub', '{periode}', B(0, 39.5, 80, 5.5), { size: 10.5, color: MUTED }),
          line('h-accent', B(0, 46, P(16), 2), 1.5, BLUE),
        ] },
        firstFooter: clone(footer),
        header: { height: 11, elements: [
          text('h-org', 'Suivi & évaluation', B(0, 1.5, 24, 5), { size: 7, bold: true, caps: true, color: MUTED }),
          text('h-title', '{titre}', B(24, 1.5, 50, 5), { size: 8, bold: true, color: INK }),
          text('h-period', '{periode}', B(74, 1.5, 26, 5), { size: 8, color: MUTED, align: 'right' }),
          line('h-rule', B(0, 9, 100, 2), 0.5, RULE2),
        ] },
        footer,
      };
    },
  },
  {
    key: 'donor', name: 'Rapport bailleur',
    description: 'Barre fine en tête, logo de l\'organisation et du bailleur, mention « Rapport au bailleur », grand titre ; pages suivantes : petit logo, titre et période.',
    build: ({ logo1, logo2 } = {}) => {
      const footer = footerOf('Confidentiel — à l\'usage du bailleur et des partenaires', { italic: true });
      return {
        firstPage: 'own',
        firstHeader: { height: 56, elements: [
          rect('h-bar', B(0, 0, 100, 2), BLUE_DK),
          image('h-logo', B(0, 5, P(46), 14), logo1, 'left'),
          image('h-logo2', B(100 - P(46), 5, P(46), 14), logo2, 'right'),
          text('h-kicker', 'Rapport au bailleur', B(0, 24, 60, 4.5), { size: 7.5, bold: true, caps: true, color: BLUE }),
          text('h-title', '{titre}', B(0, 29, 100, 19), { size: 22, bold: true, color: INK, wrap: true }),
          text('h-sub', '{periode} · {bureau}', B(0, 49, 100, 5.5), { size: 10.5, color: MUTED }),
        ] },
        firstFooter: clone(footer),
        header: { height: 12, elements: [
          image('h-logo', B(0, 0.5, P(24), 8), logo1, 'left'),
          text('h-title', '{titre}', B(P(28), 2, 70 - P(28), 5), { size: 8, bold: true, color: INK }),
          text('h-period', '{periode}', B(70, 2, 30, 5), { size: 8, color: MUTED, align: 'right' }),
          line('h-rule', B(0, 10, 100, 2), 0.5, RULE2),
        ] },
        footer,
      };
    },
  },
  {
    key: 'memo', name: 'Note interne',
    description: 'Mention « Note interne », titre, cartouche bureau / période / date / diffusion entre deux filets ; pages suivantes discrètes.',
    build: ({ logo1 } = {}) => {
      const L = P(22); // colonne des libellés du cartouche
      const label = (id, t, x, y) => text(id, t, B(x, y, L, 4.5), { size: 7, bold: true, caps: true, color: FAINT });
      const value = (id, t, x, y) => text(id, t, B(x + L, y, 50 - L, 4.5), { size: 8.5, color: INK });
      const footer = footerOf('Diffusion interne — ne pas transmettre à l\'extérieur', { italic: true });
      return {
        firstPage: 'own',
        firstHeader: { height: 42, elements: [
          text('h-kicker', 'Note interne', B(0, 0, 50, 4.5), { size: 7.5, bold: true, caps: true, color: BLUE }),
          image('h-logo', B(100 - P(36), 0, P(36), 11), logo1, 'right'),
          text('h-title', '{titre}', B(0, 6, 76, 16), { size: 18, bold: true, color: INK, wrap: true }),
          line('h-rule1', B(0, 24.5, 100, 2), 0.5, RULE2),
          label('h-l1', 'Bureau', 0, 27), value('h-v1', '{bureau}', 0, 27),
          label('h-l2', 'Période', 50, 27), value('h-v2', '{periode}', 50, 27),
          label('h-l3', 'Date', 0, 32.5), value('h-v3', '{date}', 0, 32.5),
          label('h-l4', 'Diffusion', 50, 32.5), value('h-v4', 'Interne', 50, 32.5),
          line('h-rule2', B(0, 39.5, 100, 2), 0.5, RULE2),
        ] },
        firstFooter: clone(footer),
        header: { height: 10, elements: [
          text('h-left', 'Note interne · {titre}', B(0, 1.5, 75, 5), { size: 7.5, color: MUTED }),
          text('h-right', '{date}', B(75, 1.5, 25, 5), { size: 7.5, color: MUTED, align: 'right' }),
          line('h-rule', B(0, 8, 100, 2), 0.5, RULE),
        ] },
        footer,
      };
    },
  },
  {
    key: 'bulletin', name: 'Bulletin',
    description: 'Bandeau de titre façon lettre d\'information : filet épais, édition et période, grand titre, filet fin ; pages suivantes : rappel du bulletin.',
    build: ({ logo1 } = {}) => {
      const footer = footerOf('{titre} — {bureau}');
      return {
        firstPage: 'own',
        firstHeader: { height: 43, elements: [
          line('h-top', B(0, 0, 100, 2), 2, INK),
          text('h-kicker', 'Bulletin de suivi', B(0, 3.5, 50, 4.5), { size: 7.5, bold: true, caps: true, color: BLUE }),
          text('h-edition', '{periode}', B(50, 3.5, 50, 4.5), { size: 7.5, bold: true, caps: true, color: INK, align: 'right' }),
          text('h-title', '{titre}', B(0, 10, 78, 21), { size: 24, bold: true, color: INK, wrap: true }),
          image('h-logo', B(100 - P(34), 11, P(34), 14), logo1, 'right'),
          text('h-sub', '{bureau} · Édité le {date}', B(0, 33, 80, 5), { size: 9, color: MUTED }),
          line('h-rule', B(0, 41, 100, 2), 0.5, INK),
        ] },
        firstFooter: clone(footer),
        header: { height: 10, elements: [
          text('h-left', 'Bulletin · {periode}', B(0, 1.5, 45, 5), { size: 7, bold: true, caps: true, color: MUTED }),
          text('h-right', '{titre}', B(45, 1.5, 55, 5), { size: 8, bold: true, color: INK, align: 'right' }),
          line('h-rule', B(0, 8, 100, 2), 0.5, RULE2),
        ] },
        footer,
      };
    },
  },
  {
    key: 'two-pager', name: 'Fiche 2 pages',
    description: 'Fiche de synthèse : titre et bureau à gauche, période et date de publication à droite, filet d\'accent ; page 2 en version compacte.',
    build: ({ logo1 } = {}) => {
      const footer = { height: 10, elements: [
        line('f-rule', B(0, 0, 100, 2), 0.5, RULE2),
        text('f-src', 'Sources : MEMS — suivi de processus et visites de terrain, {periode}.', B(0, 3, 75, 5), { size: 7, color: MUTED }),
        text('f-date', 'Édité le {date}', B(75, 3, 25, 5), { size: 7, color: MUTED, align: 'right' }),
      ] };
      return {
        firstPage: 'own',
        firstHeader: { height: 32, elements: [
          text('h-title', '{titre}', B(0, 0, 66, 16), { size: 19, bold: true, color: INK, wrap: true }),
          text('h-sub', '{bureau}', B(0, 17, 66, 5), { size: 10, color: TEXT }),
          text('h-note', 'Note de synthèse · suivi & évaluation', B(0, 22.5, 66, 4.5), { size: 7.5, color: MUTED }),
          text('h-period', '{periode}', B(66, 1, 34, 5.5), { size: 9.5, bold: true, caps: true, color: INK, align: 'right' }),
          text('h-pub', 'Publié le {date}', B(66, 7.5, 34, 4.5), { size: 8, color: MUTED, align: 'right' }),
          image('h-logo', B(100 - P(30), 15, P(30), 10), logo1, 'right'),
          line('h-accent', B(0, 29.5, 100, 2), 1.5, BLUE),
        ] },
        firstFooter: clone(footer),
        header: { height: 17, elements: [
          text('h-title', '{titre}', B(0, 0, 64, 7.5), { size: 13, bold: true, color: INK }),
          text('h-sub', '{bureau}', B(0, 8, 64, 4.5), { size: 8, color: MUTED }),
          text('h-period', '{periode}', B(64, 0.5, 36, 5), { size: 8.5, bold: true, caps: true, color: INK, align: 'right' }),
          pageNo('h-page', 'Page n sur N', B(64, 6.5, 36, 4.5), { size: 7.5, color: MUTED, align: 'right' }),
          line('h-accent', B(0, 14.5, 100, 2), 1, BLUE),
        ] },
        footer,
      };
    },
  },
  {
    key: 'footer-only', name: 'Pied de page seul',
    description: 'Aucun en-tête (pages pleines : tableaux de bord, annexes) ; pied fin avec le titre, la période et la pagination.',
    build: () => ({
      firstPage: 'same',
      header: { height: 0, elements: [] },
      footer: footerOf('{titre} — {periode}'),
    }),
  },
];

/** Un texte à traduire : il contient des mots hors de ses {variables} (« {titre} » seul ne se traduit pas). */
const hasWords = (t) => /[A-Za-zÀ-ÿ]/.test(String(t).replace(/\{[a-z_]{2,40}\}/g, ''));
/** Textes d'une bande traduits (les {variables} restent intactes : la phrase entière est la clé). */
export const localizeBand = (band, tr) => band && ({
  ...band,
  elements: (band.elements || []).map((e) => (e.kind === 'text' && e.text && hasWords(e.text) ? { ...e, text: tr(e.text) } : e)),
});

// ---- Première page / pages suivantes (retour du 15/10) -------------------------------------
/*
 * Une mise en page d'en-tête est une PAIRE : la PREMIÈRE PAGE et les PAGES SUIVANTES, chacune
 * avec son en-tête et son pied. Modèle du document (inchangé, rapports enregistrés compatibles) :
 *   { header, footer }              pages suivantes (et toutes les pages si la 1re est identique) ;
 *   firstPage 'same' | 'own' | 'none'  1re page identique aux suivantes, propre, ou page de titre ;
 *   { firstHeader, firstFooter }    en-tête et pied de la 1re page quand elle est « propre » — gardés
 *                                   quand on repasse à « identique » (rien n'est perdu en changeant d'avis).
 */
export const FIRST_PAGE_MODES = ['same', 'own', 'none'];
const emptyBand = (h = 0) => ({ height: h, elements: [] });
const copy = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);

/** Clé de la bande éditée : (page 'first' | 'rest', zone 'header' | 'footer') → header, footer, firstHeader, firstFooter. */
export const bandKey = (pageKind, zone) => (pageKind === 'first' ? (zone === 'footer' ? 'firstFooter' : 'firstHeader') : (zone === 'footer' ? 'footer' : 'header'));
/** Inverse : clé de bande → { pageKind, zone } (ouverture du concepteur sur une zone donnée). */
export const zoneOf = (key) => ({
  pageKind: key === 'firstHeader' || key === 'firstFooter' ? 'first' : 'rest',
  zone: key === 'footer' || key === 'firstFooter' ? 'footer' : 'header',
});

/**
 * Change le régime de la 1re page. « Propres » part d'une COPIE des bandes des pages suivantes quand
 * la 1re page n'en a pas encore ; ses bandes déjà dessinées sont gardées dans tous les cas.
 */
export function setFirstPageMode(layout, mode) {
  const m = FIRST_PAGE_MODES.includes(mode) ? mode : 'same';
  const out = { ...layout, firstPage: m };
  if (m === 'own') {
    if (!out.firstHeader) out.firstHeader = copy(layout.header) || emptyBand(14);
    if (!out.firstFooter) out.firstFooter = copy(layout.footer) || emptyBand(10);
  }
  return out;
}

/** Bandes EFFECTIVES de la 1re page et des pages suivantes (aperçu côte à côte, vignettes). */
export function pairBands(layout) {
  const l = layout || {};
  const rest = { header: l.header || null, footer: l.footer || null };
  const fp = l.firstPage || 'same';
  const first = fp === 'none' ? { header: null, footer: null }
    : fp === 'own' ? { header: l.firstHeader || null, footer: l.firstFooter || null } : rest;
  return { first, rest, firstPage: fp };
}

/**
 * Contenu d'un modèle (prédéfini ou « mes en-têtes ») normalisé en PAIRE complète. Un ancien
 * enregistrement { header, footer } donne une 1re page identique aux suivantes.
 */
export function pairOf(content) {
  const c = content || {};
  const fp = FIRST_PAGE_MODES.includes(c.firstPage) ? c.firstPage : 'same';
  const out = { header: copy(c.header) || emptyBand(0), footer: copy(c.footer) || emptyBand(0), firstPage: fp };
  if (c.firstHeader) out.firstHeader = copy(c.firstHeader);
  if (c.firstFooter) out.firstFooter = copy(c.firstFooter);
  if (fp === 'own') { out.firstHeader = out.firstHeader || copy(out.header); out.firstFooter = out.firstFooter || copy(out.footer); }
  return out;
}

/** Logos DÉJÀ choisis dans une mise en page (1re page puis suivantes), sans doublon, dans l'ordre. */
export function logosOf(layout) {
  const l = layout || {};
  const ids = [];
  for (const b of [l.firstHeader, l.header, l.firstFooter, l.footer]) {
    for (const e of (b && b.elements) || []) if (e.kind === 'image' && e.assetId && !ids.includes(e.assetId)) ids.push(e.assetId);
  }
  return ids;
}

/**
 * Modèle appliqué à la PAIRE (1re page + pages suivantes) : textes traduits ; les emplacements de
 * logo prennent les logos que l'utilisateur a DÉJÀ placés (`logo1`, `logo2`) — jamais une image
 * prise au hasard dans le compte : sans logo choisi, l'emplacement reste un cadre neutre à remplir.
 * @returns {{ header, footer, firstPage, firstHeader?, firstFooter? }|null}
 */
export function applyTemplate(key, { logo1 = null, logo2 = null, tr = (x) => x } = {}) {
  const t = BAND_TEMPLATES.find((x) => x.key === key);
  if (!t) return null;
  const built = pairOf(t.build({ logo1, logo2: logo2 && logo2 !== logo1 ? logo2 : null }));
  const out = { ...built, header: localizeBand(built.header, tr), footer: localizeBand(built.footer, tr) };
  if (built.firstHeader) out.firstHeader = localizeBand(built.firstHeader, tr);
  if (built.firstFooter) out.firstFooter = localizeBand(built.firstFooter, tr);
  return out;
}
