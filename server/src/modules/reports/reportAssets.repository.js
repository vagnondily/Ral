const { withTenantTransaction } = require('../../config/db');
const { notFound, payloadTooLarge } = require('../../middleware/errors');

/**
 * Images des en-têtes et pieds de page du concepteur (migration 062) — seule couche qui écrit
 * le SQL. Une image est stockée une fois par compte (SHA-256) ; elle est IMMUABLE (aucune
 * modification ni suppression par l'application). Quota par compte vérifié dans la transaction
 * d'insertion, sous un verrou consultatif par compte (deux envois simultanés ne le dépassent pas).
 */
const QUOTA = { count: 200, bytes: 50 * 1024 * 1024 };
const COLS = `id, mime, width, height, bytes, name, created_at AS "createdAt"`;

/**
 * Enregistre une image déjà contrôlée (common/imageInfo) ; renvoie l'existante si le compte a déjà
 * ces octets. @returns {Promise<{ asset: object, created: boolean }>}
 */
async function createAsset(tenantId, a, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`report_assets:${tenantId}`]);
    const ex = await client.query(`SELECT ${COLS} FROM report_assets WHERE tenant_id = $1 AND sha256 = $2`, [tenantId, a.sha256]);
    if (ex.rows.length) return { asset: ex.rows[0], created: false };
    const q = await client.query('SELECT count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS b FROM report_assets WHERE tenant_id = $1', [tenantId]);
    const { n, b } = q.rows[0];
    if (n >= QUOTA.count || Number(b) + a.bytes > QUOTA.bytes) {
      throw payloadTooLarge(`Quota d'images du compte atteint (${QUOTA.count} images ou 50 Mo) : réutilisez un logo déjà téléversé.`, { code: 'asset_quota' });
    }
    const ins = await client.query(
      `INSERT INTO report_assets (tenant_id, sha256, mime, width, height, bytes, data, name, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLS}`,
      [tenantId, a.sha256, a.mime, a.width, a.height, a.bytes, a.data, a.name || null, userId || null]);
    return { asset: ins.rows[0], created: true };
  });
}

/** Images du compte (sans les octets), les plus récentes d'abord. */
async function listAssets(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(`SELECT ${COLS} FROM report_assets WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT ${QUOTA.count}`, [tenantId]);
    return rows;
  });
}

/** Octets d'une image du compte (404 sinon, y compris pour l'image d'un autre compte). */
async function getAssetData(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT mime, data FROM report_assets WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    if (!rows.length) throw notFound('Image introuvable');
    return rows[0];
  });
}

/** Identifiants parmi `ids` qui sont des images du compte. */
async function existingAssetIds(tenantId, ids) {
  if (!ids.length) return new Set();
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT id FROM report_assets WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
    return new Set(rows.map((r) => r.id));
  });
}

module.exports = { createAsset, listAssets, getAssetData, existingAssetIds, QUOTA };
