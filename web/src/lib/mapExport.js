/**
 * Export de la carte du suivi (lot 6a) — image PNG et impression A4 paysage.
 * buildExportSvg est PUR (testé par server/test/webMap.test.js) : une chaîne SVG
 * autonome 1 600 × 1 100 (titre, période et filtres en clair, carte, légende graduée,
 * flèche du nord, barre d'échelle, carte de situation, pied de page) — textes
 * échappés, couleurs littérales (une image ne voit pas les variables CSS), aucune URL
 * externe, aucune tuile ; les points de collecte n'y figurent qu'en maille de 2 km.
 * Le lot 7a réutilise buildExportSvg pour son bloc « carte ».
 */
import { fitTransform, pathOf, scaleBar, unionBbox } from './mapProjection.js';
import { layoutLabels } from './mapLabels.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Couleurs littérales de l'export (thème clair, impression). */
export const EXPORT_COLORS = {
  bg: '#eef2f7', empty: '#dfe4eb', line: '#ffffff', region: '#6b7586', ink: '#14181f', muted: '#616a7a',
  halo: '#ffffff', hatchA: '#b9c1cc', hatchB: '#eef0f4', done: '#0f7b40', plan: '#c77700', collect: '#6250d6', frame: '#ccd2dc',
};

/** Symbole d'un site (forme + couleur, comme à l'écran). */
function siteSymbol(x, y, status, C) {
  const r = 5;
  const f = (n) => n.toFixed(1);
  if (status === 'realise') return `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${C.done}" stroke="${C.halo}" stroke-width="1.5"/>`;
  if (status === 'hors_plan') return `<path d="M${f(x)},${f(y - r - 1)}L${f(x + r + 1)},${f(y)}L${f(x)},${f(y + r + 1)}L${f(x - r - 1)},${f(y)}Z" fill="${C.done}" stroke="${C.halo}" stroke-width="1.3"/>`;
  if (status === 'prevu') return `<circle cx="${f(x)}" cy="${f(y)}" r="${r - 0.6}" fill="${C.halo}" stroke="${C.plan}" stroke-width="2.4"/>`;
  if (status === 'inactif') return `<circle cx="${f(x)}" cy="${f(y)}" r="${r - 0.8}" fill="none" stroke="${C.muted}" stroke-width="1.6"/>`;
  return `<rect x="${f(x - r + 0.6)}" y="${f(y - r + 0.6)}" width="${f(2 * r - 1.2)}" height="${f(2 * r - 1.2)}" fill="${C.ink}" stroke="${C.halo}" stroke-width="1.3"/>`;
}

/**
 * @param {{
 *   title:string, subtitle:string, footer:string, legendTitle:string,
 *   features:{properties:{key,name,label,bbox,area},geometry:object}[],
 *   fills: Record<string, string|'hatch'|null>, regions?: Record<string,string>,
 *   frame?: number[], withData?: string[],
 *   legend: {color:string,label:string}[], extras?: {kind:'empty'|'hatch'|'site'|'commune'|'collect', label:string, status?:string}[],
 *   points?: { sites?: {lng,lat,status}[], communes?: {lng,lat,n}[], bins?: {lng,lat,n}[] },
 *   northLabel?:string, locatorLabel?:string, fontCss?:string, width?:number, height?:number,
 * }} m
 * @returns {string} SVG autonome
 */
export function buildExportSvg(m) {
  const W = m.width || 1600; const H = m.height || 1100;
  const C = { ...EXPORT_COLORS, ...(m.colors || {}) };
  const font = "Inter, 'Segoe UI', Arial, sans-serif";
  const mapBox = { x: 40, y: 120, w: 1120, h: 880 };
  const features = m.features || [];
  const frame = m.frame || unionBbox(features.filter((f) => (m.withData || []).includes(f.properties.key)).map((f) => f.properties.bbox))
    || unionBbox(features.map((f) => f.properties.bbox));
  const t = fitTransform(frame, mapBox.w, mapBox.h, { top: 20, right: 20, bottom: 20, left: 20 });
  const proj = (lng, lat) => { const [x, y] = t.project(lng, lat); return [x + mapBox.x, y + mapBox.y]; };
  const out = [];
  out.push(`<svg xmlns="${SVG_NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(font)}">`);
  out.push('<defs>');
  if (m.fontCss) out.push(`<style>${m.fontCss}</style>`);
  out.push(`<pattern id="x-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${C.hatchB}"/><line x1="0" y1="0" x2="0" y2="7" stroke="${C.hatchA}" stroke-width="2.4"/></pattern>`);
  out.push(`<clipPath id="x-clip"><rect x="${mapBox.x}" y="${mapBox.y}" width="${mapBox.w}" height="${mapBox.h}"/></clipPath>`);
  out.push('</defs>');
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // En-tête : titre, période et filtres en clair.
  out.push(`<text x="40" y="58" font-size="30" font-weight="700" fill="${C.ink}">${esc(m.title)}</text>`);
  out.push(`<text x="40" y="92" font-size="17" fill="${C.muted}">${esc(m.subtitle)}</text>`);
  // Carte : régions (trait épais puis remplissage) et contours.
  out.push(`<rect x="${mapBox.x}" y="${mapBox.y}" width="${mapBox.w}" height="${mapBox.h}" fill="${C.bg}" stroke="${C.frame}"/>`);
  out.push('<g clip-path="url(#x-clip)">');
  const byRegion = new Map();
  for (const f of features) {
    const r = (m.regions || {})[f.properties.key] || '';
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r).push(f);
  }
  for (const [region, list] of byRegion) {
    const paths = list.map((f) => [f, pathOf(f.geometry, proj)]);
    if (region) for (const [, d] of paths) out.push(`<path d="${d}" fill="none" stroke="${C.region}" stroke-width="3" stroke-linejoin="round"/>`);
    for (const [f, d] of paths) {
      const fill = m.fills[f.properties.key];
      out.push(`<path d="${d}" fill="${fill === 'hatch' ? 'url(#x-hatch)' : esc(fill || C.empty)}" stroke="${C.line}" stroke-width="0.9" stroke-linejoin="round"/>`);
    }
  }
  const pts = m.points || {};
  const maxBin = Math.max(1, ...(pts.bins || []).map((b) => b.n));
  for (const b of pts.bins || []) { const [x, y] = proj(b.lng, b.lat); out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.6 + 4.5 * Math.sqrt(b.n / maxBin)).toFixed(1)}" fill="${C.collect}" fill-opacity=".55" stroke="${C.halo}" stroke-width=".6"/>`); }
  for (const c of pts.communes || []) {
    const [x, y] = proj(c.lng, c.lat); const r = Math.min(14, 5.5 + Math.sqrt(c.n || 1) * 1.5);
    out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${C.halo}" fill-opacity=".85" stroke="${C.ink}" stroke-width="1.2" stroke-dasharray="2.5 2"/>`);
  }
  for (const s of pts.sites || []) { const [x, y] = proj(s.lng, s.lat); out.push(siteSymbol(x, y, s.status, C)); }
  // Étiquettes sans chevauchement (priorité aux contours avec données, puis aux grandes aires).
  const items = features.filter((f) => (m.withData || []).includes(f.properties.key)).map((f) => {
    const [x, y] = proj(f.properties.label[0], f.properties.label[1]);
    return { key: f.properties.key, x, y, text: f.properties.name, priority: f.properties.area };
  });
  for (const l of layoutLabels(items, { size: 13, bounds: { width: mapBox.x + mapBox.w, height: mapBox.y + mapBox.h } })) {
    out.push(`<text x="${l.x.toFixed(1)}" y="${(l.y + 4.5).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="600" fill="${C.ink}" stroke="${C.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(l.text)}</text>`);
  }
  out.push('</g>');
  // Nord et échelle (calculée à la latitude du centre du cadre).
  const nx = mapBox.x + mapBox.w - 50; const ny = mapBox.y + mapBox.h - 110;
  out.push(`<g transform="translate(${nx},${ny})"><path d="M0,-24 L9,8 L0,1 L-9,8Z" fill="${C.ink}"/><text y="28" text-anchor="middle" font-size="16" font-weight="700" fill="${C.ink}">${esc(m.northLabel || 'N')}</text></g>`);
  const sb = scaleBar(t, (frame[1] + frame[3]) / 2, { minPx: 110 });
  const sx = mapBox.x + mapBox.w - 30 - sb.px; const sy = mapBox.y + mapBox.h - 34;
  out.push(`<g transform="translate(${sx.toFixed(1)},${sy})"><rect width="${(sb.px / 2).toFixed(1)}" height="7" fill="${C.ink}"/><rect x="${(sb.px / 2).toFixed(1)}" width="${(sb.px / 2).toFixed(1)}" height="7" fill="#ffffff" stroke="${C.ink}"/><text y="-7" font-size="13" fill="${C.muted}">0</text><text x="${sb.px.toFixed(1)}" y="-7" text-anchor="end" font-size="13" fill="${C.muted}">${sb.km} km</text></g>`);
  // Colonne de droite : légende graduée puis carte de situation.
  const lx = 1200; let ly = 140;
  out.push(`<text x="${lx}" y="${ly}" font-size="17" font-weight="700" fill="${C.ink}">${esc(m.legendTitle)}</text>`);
  ly += 18;
  const step = 360 / Math.max(1, (m.legend || []).length);
  (m.legend || []).forEach((it, i) => {
    out.push(`<rect x="${lx + i * step}" y="${ly}" width="${(step - 3).toFixed(1)}" height="16" rx="2" fill="${esc(it.color)}"/>`);
    out.push(`<text x="${lx + i * step}" y="${ly + 36}" font-size="13" fill="${C.muted}">${esc(it.label)}</text>`);
  });
  ly += 70;
  for (const e of m.extras || []) {
    let sw;
    if (e.kind === 'hatch') sw = `<rect x="${lx}" y="${ly - 12}" width="16" height="16" fill="url(#x-hatch)" stroke="${C.frame}"/>`;
    else if (e.kind === 'site') sw = siteSymbol(lx + 8, ly - 4, e.status, C);
    else if (e.kind === 'commune') sw = `<circle cx="${lx + 8}" cy="${ly - 4}" r="7" fill="none" stroke="${C.ink}" stroke-width="1.2" stroke-dasharray="2.5 2"/>`;
    else if (e.kind === 'collect') sw = `<circle cx="${lx + 8}" cy="${ly - 4}" r="5" fill="${C.collect}" fill-opacity=".55"/>`;
    else sw = `<rect x="${lx}" y="${ly - 12}" width="16" height="16" fill="${C.empty}" stroke="${C.frame}"/>`;
    out.push(`${sw}<text x="${lx + 26}" y="${ly + 1}" font-size="14" fill="${C.ink}">${esc(e.label)}</text>`);
    ly += 26;
  }
  // Carte de situation : tout le pays, rectangle du cadre exporté.
  const all = unionBbox(features.map((f) => f.properties.bbox));
  if (all) {
    const box = { x: lx, y: Math.max(ly + 20, 640), w: 220, h: 330 };
    const lt = fitTransform(all, box.w, box.h, { top: 8, right: 8, bottom: 8, left: 8 });
    const lp = (lng, lat) => { const [x, y] = lt.project(lng, lat); return [x + box.x, y + box.y]; };
    out.push(`<g id="x-locator"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#ffffff" stroke="${C.frame}"/>`);
    for (const f of features) out.push(`<path d="${pathOf(f.geometry, lp)}" fill="${C.empty}" stroke="none"/>`);
    const [a, b] = lp(frame[0], frame[3]); const [c, d] = lp(frame[2], frame[1]);
    out.push(`<rect x="${a.toFixed(1)}" y="${b.toFixed(1)}" width="${(c - a).toFixed(1)}" height="${(d - b).toFixed(1)}" fill="none" stroke="#0f6cbd" stroke-width="2.5"/>`);
    out.push(`<text x="${box.x}" y="${box.y + box.h + 22}" font-size="13" fill="${C.muted}">${esc(m.locatorLabel || '')}</text></g>`);
  }
  // Pied de page : source, date, application (jamais d'autre marque).
  out.push(`<text x="40" y="${H - 52}" font-size="13" fill="${C.muted}">${esc(m.footer)}</text>`);
  out.push(`<text x="40" y="${H - 28}" font-size="13" font-weight="600" fill="${C.ink}">MEMS 2.0 · Suivi &amp; évaluation</text>`);
  out.push('</svg>');
  return out.join('');
}

/** Image PNG (canvas, aucune dépendance) : `scale` 2 → 3 200 × 2 200 px pour 1 600 × 1 100. */
export function downloadPng(svg, fileName, { scale = 2, width = 1600, height = 1100 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale; canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Image vide')); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = fileName;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        resolve({ width: canvas.width, height: canvas.height, bytes: blob.size });
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rendu de l\'image impossible')); };
    img.src = url;
  });
}

/**
 * Impression A4 paysage : le même SVG dans un conteneur réservé à l'impression
 * (le reste de l'application est masqué par @media print), puis window.print().
 * Le SVG est importé par DOMParser (jamais innerHTML).
 */
export function printSvg(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const node = document.importNode(doc.documentElement, true);
  node.setAttribute('width', '100%'); node.removeAttribute('height');
  const host = document.createElement('div');
  host.className = 'mapx-print-root';
  host.appendChild(node);
  document.body.appendChild(host);
  document.body.classList.add('is-printing-map');
  const done = () => { document.body.classList.remove('is-printing-map'); host.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
}

/** @font-face Inter en base64 (le SVG exporté reste autonome) ; repli sans-serif si indisponible. */
export async function interFontCss(urls) {
  const parts = [];
  for (const [weight, url] of urls) {
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      parts.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}`);
    } catch { /* repli sans-serif */ }
  }
  return parts.join('');
}
