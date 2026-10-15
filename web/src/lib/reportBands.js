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
    case 'band': return make({ id, kind: 'rect', x: 0, y: 0, w: 100, h: Math.min(12, bandH), fill: '#0b5394', radius: 0, opacity: 1, bleed: true });
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
const INK = '#14181f'; const MUTED = '#616a7a'; const RULE = '#e7e9ef'; const RULE2 = '#ccd2dc';
const BLUE = '#0f6cbd'; const BLUE_DK = '#0b5394'; const BLUE_50 = '#eff6fc';

/**
 * Modèles d'en-tête et de pied prédéfinis — sobres, professionnels, aux jetons du système. Les
 * emplacements de logo prennent le(s) logo(s) du compte s'il y en a (sinon : cadre « Logo » à
 * remplir). Textes en français : traduits à l'application (localizeBand).
 * build({ logo1, logo2 }) → { header, footer }.
 */
export const BAND_TEMPLATES = [
  {
    key: 'minimal', name: 'Minimal — ligne fine', description: 'Titre et période sur une ligne, filet gris ; pied discret paginé.',
    build: () => ({
      header: { height: 12, elements: [
        text('h-title', '{titre}', B(0, 2, 62, 6), { size: 8.5, bold: true, color: INK }),
        text('h-period', '{periode}', B(62, 2, 38, 6), { size: 8, align: 'right' }),
        line('h-rule', B(0, 10, 100, 2), 0.5, RULE2),
      ] },
      footer: { height: 10, elements: [
        line('f-rule', B(0, 0, 100, 2), 0.5, RULE),
        text('f-text', 'Suivi & évaluation · {bureau}', B(0, 3, 70, 6), { size: 7.5 }),
        pageNo('f-page', 'Page n / N', B(70, 3, 30, 6), { size: 7.5, align: 'right' }),
      ] },
    }),
  },
  {
    key: 'institutional', name: 'Institutionnel — bandeau', description: 'Bandeau bleu foncé bord à bord avec le titre et la période ; bureau en petites capitales.',
    build: () => ({
      header: { height: 20, elements: [
        rect('h-band', B(0, 0, 100, 13), BLUE_DK, { bleed: true }),
        text('h-title', '{titre}', B(0, 3.5, 72, 7), { size: 11, bold: true, color: '#ffffff' }),
        text('h-period', '{periode}', B(72, 3.5, 28, 7), { size: 8.5, color: '#dbe9f7', align: 'right' }),
        text('h-office', '{bureau}', B(0, 15, 70, 4.5), { size: 6.5, bold: true, caps: true, color: BLUE }),
      ] },
      footer: { height: 12, elements: [
        line('f-rule', B(0, 0, 100, 2), 1, BLUE_DK),
        text('f-text', '{titre} — {periode}', B(0, 4, 75, 6), { size: 7.5 }),
        pageNo('f-page', 'n / N', B(80, 4, 20, 6), { size: 7.5, bold: true, color: INK, align: 'right' }),
      ] },
    }),
  },
  {
    key: 'logo-left', name: 'Logo à gauche + titre', description: 'Logo, titre et sous-titre (période, bureau), filet bleu ; date d\'édition au pied.',
    build: ({ logo1 } = {}) => ({
      header: { height: 20, elements: [
        image('h-logo', B(0, 1.5, 17, 14), logo1, 'left'),
        text('h-title', '{titre}', B(19.5, 2.5, 80.5, 7), { size: 11, bold: true, color: INK }),
        text('h-sub', '{periode} · {bureau}', B(19.5, 9.5, 80.5, 5), { size: 8 }),
        line('h-rule', B(0, 18, 100, 2), 0.75, BLUE),
      ] },
      footer: { height: 10, elements: [
        text('f-date', 'Édité le {date}', B(0, 3, 50, 6), { size: 7.5 }),
        pageNo('f-page', 'Page n / N', B(50, 3, 50, 6), { size: 7.5, align: 'right' }),
      ] },
    }),
  },
  {
    key: 'two-logos', name: 'Deux logos', description: 'Logo de l\'organisation à gauche, du partenaire à droite, titre centré.',
    build: ({ logo1, logo2 } = {}) => ({
      header: { height: 20, elements: [
        image('h-logo', B(0, 1.5, 18, 14), logo1, 'left'),
        image('h-logo2', B(82, 1.5, 18, 14), logo2, 'right'),
        text('h-title', '{titre}', B(20, 3, 60, 7), { size: 10.5, bold: true, color: INK, align: 'center' }),
        text('h-period', '{periode}', B(20, 10, 60, 5), { size: 8, align: 'center' }),
        line('h-rule', B(0, 18, 100, 2), 0.5, RULE2),
      ] },
      footer: { height: 10, elements: [
        line('f-rule', B(0, 0, 100, 2), 0.5, RULE),
        text('f-text', '{bureau}', B(0, 3, 50, 6), { size: 7.5 }),
        pageNo('f-page', 'Page n / N', B(50, 3, 50, 6), { size: 7.5, align: 'right' }),
      ] },
    }),
  },
  {
    key: 'band-period', name: 'Bandeau couleur + période', description: 'Bandeau bleu très clair avec un filet d\'accent, période en pastille ; pagination en pastille.',
    build: () => ({
      header: { height: 16, elements: [
        rect('h-band', B(0, 0, 100, 12), BLUE_50),
        rect('h-accent', B(0, 0, 1.2, 12), BLUE),
        text('h-title', '{titre}', B(3, 3, 64, 6), { size: 10, bold: true, color: INK }),
        text('h-period', '{periode}', B(71, 3, 27, 6), { size: 8, bold: true, color: '#ffffff', align: 'center', background: BLUE, radius: 3 }),
      ] },
      footer: { height: 10, elements: [
        text('f-text', 'Suivi & évaluation', B(0, 3, 60, 6), { size: 7.5 }),
        pageNo('f-page', 'n / N', B(86, 2.5, 14, 6), { size: 7.5, bold: true, color: BLUE_DK, align: 'center', background: BLUE_50, radius: 3 }),
      ] },
    }),
  },
  {
    key: 'official', name: 'Rapport officiel avec cartouche', description: 'Cartouche encadré : logo, « RAPPORT OFFICIEL », titre et période, date d\'édition, bureau et page.',
    build: ({ logo1 } = {}) => ({
      header: { height: 26, elements: [
        rect('h-frame', B(0, 0, 100, 22), '#ffffff', { border: RULE2 }),
        image('h-logo', B(1.5, 2, 20, 18), logo1, 'center'),
        line('h-sep1', B(23, 2, 1, 18), 0.5, RULE2, 'v'),
        text('h-kicker', 'Rapport officiel', B(25, 3, 50, 4), { size: 6.5, bold: true, caps: true, color: BLUE }),
        text('h-title', '{titre}', B(25, 8, 50, 7), { size: 10.5, bold: true, color: INK }),
        text('h-period', '{periode}', B(25, 15, 50, 5), { size: 8 }),
        line('h-sep2', B(76, 2, 1, 18), 0.5, RULE2, 'v'),
        text('h-date', 'Édité le {date}', B(78, 3.5, 21, 5), { size: 7 }),
        text('h-office', '{bureau}', B(78, 9, 21, 5), { size: 7 }),
        pageNo('h-page', 'Page n / N', B(78, 14.5, 21, 5), { size: 7, bold: true, color: INK }),
      ] },
      footer: { height: 10, elements: [
        line('f-rule', B(0, 0, 100, 2), 0.5, RULE2),
        text('f-text', 'Document à usage interne — ne pas diffuser sans validation', B(0, 3, 75, 6), { size: 7, italic: true }),
        pageNo('f-page', 'Page n / N', B(75, 3, 25, 6), { size: 7, align: 'right' }),
      ] },
    }),
  },
  {
    key: 'centered', name: 'Sobre centré', description: 'Titre et période centrés, court filet bleu ; numéro de page centré.',
    build: () => ({
      header: { height: 14, elements: [
        text('h-title', '{titre}', B(10, 1, 80, 5.5), { size: 8.5, bold: true, color: INK, align: 'center' }),
        text('h-period', '{periode}', B(10, 6.5, 80, 4.5), { size: 7.5, align: 'center' }),
        line('h-rule', B(45, 12, 10, 2), 1, BLUE),
      ] },
      footer: { height: 10, elements: [
        pageNo('f-page', 'n', B(40, 3, 20, 6), { size: 8, align: 'center' }),
      ] },
    }),
  },
  {
    key: 'footer-only', name: 'Pied seul', description: 'Aucun en-tête (pages pleines) ; pied avec le titre et la pagination.',
    build: () => ({
      header: { height: 0, elements: [] },
      footer: { height: 10, elements: [
        line('f-rule', B(0, 0, 100, 2), 0.5, RULE),
        text('f-text', '{titre} — {periode}', B(0, 3, 70, 6), { size: 7.5 }),
        pageNo('f-page', 'Page n / N', B(70, 3, 30, 6), { size: 7.5, align: 'right' }),
      ] },
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

/** Modèle appliqué : en-tête et pied construits avec les logos du compte, textes traduits. */
export function applyTemplate(key, { logo1 = null, logo2 = null, tr = (x) => x } = {}) {
  const t = BAND_TEMPLATES.find((x) => x.key === key);
  if (!t) return null;
  // Un seul logo dans le compte : le 2ᵉ emplacement reste à remplir (jamais deux fois le même logo).
  const { header, footer } = t.build({ logo1, logo2 });
  return { header: localizeBand(header, tr), footer: localizeBand(footer, tr) };
}
