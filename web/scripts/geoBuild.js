/**
 * Construction des contours de la carte (lot 6a) — fonctions PURES, sans I/O,
 * testées par server/test/geoBuild.test.js. Le script `build-geo.mjs` les applique
 * au fichier source geoBoundaries et écrit :
 *   - web/public/geo/<jeu>.json : contours allégés servis à l'écran (hors ligne) ;
 *   - server/src/modules/map/shapes/<jeu>.json : index des formes (clé, nom, bbox,
 *     point d'étiquette) lu par le serveur pour rapprocher districts et contours.
 *
 * Simplification « à frontières partagées » : un sommet de jonction (où l'ensemble
 * des contours propriétaires change, ou partagé par 3 contours ou plus) ne bouge
 * jamais ; chaque arc entre deux jonctions est simplifié par Douglas-Peucker dans
 * un SENS CANONIQUE (indépendant du sens de parcours), si bien que deux voisins
 * gardent exactement la même frontière — aucun trou ni chevauchement à l'écran.
 */

/** Clé de rapprochement d'un nom : sans accents, minuscules, apostrophes retirées,
 *  tout autre signe → espace (« Anosibe-An'ala » → « anosibe anala »). Copie exacte
 *  dans server/src/modules/map/geoMatch.js (égalité vérifiée par les tests). */
export function normKey(name) {
  return String(name == null ? '' : name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Arrondi à `d` décimales (4 par défaut ≈ 11 m), sans « -0 ». */
export function roundTo(v, d = 4) {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Polygones d'une géométrie (Polygon → [coords], MultiPolygon → coords). */
export const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

const K = (p) => `${p[0]},${p[1]}`;

/** Anneau arrondi, sans sommets consécutifs en double, fermé. */
export function cleanRing(ring, d = 4) {
  const out = [];
  for (const p of ring) {
    const q = [roundTo(p[0], d), roundTo(p[1], d)];
    if (!out.length || K(out[out.length - 1]) !== K(q)) out.push(q);
  }
  if (out.length && K(out[0]) !== K(out[out.length - 1])) out.push(out[0]);
  return out;
}

/** Sommet → ensemble des contours (indices) qui le portent. */
export function vertexOwners(features) {
  const owners = new Map();
  features.forEach((f, i) => {
    for (const poly of polygonsOf(f.geometry)) for (const ring of poly) for (const pt of ring) {
      const k = K(pt);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k).add(i);
    }
  });
  return owners;
}

/** Douglas-Peucker itératif (distance au segment), extrémités conservées. */
export function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const [x1, y1] = pts[a]; const [x2, y2] = pts[b];
    const dx = x2 - x1; const dy = y2 - y1; const L = dx * dx + dy * dy;
    let md = -1; let mi = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [x, y] = pts[i];
      let d;
      if (L === 0) d = Math.hypot(x - x1, y - y1);
      else {
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L));
        d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      }
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const cmpKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Douglas-Peucker dans un sens canonique : même résultat quel que soit le sens de parcours de l'arc. */
export function canonicalSimplify(arc, tol) {
  const a = K(arc[0]); const b = K(arc[arc.length - 1]);
  const rev = cmpKey(a, b) > 0 || (a === b && arc.length > 2 && cmpKey(K(arc[1]), K(arc[arc.length - 2])) > 0);
  const s = rev ? arc.slice().reverse() : arc;
  const out = douglasPeucker(s, tol);
  return rev ? out.reverse() : out;
}

/**
 * Simplifie un anneau fermé en gardant fixes ses sommets de jonction.
 * Sans jonction (île, enclave entière), l'anneau part de son plus petit sommet
 * (ordre des clés) : la même enclave est simplifiée à l'identique chez ses deux voisins.
 */
export function simplifyRing(ring, tol, owners) {
  const n = ring.length - 1; // dernier = premier
  if (n < 4) return ring;
  const sig = (k) => [...owners.get(k)].sort((x, y) => x - y).join('|');
  const isJunction = (i) => {
    const k = K(ring[i]);
    if (owners.get(k).size >= 3) return true;
    const s = sig(k);
    return s !== sig(K(ring[(i - 1 + n) % n])) || s !== sig(K(ring[(i + 1) % n]));
  };
  let J = [];
  for (let i = 0; i < n; i += 1) if (isJunction(i)) J.push(i);
  if (!J.length) {
    let start = 0;
    for (let i = 1; i < n; i += 1) if (cmpKey(K(ring[i]), K(ring[start])) < 0) start = i;
    J = [start];
  }
  const out = [];
  for (let j = 0; j < J.length; j += 1) {
    const a = J[j]; const b = J[(j + 1) % J.length];
    const arc = [ring[a]];
    let i = a;
    do { i = (i + 1) % n; arc.push(ring[i]); } while (i !== b);
    out.push(...canonicalSimplify(arc, tol).slice(0, -1));
  }
  out.push(out[0]);
  return out.length >= 4 ? out : ring;
}

/** Aire (degrés²) d'un anneau, formule du lacet, valeur absolue. */
export function ringArea(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return Math.abs(s / 2);
}

/** Point dans un anneau (parité des croisements). */
export function inRing(x, y, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i, i += 1) {
    const [xi, yi] = r[i]; const [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Point dans un polygone (anneau extérieur, hors des trous). */
export const inPolygon = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));

function segDist(x, y, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/**
 * Pôle d'inaccessibilité approché (point intérieur le plus éloigné des bords) :
 * grille 13 × 13 raffinée 7 fois autour du meilleur point. Déterministe, toujours
 * DANS le polygone (point d'étiquette lisible même pour un district en U).
 */
export function poleOfInaccessibility(poly) {
  const r = poly[0];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const dist = (x, y) => {
    if (!inPolygon(x, y, poly)) return -1;
    let m = Infinity;
    for (const ring of poly) for (let i = 1; i < ring.length; i += 1) m = Math.min(m, segDist(x, y, ring[i - 1], ring[i]));
    return m;
  };
  let best = null; let bd = -1;
  let cx = (x0 + x1) / 2; let cy = (y0 + y1) / 2; let w = x1 - x0; let h = y1 - y0;
  for (let it = 0; it < 7; it += 1) {
    for (let i = 0; i <= 12; i += 1) {
      for (let j = 0; j <= 12; j += 1) {
        const x = cx - w / 2 + (w * i) / 12; const y = cy - h / 2 + (h * j) / 12;
        const d = dist(x, y);
        if (d > bd) { bd = d; best = [x, y]; }
      }
    }
    if (!best) break;
    [cx, cy] = best; w /= 3; h /= 3;
  }
  if (!best) { // anneau dégénéré : premier sommet
    best = r[0];
  }
  return best;
}

/** bbox [ouest, sud, est, nord] des anneaux extérieurs. */
export function bboxOf(polys) {
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys) for (const [x, y] of p[0]) {
    bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y);
  }
  return bb;
}

/**
 * Contours allégés + index serveur, à partir d'une FeatureCollection source
 * (propriété `name`). Sortie déterministe (mêmes octets à chaque exécution).
 * @param {{features: any[]}} src
 * @param {{ tol?: number, shapeSet?: string, source?: string, license?: string }} [opts]
 * @returns {{ web: object, index: object, stats: object }}
 */
export function buildShapes(src, { tol = 0.005, shapeSet = 'mdg-adm2.v1', source = 'geoBoundaries', license = null } = {}) {
  const cleaned = src.features.map((f) => ({
    name: String(f.properties?.name ?? f.properties?.shapeName ?? '').trim(),
    geometry: {
      type: f.geometry.type,
      coordinates: f.geometry.type === 'Polygon'
        ? f.geometry.coordinates.map((r) => cleanRing(r))
        : f.geometry.coordinates.map((p) => p.map((r) => cleanRing(r))),
    },
  }));
  const owners = vertexOwners(cleaned);
  let vertices = 0; let sharedIn = 0;
  for (const s of owners.values()) if (s.size > 1) sharedIn += 1;
  const features = cleaned.map((f) => {
    const polys = polygonsOf(f.geometry).map((p) => p.map((r) => {
      const s = simplifyRing(r, tol, owners);
      vertices += s.length;
      return s;
    }));
    const main = polys.reduce((a, p) => (ringArea(p[0]) > ringArea(a[0]) ? p : a), polys[0]);
    const label = poleOfInaccessibility(main).map((v) => roundTo(v, 4));
    const bbox = bboxOf(polys).map((v) => roundTo(v, 4));
    const area = roundTo(polys.reduce((a, p) => a + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0), 5);
    return {
      type: 'Feature',
      properties: { key: normKey(f.name), name: f.name, label, bbox, area },
      geometry: f.geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
    };
  });
  const meta = { shapeSet, source, ...(license ? { license } : {}), simplify: tol };
  const web = { type: 'FeatureCollection', ...meta, features };
  const index = {
    ...meta,
    shapes: features.map((f) => ({ key: f.properties.key, name: f.properties.name, bbox: f.properties.bbox, label: f.properties.label })),
  };
  return { web, index, stats: { features: features.length, vertices, sharedVerticesIn: sharedIn } };
}

/** Sommets partagés « rompus » : partagés par k contours dans la source, présents chez un nombre différent (> 0) après simplification. */
export function brokenSharedVertices(srcFeatures, outFeatures) {
  const before = vertexOwners(srcFeatures.map((f) => ({ geometry: { type: f.geometry.type, coordinates: f.geometry.type === 'Polygon' ? f.geometry.coordinates.map((r) => cleanRing(r)) : f.geometry.coordinates.map((p) => p.map((r) => cleanRing(r))) } })));
  const after = vertexOwners(outFeatures);
  let broken = 0;
  for (const [k, s] of after) {
    const b = before.get(k);
    if (b && b.size > 1 && s.size !== b.size) broken += 1;
  }
  return broken;
}
