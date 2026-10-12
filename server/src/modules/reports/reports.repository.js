const { withTenantTransaction } = require('../../config/db');
const { conflict, notFound, badRequest } = require('../../middleware/errors');

/**
 * Concepteur de rapport — persistance des modèles personnalisés et des
 * documents. Le contenu a déjà été validé par reportModel (schéma strict).
 * Les écritures de document sont protégées par un numéro de version
 * (verrou optimiste : deux éditions concurrentes → 409, jamais d'écrasement
 * silencieux) ; un document finalisé est figé (lecture seule).
 */
const TPL_COLS = `id, name, description, content, created_at AS "createdAt", updated_at AS "updatedAt"`;
const DOC_COLS = `id, title, template_key AS "templateKey", to_char(period_from, 'YYYY-MM') AS "periodFrom",
  to_char(period_to, 'YYYY-MM') AS "periodTo", status, version, finalized_at AS "finalizedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

// ---- Modèles personnalisés ---------------------------------------------------
async function listTemplates(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(`SELECT ${TPL_COLS} FROM report_templates WHERE tenant_id = $1 ORDER BY lower(name)`, [tenantId]);
    return rows;
  });
}

async function createTemplate(tenantId, { name, description, content }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO report_templates (tenant_id, name, description, content, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING ${TPL_COLS}`,
      [tenantId, name, description || null, content, userId]);
    return rows[0];
  });
}

async function updateTemplate(tenantId, id, { name, description, content }) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE report_templates SET name = $3, description = $4, content = $5, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${TPL_COLS}`, [tenantId, id, name, description || null, content]);
    if (!rows.length) throw notFound('Modèle introuvable');
    return rows[0];
  });
}

async function deleteTemplate(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM report_templates WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    if (!rowCount) throw notFound('Modèle introuvable');
    return { deleted: 1 };
  });
}

// ---- Documents -------------------------------------------------------------------
async function listDocuments(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(`SELECT ${DOC_COLS} FROM report_documents WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 500`, [tenantId]);
    return rows;
  });
}

async function getDocument(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(`SELECT ${DOC_COLS}, content, snapshot FROM report_documents WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    if (!rows.length) throw notFound('Rapport introuvable');
    return rows[0];
  });
}

async function createDocument(tenantId, { content, templateKey }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO report_documents (tenant_id, title, template_key, period_from, period_to, content, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${DOC_COLS}`,
      [tenantId, content.title, templateKey || null, `${content.period.from}-01`, `${content.period.to}-01`, content, userId]);
    return rows[0];
  });
}

/** Mise à jour sous verrou optimiste : `version` doit être la version lue. */
async function updateDocument(tenantId, id, { content, version }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: cur } = await client.query('SELECT status, version FROM report_documents WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!cur.length) throw notFound('Rapport introuvable');
    if (cur[0].status === 'final') throw conflict('Ce rapport est finalisé : dupliquez-le pour le modifier.');
    if (cur[0].version !== version) throw conflict('Le rapport a été modifié entre-temps (par vous dans un autre onglet ou par un collègue) : rechargez-le.');
    const { rows } = await client.query(
      `UPDATE report_documents SET title = $3, period_from = $4, period_to = $5, content = $6, version = version + 1,
              updated_by = $7, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${DOC_COLS}`,
      [tenantId, id, content.title, `${content.period.from}-01`, `${content.period.to}-01`, content, userId]);
    return rows[0];
  });
}

/** Finalise : fige le contenu ET les données calculées (snapshot). Irréversible. */
async function finalizeDocument(tenantId, id, { version, snapshot }, userId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows: cur } = await client.query('SELECT status, version FROM report_documents WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!cur.length) throw notFound('Rapport introuvable');
    if (cur[0].status === 'final') throw conflict('Rapport déjà finalisé.');
    if (cur[0].version !== version) throw conflict('Le rapport a été modifié entre-temps : rechargez-le avant de finaliser.');
    if (!snapshot || typeof snapshot !== 'object') throw badRequest('Données du rapport manquantes.');
    const { rows } = await client.query(
      `UPDATE report_documents SET status = 'final', snapshot = $3, finalized_at = now(), version = version + 1, updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 RETURNING ${DOC_COLS}`, [tenantId, id, snapshot, userId]);
    return rows[0];
  });
}

async function deleteDocument(tenantId, id) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM report_documents WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    if (!rowCount) throw notFound('Rapport introuvable');
    return { deleted: 1 };
  });
}

module.exports = {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  listDocuments, getDocument, createDocument, updateDocument, finalizeDocument, deleteDocument,
};
