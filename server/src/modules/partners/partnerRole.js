/**
 * Changement de RÔLE d'un partenaire (type ou fiche active / inactive) — revue du lot 8. Être TPM
 * dépend du code du type et de la fiche active (activeProvider.tpmsByContract ; jumelle SQL
 * mems_tpm_cells, migration 070) : quand l'un change, le TPM des visites PRÉVUES des zones qu'il
 * touche doit être recalculé, dans la MÊME transaction, à partir du mois courant (comme
 * contracts.service.restampFromNow) — jamais les visites réalisées, annulées, figées ou facturées
 * (filtre AUTO_RESTAMPABLE_SQL de restampVisitsTx).
 */
// Mois courant : l'horloge unique du serveur (rbmMath.currentMonth = common/localDay, fuseau de
// l'application, repli UTC si APP_TIMEZONE est invalide — jamais une exception).
const { currentMonth } = require('../tpm/rbmMath');
const { conflict } = require('../../middleware/errors');
const { SYSTEM_LOG_REASONS } = require('../tpm/tpmAttribution');

/** Identifiant de type comparable : un UUID ne dépend pas de la casse (zod `.uuid()` accepte les majuscules). */
const typeKey = (id) => String(id ?? '').toLowerCase();

/** Le rôle a-t-il changé ? (avant / après : { partnerTypeId, active }) — pur, testé. */
function roleChanged(before, after) {
  if (!before || !after) return false;
  return typeKey(before.partnerTypeId) !== typeKey(after.partnerTypeId) || Boolean(before.active) !== Boolean(after.active);
}

/**
 * Motif du lot « rendre à la zone » au journal (tpm_attribution_log, visite_zone) : un CODE du système,
 * traduit par l'écran (tpmAttribution.SYSTEM_LOG_REASONS) — jamais une phrase française figée.
 */
const ROLE_LOST_REASON = SYSTEM_LOG_REASONS.partner_not_tpm.code;
/** Réponse quand une visite a changé entre-temps (jamais 500 : rien n'est écrit, l'enregistrement se rejoue). */
const RETRY = 'Les visites de ce partenaire viennent de changer (autre utilisateur) : réessayez.';
const RETURN_BATCH = 500; // applyVisitRequestTx : 500 visites au plus par appel

/**
 * Le partenaire n'est plus un TPM ACTIF (type changé ou fiche désactivée) : ses visites PRÉVUES qui le
 * portent par un choix de visite (provider_source « visite », retour 58) reviennent à leur zone — D1
 * interdit qu'une visite ait pour TPM un partenaire qui n'en est pas un, et l'estampille automatique ne
 * touche jamais une visite « visite ». Même chemin que « Rendre à la zone » de l'écran
 * (tpmAttribution.repository.applyVisitRequestTx, action « zone » : estampille, journal visite_zone —
 * un lot et une ligne par visite). Seules les visites ré-estampillables (AUTO_RESTAMPABLE_SQL : prévues,
 * non figées, non facturées), dès le mois courant : jamais une visite réalisée, annulée ou facturée.
 * Sous le verrou d'attribution, déjà tenu (roleForUpdateTx ; réentrant).
 * @returns {Promise<number>} visites rendues à leur zone
 */
async function returnVisitsToZoneTx(client, tenantId, partnerId, actorId) {
  const attribution = require('../tpm/tpmAttribution.repository');
  const { rows: [p] } = await client.query(
    `SELECT t.code, p.active FROM partners p JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, partnerId]);
  if (!p || (p.code === 'tpm' && p.active)) return 0;
  // Visites verrouillées là où on les lit, par identifiant (ordre des verrous : sous le verrou d'attribution,
  // les visites toujours par id) : une visite supprimée ou modifiée en même temps est attendue puis relue —
  // elle disparaît de la liste au lieu de faire échouer l'enregistrement (relecture croisée, point C).
  const { rows } = await client.query(
    `SELECT v.id FROM site_visits v
      WHERE v.tenant_id = $1 AND v.provider_id = $2 AND v.provider_source = 'visite' AND v.period_month >= $3::date
        AND ${attribution.AUTO_RESTAMPABLE_SQL} ORDER BY v.id FOR UPDATE OF v`, [tenantId, partnerId, `${currentMonth()}-01`]);
  let returned = 0;
  for (let i = 0; i < rows.length; i += RETURN_BATCH) {
    const res = await attribution.applyVisitRequestTx(client, tenantId, actorId || null,
      rows.slice(i, i + RETURN_BATCH).map((r) => r.id), { action: 'zone', reason: ROLE_LOST_REASON });
    // Lignes déjà verrouillées ici : plus d'erreur attendue ; si la règle en rend une, 409 « réessayez », jamais 500.
    if (res.error) throw conflict(RETRY, { code: 'visits_changed', reason: res.error });
    returned += res.updated;
  }
  return returned;
}

/**
 * Le rôle a changé (même transaction) : un partenaire qui n'est plus un TPM actif rend d'abord ses visites
 * prévues « visite » à leur zone (returnVisitsToZoneTx, si `partnerId` est donné), puis les visites
 * prévues sont réestampillées dès le mois courant.
 * @param {{ partnerId?: string, actorId?: string }} [opts]
 */
async function restampIfRoleChangedTx(client, tenantId, before, after, { partnerId = null, actorId = null } = {}) {
  if (!roleChanged(before, after)) return false;
  if (partnerId) await returnVisitsToZoneTx(client, tenantId, partnerId, actorId);
  const { restampVisitsTx } = require('../tpm/tpmAttribution.repository');
  await restampVisitsTx(client, tenantId, { fromMonth: currentMonth() });
  return true;
}

/** Rôle APRÈS le patch (type et fiche active ; absent, vide ou null = inchangé) — pur, testé. */
function roleAfter(before, patch = {}) {
  return { partnerTypeId: patch.partnerTypeId || before.partnerTypeId,
    active: patch.active === undefined || patch.active === null ? before.active : patch.active };
}

/** Le patch change-t-il VRAIMENT le rôle de cette fiche ? (l'écran renvoie toujours type et fiche active) — pur. */
const changesRole = (before, patch) => roleChanged(before, roleAfter(before, patch));

/** `name` change-t-il vraiment ? Seul cas où l'UPDATE doit lister `name` (voir roleForUpdateTx) — pur, testé. */
function nameChanges(before, name) {
  return name !== undefined && name !== null && name !== '' && String(name) !== String(before && before.name);
}

/**
 * État { name, partnerTypeId, active } d'une fiche, sous verrou, avant sa mise à jour.
 *
 * Deux sortes d'écrivains posent une clé étrangère vers partners(id) (FOR KEY SHARE sur la ligne) :
 *   - « verrou d'abord » : verrou d'attribution du compte, PUIS provider_id = la fiche (setOverrides,
 *     applyVisitRequestTx, écritures de visites qui commencent par lockAttributionTx) ;
 *   - « clé d'abord » : la clé étrangère (visite, contrat — approbation d'un avenant —, plan…) PUIS le
 *     verrou d'attribution (restampVisitsTx en fin d'écriture, estampille différée au COMMIT).
 * D'où, ici :
 *   1. lecture SANS verrou ; le verrou d'attribution n'est pris que si le patch change VRAIMENT le
 *      type ou la fiche active (changesRole) — un renommage seul n'y touche jamais ;
 *   2. puis la ligne, FOR NO KEY UPDATE (jamais FOR UPDATE), et nouvelle comparaison. Si le rôle a
 *      changé entre les deux lectures (un autre enregistrement validé entre-temps) alors que le verrou
 *      d'attribution n'a pas été pris : ROLLBACK TO SAVEPOINT rend la ligne (son verrou est libéré),
 *      puis verrou d'attribution et la ligne à nouveau — jamais la ligne puis le verrou d'attribution,
 *      qui interbloquerait avec un autre changement de rôle de la même fiche.
 * Et l'UPDATE qui suit ne liste `name` que s'il change (nameChanges) : partners porte un déclencheur
 * BEFORE UPDATE (trg_same_tenant), Postgres verrouille alors la ligne selon la LISTE SET et, dès qu'une
 * colonne de clé y figure (UNIQUE (tenant_id, name)), même inchangée, c'est FOR UPDATE, qui attend le
 * FOR KEY SHARE des clés étrangères. Ce que cela donne (contrôlé en base réelle : test/lot8Db.test.js) :
 *   - rôle changé, nom inchangé : aucune attente sur la ligne, aucun interblocage ;
 *   - renommage seul : la mise à jour attend la fin d'un écrivain « clé d'abord », sans interblocage
 *     (elle ne tient pas le verrou d'attribution) ; avec un écrivain « verrou d'abord », l'un attend la
 *     fin de l'autre, sans interblocage non plus ;
 *   - rôle changé pendant l'approbation d'un avenant d'un contrat de ses zones (contrat verrouillé PUIS
 *     restampFromNow) : sans interblocage — notre réestampille pose site_visits.contract_id (FOR KEY
 *     SHARE sur le contrat), que le verrou d'écriture du contrat (FOR NO KEY UPDATE,
 *     contracts.repository.getContract) laisse passer ;
 *   - CE QUI RESTE :
 *     · renommer ET changer le rôle dans le même enregistrement pendant qu'un écrivain « clé d'abord »
 *       a posé sa clé étrangère vers la fiche : nous tenons le verrou d'attribution et attendons sa clé,
 *       il attend le verrou d'attribution. Postgres détecte l'interblocage (40P01) et annule l'une des
 *       deux transactions en entier — rien d'écrit à moitié — et le gestionnaire d'erreurs répond 503
 *       « Une autre mise à jour des mêmes données est en cours : réessayez dans un instant. » ;
 *     · rôle changé pendant la SUPPRESSION d'un contrat de ses zones (seule écriture de contrat encore
 *       FOR UPDATE ; de même pour tout écrivain dont la réestampille pose contract_id = ce contrat, une
 *       nouvelle visite par exemple) : la réestampille attend la fin de la suppression, sans interblocage
 *       (un contrat qui porte des visites ne se supprime pas, la suppression ne prend donc jamais le
 *       verrou d'attribution) ; si elle aboutit, la clé étrangère vers le contrat supprimé est refusée
 *       (23503 → 400), l'enregistrement est annulé en entier et le nouvel essai passe.
 * Deux changements de rôle concurrents de la même fiche restent sérialisés (verrou d'attribution, puis
 * la ligne).
 */
const ROLE_LOCK = 'FOR NO KEY UPDATE';
const ROW_SQL = 'SELECT name, partner_type_id AS "partnerTypeId", active FROM partners WHERE tenant_id = $1 AND id = $2';
async function roleForUpdateTx(client, tenantId, id, patch = {}) {
  const lockAttribution = () => require('../tpm/tpmAttribution.repository').lockAttributionTx(client, tenantId);
  const lockRow = async () => (await client.query(`${ROW_SQL} ${ROLE_LOCK}`, [tenantId, id])).rows[0] || null;
  const peek = (await client.query(ROW_SQL, [tenantId, id])).rows[0];
  if (!peek) return null;
  if (changesRole(peek, patch)) {
    await lockAttribution();
    return lockRow();
  }
  await client.query('SAVEPOINT partner_role_lock');
  const row = await lockRow();
  if (!row || !changesRole(row, patch)) {
    await client.query('RELEASE SAVEPOINT partner_role_lock');
    return row;
  }
  await client.query('ROLLBACK TO SAVEPOINT partner_role_lock'); // rend la ligne avant le verrou d'attribution
  await client.query('RELEASE SAVEPOINT partner_role_lock');
  await lockAttribution();
  return lockRow();
}

module.exports = { roleChanged, roleAfter, changesRole, nameChanges, restampIfRoleChangedTx, roleForUpdateTx, ROLE_LOCK, returnVisitsToZoneTx, ROLE_LOST_REASON };
