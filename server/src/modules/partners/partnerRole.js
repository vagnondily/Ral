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

/** État { partnerTypeId, active } d'une fiche, sous verrou (avant la mise à jour). */
async function roleForUpdateTx(client, tenantId, id) {
  const { rows } = await client.query(
    'SELECT partner_type_id AS "partnerTypeId", active FROM partners WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, id]);
  return rows[0] || null;
}

module.exports = { roleChanged, restampIfRoleChangedTx, roleForUpdateTx };
