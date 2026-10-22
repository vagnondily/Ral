const bcrypt = require('bcryptjs');
const { withTenantTransaction } = require('../../config/db');
const { normalizePageAccess } = require('../common/pageCatalog');

/**
 * Utilisateurs & accès — données (admin uniquement). Tenant-scoped via
 * withTenantTransaction ; les mots de passe sont hachés (bcrypt). Un compte
 * désactivé ou en attente ne peut plus se connecter (voir auth.routes +
 * auth_lookup_user). `page_access` (null = tout) limite les écrans visibles.
 */

async function listUsers(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, email::text AS email, full_name AS "fullName", role, active, status,
              page_access AS "pageAccess", approved_at AS "approvedAt",
              activation_token AS "activationToken",
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM users WHERE tenant_id = $1
         ORDER BY (status = 'pending') DESC, active DESC, role, email`,
      [tenantId]
    );
    return rows;
  });
}

/** Rôle courant d'un compte (null si introuvable) — pour les gardes d'escalade de rôle. */
async function getUserRole(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT role FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rows[0] ? rows[0].role : null;
  });
}

async function createUser(tenantId, { email, fullName, role, password, pageAccess }) {
  const hash = await bcrypt.hash(password, 10);
  const access = normalizePageAccess(pageAccess);
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (tenant_id, email, full_name, role, password_hash, page_access)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tenantId, email, fullName || null, role, hash, access === null ? null : JSON.stringify(access)]
    );
    return rows[0].id;
  });
}

// pageAccess : absent = inchangé ; null = aucune restriction ; tableau = écrans autorisés.
async function updateUser(tenantId, id, { fullName, role, active, password, pageAccess }) {
  const hash = password ? await bcrypt.hash(password, 10) : null;
  const touchAccess = pageAccess !== undefined;
  const access = touchAccess ? normalizePageAccess(pageAccess) : null;
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users SET
         full_name = COALESCE($3, full_name),
         role = COALESCE($4, role),
         active = COALESCE($5, active),
         password_hash = COALESCE($6, password_hash),
         page_access = CASE WHEN $7 THEN $8::jsonb ELSE page_access END,
         updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, fullName ?? null, role ?? null, active === undefined ? null : active, hash,
        touchAccess, access === null ? null : JSON.stringify(access)]
    );
    return rowCount === 1;
  });
}

/**
 * Valide un compte auto-inscrit (status 'pending') : rôle + accès attribués, activation,
 * traçabilité (approved_by/at). N'agit que sur un compte en attente.
 */
async function approveUser(tenantId, id, { role, pageAccess, approverId }) {
  const access = normalizePageAccess(pageAccess);
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users SET role = $3, page_access = $4::jsonb, status = 'active', active = true,
         approved_by = $5, approved_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
      [tenantId, id, role, access === null ? null : JSON.stringify(access), approverId]
    );
    return rowCount === 1;
  });
}

/** Statut courant d'un compte (pour distinguer validation / modification). */
async function getUserStatus(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT status FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rows[0] ? rows[0].status : null;
  });
}

async function deleteUser(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return rowCount === 1;
  });
}

module.exports = { listUsers, getUserRole, getUserStatus, createUser, updateUser, approveUser, deleteUser };
