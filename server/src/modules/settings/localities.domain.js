/**
 * Localités — logique PURE (testée, sans I/O) : plan d'insertion d'un
 * découpage importé, réimport sans casse (identifiants conservés),
 * correspondance niveau ↔ colonne du registre de sites, export CSV du répertoire.
 */
const { pathKey, relinkByPath } = require('../common/placeMatch');
const { toCsv } = require('../common/csv');

/**
 * Transforme les lignes importées ({ names, pcodes, lat, lng }) en nœuds uniques
 * par niveau, reliés par leur chemin (« Région > District > … »).
 * - Un P-code déjà porté par une AUTRE unité est écarté (avertissement) : la base
 *   l'exige unique par pays.
 * - Le point GPS d'une ligne est attribué à son unité la plus fine.
 * @returns {{ levels, byDepth: Array<Array<{key,depth,name,parentKey,path,pcode}>>, points: Array<{key,lat,lng}>, withPcode:number, warnings:string[] }}
 */
function planBreakdown({ levels = [], rows = [] }) {
  const byDepth = levels.map(() => new Map());
  const pcodeOwner = new Map(); const points = new Map(); const warnings = []; let dupPcodes = 0; let homonyms = 0;
  for (const r of rows) {
    const names = (r.names || []).slice(0, levels.length);
    let parent = null;
    names.forEach((name, d) => {
      const level = byDepth[d];
      const parentKey = parent ? parent.key : null;
      const namePath = parentKey ? `${parentKey} > ${name}` : name;
      let pcode = (r.pcodes && r.pcodes[d]) || null;
      let key = namePath;
      if (pcode) {
        const owner = pcodeOwner.get(pcode);
        if (owner && owner.parentKey === parentKey) key = owner.key;           // même unité (graphie éventuellement différente)
        else if (owner) { dupPcodes += 1; pcode = null; }                      // code déjà porté ailleurs : écarté
        else if (level.has(namePath) && level.get(namePath).pcode && level.get(namePath).pcode !== pcode) {
          key = `${namePath} [${pcode}]`; homonyms += 1;                       // homonymes du même parent, codes distincts
        }
      }
      if (!level.has(key)) {
        const path = parent ? `${parent.path} > ${name}` : name;
        level.set(key, { key, depth: d + 1, name, parentKey, path, pcode });
        if (pcode) pcodeOwner.set(pcode, { key, parentKey });
      }
      parent = level.get(key);
    });
    const leaf = parent && parent.key;
    if (names.length && r.lat != null && r.lng != null && !points.has(leaf)) points.set(leaf, { key: leaf, lat: r.lat, lng: r.lng });
  }
  if (dupPcodes) warnings.push(`${dupPcodes} P-code(s) en double ignoré(s) (un P-code est unique dans le pays).`);
  if (homonyms) warnings.push(`${homonyms} unité(s) homonyme(s) d'une autre du même parent, distinguée(s) par leur P-code.`);
  const nodes = byDepth.map((m) => [...m.values()]);
  return { levels, byDepth: nodes, points: [...points.values()], withPcode: pcodeOwner.size, warnings };
}

const upper = (s) => String(s).trim().toUpperCase();

/**
 * Réimport SANS CASSE : chaque nœud du nouveau plan reprend l'identifiant d'une
 * unité existante du même niveau — d'abord par P-code, sinon par chemin
 * normalisé — pour que les zones de contrat, avenants et alias qui pointent
 * dessus restent valides. Seules les unités qui ne se retrouvent pas sont
 * supprimées.
 * @param {Array<{id, depth, pcode?, path}>} existing  unités actuelles
 * @param {{ byDepth: Array<Array<{key, depth, pcode, path}>> }} plan  sortie de planBreakdown
 * @returns {{ idByKey: Map<string,string>, removed: string[], stats: {kept, byPcode, byPath, added, removed} }}
 */
function matchBreakdown(existing, plan) {
  const byPcode = new Map(); const byPath = new Map();
  for (const a of existing) {
    if (a.pcode) byPcode.set(`${a.depth}|${upper(a.pcode)}`, a);
    const k = `${a.depth}|${pathKey(a.path)}`;
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k).push(a);
  }
  const nodes = plan.byDepth.flat();
  const used = new Set(); const idByKey = new Map(); let byPcodeN = 0; let byPathN = 0;
  for (const n of nodes) { // 1. P-code : identifiant stable, même si le nom a changé
    const a = n.pcode && byPcode.get(`${n.depth}|${upper(n.pcode)}`);
    if (a && !used.has(a.id)) { used.add(a.id); idByKey.set(n.key, a.id); byPcodeN += 1; }
  }
  for (const n of nodes) { // 2. chemin normalisé (« Atsimo-Andrefana » = « Atsimo Andrefana »)
    if (idByKey.has(n.key)) continue;
    const a = (byPath.get(`${n.depth}|${pathKey(n.path)}`) || []).find((x) => !used.has(x.id));
    if (a) { used.add(a.id); idByKey.set(n.key, a.id); byPathN += 1; }
  }
  const removed = existing.filter((a) => !used.has(a.id)).map((a) => a.id);
  return {
    idByKey, removed,
    stats: { kept: idByKey.size, byPcode: byPcodeN, byPath: byPathN, added: nodes.length - idByKey.size, removed: removed.length },
  };
}

// Colonne du registre de sites qui porte le nom de l'unité d'un niveau.
const SITE_COLUMNS = { adm1: 's.adm1', adm2: 'COALESCE(s.adm2, s.district)', adm3: 'COALESCE(s.adm3, s.commune)', adm4: 'COALESCE(s.adm4, s.fokontany)' };
const siteColumnFor = (code) => SITE_COLUMNS[code] || null;

/**
 * Export CSV (séparateur « ; », BOM UTF-8 pour Excel) : une colonne par niveau
 * ancêtre, puis l'unité, son P-code et ses coordonnées.
 * @param {Array<{ancestors:string[], name, pcode, lat, lng}>} rows
 * @param {string[]} levelLabels  libellés des niveaux 1..depth
 */
function directoryCsv(rows, levelLabels) {
  const header = [...levelLabels, 'P-code', 'Latitude', 'Longitude'];
  const lines = rows.map((r) => [...r.ancestors, r.name].concat(Array(Math.max(0, levelLabels.length - r.ancestors.length - 1)).fill(''))
    .concat([r.pcode, r.lat, r.lng]));
  // Cellules neutralisées (formules) et échappées par l'écrivain CSV commun.
  return toCsv([header, ...lines]);
}

module.exports = { planBreakdown, matchBreakdown, relinkByPath, pathKey, siteColumnFor, directoryCsv };
