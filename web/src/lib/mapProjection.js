/**
 * Projection de la carte du suivi (lot 6a) — module PUR, testé par
 * server/test/webMap.test.js. Web Mercator (la même que les tuiles XYZ, pour un
 * fond en ligne optionnel aligné), cadrage d'une emprise dans une fenêtre, chemins
 * SVG, barre d'échelle à la latitude du centre.
 */

const R = 6378137; // rayon de la sphère Web Mercator (m)
const D2R = Math.PI / 180;

/** [lng, lat] (degrés) → [x, y] Web Mercator normalisés (radians ; y vers le nord). */
export function mercator([lng, lat]) {
  const phi = Math.max(-85.0511, Math.min(85.0511, lat)) * D2R;
  return [lng * D2R, Math.log(Math.tan(Math.PI / 4 + phi / 2))];
}

/** Inverse de mercator : [x, y] → [lng, lat]. */
export function unmercator([x, y]) {
  return [x / D2R, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R];
}

/** Anneaux extérieurs et trous d'une géométrie (Polygon / MultiPolygon). */
export const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/** bbox [ouest, sud, est, nord] (degrés) d'une liste de bbox. */
export function unionBbox(list) {
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of list) {
    if (!b) continue;
    bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]);
  }
  return Number.isFinite(bb[0]) ? bb : null;
}

/**
 * Cadrage : emprise (degrés) → fenêtre width × height (px) avec marges.
 * @param {number[]} bbox [ouest, sud, est, nord]
 * @param {number} width
 * @param {number} height
 * @param {{top?:number,right?:number,bottom?:number,left?:number}} [pad]
 * @returns {{ k:number, x0:number, y1:number, ox:number, oy:number, project:(lng:number,lat:number)=>number[], invert:(px:number,py:number)=>number[] }}
 */
export function fitTransform(bbox, width, height, pad = {}) {
  const p = { top: 16, right: 16, bottom: 16, left: 16, ...pad };
  const [x0, y0] = mercator([bbox[0], bbox[1]]);
  const [x1, y1] = mercator([bbox[2], bbox[3]]);
  const w = Math.max(1, width - p.left - p.right);
  const h = Math.max(1, height - p.top - p.bottom);
  const k = Math.min(w / Math.max(1e-9, x1 - x0), h / Math.max(1e-9, y1 - y0));
  const ox = p.left + (w - (x1 - x0) * k) / 2;
  const oy = p.top + (h - (y1 - y0) * k) / 2;
  const project = (lng, lat) => { const [x, y] = mercator([lng, lat]); return [ox + (x - x0) * k, oy + (y1 - y) * k]; };
  // Paramètres exposés : pathOf calcule les chemins sans allouer un tableau par sommet.
  project.params = { k, x0, y1, ox, oy };
  const invert = (px, py) => unmercator([x0 + (px - ox) / k, y1 - (py - oy) / k]);
  return { k, x0, y1, ox, oy, project, invert };
}

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Chemin SVG d'une géométrie (coordonnées à 1 décimale, une sous-forme par anneau).
 * Projection de fitTransform : calcul en ligne (premier rendu ≈ 30 000 sommets) ;
 * toute autre fonction project(lng, lat) → [x, y] reste acceptée.
 */
export function pathOf(geometry, project) {
  const q = project.params;
  const parts = [];
  for (const poly of polygonsOf(geometry)) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 1) {
        let x; let y;
        if (q) {
          const phi = Math.max(-85.0511, Math.min(85.0511, ring[i][1])) * D2R;
          x = q.ox + (ring[i][0] * D2R - q.x0) * q.k;
          y = q.oy + (q.y1 - Math.log(Math.tan(Math.PI / 4 + phi / 2))) * q.k;
        } else {
          [x, y] = project(ring[i][0], ring[i][1]);
        }
        parts.push(`${i ? 'L' : 'M'}${r1(x)},${r1(y)}`);
      }
      parts.push('Z');
    }
  }
  return parts.join('');
}

/**
 * Barre d'échelle : longueur ronde (km) d'au moins `minPx` pixels à la latitude
 * donnée, pour un facteur de zoom `zoom` appliqué au cadrage `t`.
 * @returns {{ km:number, px:number }}
 */
export function scaleBar(t, lat, { zoom = 1, minPx = 70 } = {}) {
  // 1 radian de longitude Mercator = R · cos(lat) mètres au sol à cette latitude.
  const kmPerPx = (R * Math.cos(lat * D2R)) / 1000 / (t.k * zoom);
  const km = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((v) => v / kmPerPx >= minPx) || 1000;
  return { km, px: km / kmPerPx };
}

/** Distance (km) au sol entre deux points (grand cercle) — échelle de l'export, repères. */
export function haversineKm([lng1, lat1], [lng2, lat2]) {
  const dLat = (lat2 - lat1) * D2R; const dLng = (lng2 - lng1) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Tuiles XYZ (Web Mercator) qui couvrent une emprise affichée, au niveau de zoom dont
 * les tuiles font environ 256 px à l'écran (borné 1–17). Aucune tuile sans URL.
 * @param {{ bbox:number[], widthPx:number }} view emprise visible (degrés) et largeur (px)
 * @param {string} url modèle « …/{z}/{x}/{y}.png » ; vide = aucun fond
 * @returns {{ z:number, x:number, y:number, url:string, bbox:number[] }[]}
 */
export function tilesFor({ bbox, widthPx }, url, { maxTiles = 64 } = {}) {
  if (!url || !bbox || !(widthPx > 0)) return [];
  const lngSpan = Math.max(1e-6, bbox[2] - bbox[0]);
  const z = Math.max(1, Math.min(17, Math.round(Math.log2((360 * widthPx) / (256 * lngSpan)))));
  const n = 2 ** z;
  const tx = (lng) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat) => {
    const r = Math.max(-85.0511, Math.min(85.0511, lat)) * D2R;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const lngOf = (x) => (x / n) * 360 - 180;
  const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / D2R;
  const xa = Math.max(0, tx(bbox[0])); const xb = Math.min(n - 1, tx(bbox[2]));
  const ya = Math.max(0, ty(bbox[3])); const yb = Math.min(n - 1, ty(bbox[1]));
  const out = [];
  for (let y = ya; y <= yb; y += 1) {
    for (let x = xa; x <= xb; x += 1) {
      out.push({ z, x, y, url: url.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'abc'[(x + y) % 3]),
        bbox: [lngOf(x), latOf(y + 1), lngOf(x + 1), latOf(y)] });
      if (out.length >= maxTiles) return out;
    }
  }
  return out;
}
