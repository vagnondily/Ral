const { withTenantTransaction } = require('../../config/db');
const { conflict, notFound, badRequest, forbidden } = require('../../middleware/errors');

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

/** Un rapport finalisé (chiffres figés, potentiellement diffusé) ne se supprime que par un administrateur. */
async function deleteDocument(tenantId, id, { allowFinal = false } = {}) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query('SELECT status FROM report_documents WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
    if (!rows.length) throw notFound('Rapport introuvable');
    if (rows[0].status === 'final' && !allowFinal) throw forbidden('Rapport finalisé : seul un administrateur peut le supprimer.');
    await client.query('DELETE FROM report_documents WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return { deleted: 1 };
  });
}

// ---- Référentiels lus par le concepteur (lot 7a) ------------------------------------
/** Bureaux du client (id, nom, bureau parent) : filtres par identifiant, mise à niveau v1 (nom → id). */
async function listOffices(tenantId) {
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, name, parent_id AS "parentId", active FROM field_offices WHERE tenant_id = $1 ORDER BY lower(name)`, [tenantId]);
    return rows;
  });
}

/**
 * Éléments des sections répétées, par des comptages indexés (plan de rendu, sans calcul lourd) :
 *  - activity : fiches actives ayant des soumissions (non exclues) sur la période ;
 *  - bureau   : bureaux MEMS (de premier niveau) ayant des sites ou des soumissions sur la période,
 *               plus « non relié » s'il reste des soumissions sans bureau MEMS ;
 *  - partner  : prestataires actifs (partenaires d'un type TPM ou ayant des visites sur la période).
 * @param {{ from, to }} period
 */
async function repeatCandidates(tenantId, over, period) {
  return withTenantTransaction(tenantId, async (client) => {
    const lo = `${period.from}-01`;
    const [y, m] = period.to.split('-').map(Number);
    const hiExcl = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    if (over === 'activity') {
      const { rows } = await client.query(
        `SELECT f.id, f.label, f.activity_category AS "activityCategory", c.n
           FROM monitoring_forms f
           JOIN (SELECT form_id, count(*)::int AS n FROM monitoring_submissions
                  WHERE tenant_id = $1 AND NOT excluded AND period_month >= $2::date AND period_month < $3::date
                  GROUP BY form_id) c ON c.form_id = f.id
          WHERE f.tenant_id = $1 AND f.active ORDER BY f.label`, [tenantId, lo, hiExcl]);
      return rows;
    }
    if (over === 'bureau') {
      const { rows } = await client.query(
        `WITH top AS (SELECT o.id, o.name, COALESCE(o.parent_id, o.id) AS root FROM field_offices o WHERE o.tenant_id = $1),
              used AS (
                SELECT t.root FROM sites s JOIN top t ON t.id = s.field_office_id WHERE s.tenant_id = $1
                UNION
                SELECT t.root FROM monitoring_submissions ms JOIN top t ON t.id = ms.field_office_id
                 WHERE ms.tenant_id = $1 AND NOT ms.excluded AND ms.period_month >= $2::date AND ms.period_month < $3::date)
         SELECT o.id, o.name FROM field_offices o JOIN (SELECT DISTINCT root FROM used) u ON u.root = o.id
          WHERE o.tenant_id = $1 ORDER BY lower(o.name)`, [tenantId, lo, hiExcl]);
      const { rows: [un] } = await client.query(
        `SELECT EXISTS (SELECT 1 FROM monitoring_submissions WHERE tenant_id = $1 AND NOT excluded AND field_office_id IS NULL
                          AND period_month >= $2::date AND period_month < $3::date) AS any`, [tenantId, lo, hiExcl]);
      return { offices: rows, unlinked: un.any };
    }
    const { rows } = await client.query(
      `SELECT p.id, p.name FROM partners p
        WHERE p.tenant_id = $1 AND p.active
          AND (EXISTS (SELECT 1 FROM partner_types pt WHERE pt.id = p.partner_type_id AND pt.code ILIKE 'tpm%')
               OR EXISTS (SELECT 1 FROM site_visits v WHERE v.tenant_id = $1 AND v.provider_id = p.id
                            AND v.period_month >= $2::date AND v.period_month < $3::date))
        ORDER BY lower(p.name)`, [tenantId, lo, hiExcl]);
    return rows;
  });
}

module.exports = {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  listDocuments, getDocument, createDocument, updateDocument, finalizeDocument, deleteDocument,
  listOffices, repeatCandidates,
};
