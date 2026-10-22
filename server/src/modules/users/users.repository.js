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
      `SELECT u.id, u.email::text AS email, u.full_name AS "fullName", u.role, u.active, u.status,
              u.page_access AS "pageAccess", u.approved_at AS "approvedAt",
              u.activation_token AS "activationToken", u.phone, u.job_title AS "jobTitle", u.signup_note AS "signupNote",
              u.field_office_id AS "fieldOfficeId", o.name AS "fieldOfficeName",
              u.created_at AS "createdAt", u.updated_at AS "updatedAt"
         FROM users u LEFT JOIN field_offices o ON o.id = u.field_office_id AND o.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1
        ORDER BY (u.status = 'pending') DESC, u.active DESC, u.role, u.email`,
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

async function createUser(tenantId, { email, fullName, role, password, pageAccess, fieldOfficeId }) {
  const hash = await bcrypt.hash(password, 10);
  const access = normalizePageAccess(pageAccess);
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (tenant_id, email, full_name, role, password_hash, page_access, field_office_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tenantId, email, fullName || null, role, hash, access === null ? null : JSON.stringify(access), fieldOfficeId || null]
    );
    return rows[0].id;
  });
}

// pageAccess : absent = inchangé ; null = aucune restriction ; tableau = écrans autorisés.
async function updateUser(tenantId, id, { fullName, role, active, password, pageAccess, fieldOfficeId }) {
  const hash = password ? await bcrypt.hash(password, 10) : null;
  const touchAccess = pageAccess !== undefined;
  const access = touchAccess ? normalizePageAccess(pageAccess) : null;
  const touchOffice = fieldOfficeId !== undefined; // null = détacher ; absent = inchangé
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users SET
         full_name = COALESCE($3, full_name),
         role = COALESCE($4, role),
         active = COALESCE($5, active),
         password_hash = COALESCE($6, password_hash),
         page_access = CASE WHEN $7 THEN $8::jsonb ELSE page_access END,
         field_office_id = CASE WHEN $9 THEN $10::uuid ELSE field_office_id END,
         updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, fullName ?? null, role ?? null, active === undefined ? null : active, hash,
        touchAccess, access === null ? null : JSON.stringify(access), touchOffice, fieldOfficeId || null]
    );
    return rowCount === 1;
  });
}

/**
 * Valide un compte auto-inscrit (status 'pending') : rôle + accès attribués, activation,
 * traçabilité (approved_by/at). N'agit que sur un compte en attente.
 */
async function approveUser(tenantId, id, { role, pageAccess, approverId, fieldOfficeId }) {
  const access = normalizePageAccess(pageAccess);
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users SET role = $3, page_access = $4::jsonb, status = 'active', active = true,
         field_office_id = $6::uuid, approved_by = $5, approved_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
      [tenantId, id, role, access === null ? null : JSON.stringify(access), approverId, fieldOfficeId || null]
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
