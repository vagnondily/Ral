const bcrypt = require('bcryptjs');
const { withTenantTransaction } = require('../../config/db');

/**
 * Utilisateurs & accès — données (admin uniquement). Tenant-scoped via
 * withTenantTransaction ; les mots de passe sont hachés (bcrypt). Un compte
 * désactivé ne peut plus se connecter (voir auth.routes + auth_lookup_user).
 */

async function listUsers(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, email::text AS email, full_name AS "fullName", role, active,
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM users WHERE tenant_id = $1 ORDER BY active DESC, role, email`,
      [tenantId]
    );
    return rows;
  });
}

async function createUser(tenantId, { email, fullName, role, password }) {
  const hash = await bcrypt.hash(password, 10);
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (tenant_id, email, full_name, role, password_hash)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tenantId, email, fullName || null, role, hash]
    );
    return rows[0].id;
  });
}

async function updateUser(tenantId, id, { fullName, role, active, password }) {
  const hash = password ? await bcrypt.hash(password, 10) : null;
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users SET
         full_name = COALESCE($3, full_name),
         role = COALESCE($4, role),
         active = COALESCE($5, active),
         password_hash = COALESCE($6, password_hash),
         updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, fullName ?? null, role ?? null, active === undefined ? null : active, hash]
    );
    return rowCount === 1;
  });
}

async function deleteUser(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

module.exports = { listUsers, createUser, updateUser, deleteUser };
