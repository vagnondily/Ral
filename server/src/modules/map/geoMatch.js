/**
 * District (P-code du découpage du compte) ↔ contour de la carte (lot 6a) — règle
 * PURE, testée (test/geoMatch.test.js). Ordre :
 *  1. manuel  : correction enregistrée (map_shape_links) ; shapeKey null = « ne pas dessiner » ;
 *  2. exact   : même nom que le contour ;
 *  3. normalisé : même clé normKey (accents, casse, tirets, apostrophes) ;
 *  4. contour parent : P-code à suffixe lettre (MG52516a, district scindé après 2018)
 *     → contour du district MG52516, partagé et signalé ;
 *  5. aucun   : listé (« districts sans contour »), jamais deviné.
 * Un contour revendiqué par deux districts aux étapes 2-3 = conflit : dessiné partagé
 * et listé, jamais écarté en silence. (Pas d'étape « alias » : mesuré, 119/120 noms
 * exacts ; la correction manuelle et le contour parent couvrent les cas réels.)
 */

/** Clé de rapprochement d'un nom — copie exacte de web/scripts/geoBuild.js#normKey (test d'égalité). */
function normKey(name) {
  return String(name == null ? '' : name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** P-code parent d'un district scindé (« MG52516a » → « MG52516 »), sinon null. */
function parentPcode(pcode) {
  const m = /^(.*\d)[a-z]+$/i.exec(String(pcode || ''));
  return m ? m[1] : null;
}

const HOW = Object.freeze({ manual: 'manuel', exact: 'exact', norm: 'normalise', parent: 'parent', none: 'aucun', hidden: 'masque', conflict: 'conflit' });

/**
 * @param {{ districts: {pcode:string, name:string}[], shapes: {key:string, name:string}[],
 *           links?: Map<string, string|null> }} input
 * @returns {{ byPcode: Record<string, {shapeKey:string|null, how:string, sharedWith:string[]}>,
 *             byShape: Record<string, string[]>, unmatched: string[], hidden: string[],
 *             conflicts: {shapeKey:string, pcodes:string[]}[], staleLinks: string[] }}
 */
function matchDistricts({ districts = [], shapes = [], links = new Map() } = {}) {
  const shapeKeys = new Set(shapes.map((s) => s.key));
  const byName = new Map();
  const byNorm = new Map();
  for (const s of shapes) {
    if (!byName.has(s.name)) byName.set(s.name, s.key);
    const k = normKey(s.name);
    if (!byNorm.has(k)) byNorm.set(k, s.key);
  }
  const byPcode = {};
  const staleLinks = [];
  const hidden = [];
  // Étapes 1 à 3.
  for (const d of districts) {
    if (links.has(d.pcode)) {
      const target = links.get(d.pcode);
      if (target === null) { byPcode[d.pcode] = { shapeKey: null, how: HOW.hidden, sharedWith: [] }; hidden.push(d.pcode); continue; }
      if (shapeKeys.has(target)) { byPcode[d.pcode] = { shapeKey: target, how: HOW.manual, sharedWith: [] }; continue; }
      staleLinks.push(d.pcode); // contour disparu de l'index : retour à l'automatique, signalé
    }
    if (byName.has(d.name)) byPcode[d.pcode] = { shapeKey: byName.get(d.name), how: HOW.exact, sharedWith: [] };
    else if (byNorm.has(normKey(d.name))) byPcode[d.pcode] = { shapeKey: byNorm.get(normKey(d.name)), how: HOW.norm, sharedWith: [] };
  }
  // Étape 4 : contour du district parent (déjà rapproché).
  for (const d of districts) {
    if (byPcode[d.pcode]) continue;
    const p = parentPcode(d.pcode);
    const host = p && byPcode[p];
    if (host && host.shapeKey) byPcode[d.pcode] = { shapeKey: host.shapeKey, how: HOW.parent, sharedWith: [] };
  }
  const unmatched = districts.filter((d) => !byPcode[d.pcode]).map((d) => d.pcode);
  // Contours partagés, conflits (deux rapprochements automatiques par nom sur le même contour).
  const byShape = {};
  for (const d of districts) {
    const m = byPcode[d.pcode];
    if (!m || !m.shapeKey) continue;
    (byShape[m.shapeKey] = byShape[m.shapeKey] || []).push(d.pcode);
  }
  const conflicts = [];
  for (const [shapeKey, pcodes] of Object.entries(byShape)) {
    for (const pc of pcodes) byPcode[pc].sharedWith = pcodes.filter((x) => x !== pc);
    const byNameMatch = pcodes.filter((pc) => byPcode[pc].how === HOW.exact || byPcode[pc].how === HOW.norm);
    if (byNameMatch.length > 1) {
      conflicts.push({ shapeKey, pcodes: byNameMatch });
      for (const pc of byNameMatch) byPcode[pc].how = HOW.conflict;
    }
  }
  return { byPcode, byShape, unmatched, hidden, conflicts, staleLinks };
}

module.exports = { normKey, parentPcode, matchDistricts, HOW };
