/**
 * Requêtes multi-lignes par lots. PostgreSQL limite une requête à 65 535
 * paramètres : un gros import (ex. XLSForm avec des dizaines de milliers de
 * choix) dépasse la limite en une seule instruction. On découpe donc en lots
 * (toujours dans la transaction de l'appelant : tout ou rien).
 */
const MAX_PARAMS = 60000;

/** Lots de lignes tels que lignes × paramètres par ligne ≤ MAX_PARAMS. */
function chunkRows(rows, paramsPerRow, maxParams = MAX_PARAMS) {
  const size = Math.max(1, Math.floor(maxParams / Math.max(1, paramsPerRow)));
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * INSERT multi-lignes par lots : `columns` = noms de colonnes, `values(row)` =
 * valeurs dans l'ordre des colonnes, `suffix` = clause ajoutée (ON CONFLICT…).
 * Renvoie le nombre total de lignes affectées.
 */
async function insertRows(client, { table, columns, rows, values, suffix = '' }) {
  let affected = 0;
  for (const slice of chunkRows(rows, columns.length)) {
    const params = [];
    const tuples = slice.map((r) => {
      const v = values(r);
      const b = params.length;
      params.push(...v);
      return `(${v.map((_, k) => `$${b + k + 1}`).join(',')})`;
    });
    const { rowCount } = await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(',')} ${suffix}`, params);
    affected += rowCount;
  }
  return affected;
}

module.exports = { MAX_PARAMS, chunkRows, insertRows };
