/**
 * Changement de RÔLE d'un partenaire (type ou fiche active / inactive) — revue du lot 8. Être TPM
 * dépend du code du type et de la fiche active (activeProvider.tpmsByContract ; jumelle SQL
 * mems_tpm_cells, migration 070) : quand l'un change, le TPM des visites PRÉVUES des zones qu'il
 * touche doit être recalculé, dans la MÊME transaction, à partir du mois courant (comme
 * contracts.service.restampFromNow) — jamais les visites réalisées, annulées, figées ou facturées
 * (filtre AUTO_RESTAMPABLE_SQL de restampVisitsTx).
 */
const TIMEZONE = process.env.APP_TIMEZONE || 'Indian/Antananarivo';

/** Le rôle a-t-il changé ? (avant / après : { partnerTypeId, active }) — pur, testé. */
function roleChanged(before, after) {
  if (!before || !after) return false;
  return String(before.partnerTypeId) !== String(after.partnerTypeId) || Boolean(before.active) !== Boolean(after.active);
}

const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date()).slice(0, 7);

/** Réestampille les visites prévues dès le mois courant quand le rôle a changé (même transaction). */
async function restampIfRoleChangedTx(client, tenantId, before, after) {
  if (!roleChanged(before, after)) return false;
  const { restampVisitsTx } = require('../tpm/tpmAttribution.repository');
  await restampVisitsTx(client, tenantId, { fromMonth: currentMonth() });
  return true;
}

/** Le patch peut-il changer le rôle (type ou fiche active) ? — pur, testé. */
function touchesRole(patch) {
  return Boolean(patch && (patch.partnerTypeId || (patch.active !== undefined && patch.active !== null)));
}

/** `name` change-t-il vraiment ? Seul cas où l'UPDATE doit lister `name` (voir roleForUpdateTx) — pur, testé. */
function nameChanges(before, name) {
  return name !== undefined && name !== null && name !== '' && String(name) !== String(before && before.name);
}

/**
 * État { name, partnerTypeId, active } d'une fiche, sous verrou, avant sa mise à jour. Ordre des verrous
 * = celui des écrivains de l'attribution (setOverrides, applyVisitRequestTx, écritures de visites) :
 *   1. quand le patch peut changer le rôle (touchesRole), le verrou d'attribution du compte D'ABORD
 *      (lockAttributionTx ; après withSubmissionLinks, l'ordre documenté rattachements → attribution) ;
 *   2. puis la ligne, FOR NO KEY UPDATE (jamais FOR UPDATE).
 * Et l'UPDATE qui suit ne liste `name` que s'il change vraiment (nameChanges). partners porte un
 * déclencheur BEFORE UPDATE (trg_same_tenant) : Postgres verrouille alors la ligne pour lui selon la
 * LISTE SET, et dès qu'une colonne de clé y figure (UNIQUE (tenant_id, name)), même inchangée, c'est
 * FOR UPDATE — qui bloque le FOR KEY SHARE des clés étrangères vers partners(id). Sans le verrou
 * d'attribution pris d'abord, un écrivain qui le tient puis écrit provider_id = cette fiche interbloque
 * avec nous (40P01) ; sans la ligne FOR NO KEY UPDATE et le SET construit, un écrivain qui écrit d'abord
 * la clé étrangère (visite, contrat, plan…) puis prend le verrou d'attribution (restampVisitsTx en fin
 * d'écriture, estampille différée au COMMIT) interbloque aussi, puisque nous tenons alors ce verrou.
 * Deux changements de rôle concurrents restent sérialisés (verrou d'attribution, puis la ligne).
 * Seul cas restant : renommer ET changer le rôle dans le même enregistrement pendant qu'un écrivain du
 * second ordre a posé sa clé étrangère — la clé modifiée exige FOR UPDATE ; Postgres détecte
 * l'interblocage et annule une des deux transactions en entier (40P01 → 503 « réessayez »).
 * Contrôlé en base réelle, dans les trois cas : test/lot8Db.test.js.
 */
const ROLE_LOCK = 'FOR NO KEY UPDATE';
async function roleForUpdateTx(client, tenantId, id, patch = {}) {
  if (touchesRole(patch)) {
    const { lockAttributionTx } = require('../tpm/tpmAttribution.repository');
    await lockAttributionTx(client, tenantId);
  }
  const { rows } = await client.query(
    `SELECT name, partner_type_id AS "partnerTypeId", active FROM partners WHERE tenant_id = $1 AND id = $2 ${ROLE_LOCK}`, [tenantId, id]);
  return rows[0] || null;
}

module.exports = { roleChanged, touchesRole, nameChanges, restampIfRoleChangedTx, roleForUpdateTx, ROLE_LOCK };
