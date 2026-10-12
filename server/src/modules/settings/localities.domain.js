/**
 * Localités — logique PURE (testée, sans I/O) : plan d'insertion d'un
 * découpage importé, correspondance niveau ↔ colonne du registre de sites,
 * export CSV du répertoire.
 */

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
  const pcodeOwner = new Map(); const points = new Map(); const warnings = []; let dupPcodes = 0;
  for (const r of rows) {
    const names = (r.names || []).slice(0, levels.length);
    let parentKey = null;
    names.forEach((name, d) => {
      const key = parentKey ? `${parentKey} > ${name}` : name;
      const level = byDepth[d];
      if (!level.has(key)) {
        let pcode = (r.pcodes && r.pcodes[d]) || null;
        if (pcode) {
          const owner = pcodeOwner.get(pcode);
          if (owner && owner !== key) { dupPcodes += 1; pcode = null; } else pcodeOwner.set(pcode, key);
        }
        level.set(key, { key, depth: d + 1, name, parentKey, path: key, pcode });
      }
      parentKey = key;
    });
    if (names.length && r.lat != null && r.lng != null && !points.has(parentKey)) points.set(parentKey, { key: parentKey, lat: r.lat, lng: r.lng });
  }
  if (dupPcodes) warnings.push(`${dupPcodes} P-code(s) en double ignoré(s) (un P-code est unique dans le pays).`);
  const nodes = byDepth.map((m) => [...m.values()]);
  return { levels, byDepth: nodes, points: [...points.values()], withPcode: pcodeOwner.size, warnings };
}

// Colonne du registre de sites qui porte le nom de l'unité d'un niveau.
const SITE_COLUMNS = { adm1: 's.adm1', adm2: 'COALESCE(s.adm2, s.district)', adm3: 'COALESCE(s.adm3, s.commune)', adm4: 'COALESCE(s.adm4, s.fokontany)' };
const siteColumnFor = (code) => SITE_COLUMNS[code] || null;

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Export CSV (séparateur « ; », BOM UTF-8 pour Excel) : une colonne par niveau
 * ancêtre, puis l'unité, son P-code et ses coordonnées.
 * @param {Array<{ancestors:string[], name, pcode, lat, lng}>} rows
 * @param {string[]} levelLabels  libellés des niveaux 1..depth
 */
function directoryCsv(rows, levelLabels) {
  const header = [...levelLabels, 'P-code', 'Latitude', 'Longitude'];
  const lines = rows.map((r) => [...r.ancestors, r.name].concat(Array(Math.max(0, levelLabels.length - r.ancestors.length - 1)).fill(''))
    .concat([r.pcode, r.lat, r.lng]).map(csvCell).join(';'));
  return `\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`;
}

module.exports = { planBreakdown, siteColumnFor, directoryCsv };
