/**
 * Journal des suppressions de documents (retour n° 56).
 *
 * `recordDeletion` s'exécute DANS la transaction de la suppression (le même
 * `client`) : la ligne de journal et la suppression du document réussissent ou
 * échouent ensemble. Table append-only (migration 061).
 */
const { withTenantTransaction } = require('../../config/db');

/**
 * Inscrit une suppression au journal (dans la transaction appelante).
 * @param {import('pg').PoolClient} client  client de la transaction en cours
 * @param {string} tenantId
 * @param {object} e
 * @param {string}  e.docType    deletionPolicy.DOCUMENT_TYPES
 * @param {string}  e.docId      id du document supprimé
 * @param {string}  [e.docRef]   référence lisible (n° facture, mois, intitulé…)
 * @param {string}  [e.summary]  résumé (texte ou JSON compact ≤ 4 Ko)
 * @param {string}  e.statusAtDeletion
 * @param {boolean} e.validated
 * @param {string}  [e.justification]
 * @param {string}  e.deletedBy  id de l'utilisateur
 */
async function recordDeletion(client, tenantId, e) {
  await client.query(
    `INSERT INTO document_deletions
       (tenant_id, doc_type, doc_id, doc_ref, summary, status_at_deletion, validated, justification, deleted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tenantId, e.docType, e.docId, e.docRef ?? null, e.summary ?? null,
      e.statusAtDeletion, e.validated, e.justification || null, e.deletedBy,
    ]
  );
}

/** Liste du journal (le plus récent d'abord), lecture seule. Admin. */
async function listDeletions(tenantId, { limit = 100, offset = 0, docType = null } = {}) {
  const cap = Math.min(Math.max(1, Number(limit) || 100), 500);
  const skip = Math.max(0, Number(offset) || 0);
  return withTenantTransaction(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT d.id, d.doc_type AS "docType", d.doc_id AS "docId", d.doc_ref AS "docRef",
              d.summary, d.status_at_deletion AS "statusAtDeletion", d.validated,
              d.justification, d.deleted_by AS "deletedBy", u.email AS "deletedByEmail",
              d.deleted_at AS "deletedAt"
         FROM document_deletions d
         LEFT JOIN users u ON u.id = d.deleted_by
        WHERE d.tenant_id = $1 AND ($2::text IS NULL OR d.doc_type = $2)
        ORDER BY d.deleted_at DESC, d.id
        LIMIT $3 OFFSET $4`,
      [tenantId, docType, cap, skip]
    );
    return rows;
  });
}

module.exports = { recordDeletion, listDeletions };
