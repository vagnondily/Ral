const { withTenantTransaction } = require('../../config/db');
const { MONITORING_LINE } = require('../contracts/budgetCatalog');
const { providerContractsCte, monitoringContractSql } = require('./activeProviderSql');
const { selectableProviders, activeProviders } = require('./activeProvider');
const { contractTpmViews } = require('./contractTpm');

/**
 * « Prestataire actif » (retour 30) — lecture des entrées de la règle pure
 * (activeProvider.js) : liens prestataire ↔ contrat et fiches partenaires. Chaque
 * requête filtre tenant_id = $1 et tourne sous withTenantTransaction (RLS en plus).
 */

/**
 * Liens prestataire ↔ contrat (titulaire, plan, rapport, visite), un par (prestataire, contrat),
 * avec les dates et le statut du contrat et le booléen « contrat de suivi ».
 * @param {{ partnerId?: string|null }} [opts]  un seul prestataire (fiche 360°)
 */
async function providerLinksTx(client, tenantId, { partnerId = null } = {}) {
  const { rows } = await client.query(
    `WITH ${providerContractsCte()}
     SELECT pc.partner_id AS "partnerId", c.id AS "contractId", c.numero, c.numero_fla AS "numeroFla", c.status,
            c.date_debut AS "dateDebut", c.date_fin AS "dateFin", c.termination_date AS "terminationDate",
            c.partner_id AS "holderId", c.partner_name AS "holderName",
            ${monitoringContractSql('c', '$2')} AS monitoring,
            array_agg(DISTINCT pc.via) AS via
       FROM provider_contracts pc
       JOIN contracts c ON c.id = pc.contract_id AND c.tenant_id = $1
      WHERE ($3::uuid IS NULL OR pc.partner_id = $3::uuid)
      GROUP BY pc.partner_id, c.id
      ORDER BY c.numero`,
    [tenantId, MONITORING_LINE, partnerId]);
  return rows;
}

/** Partenaires (fiche, type, actif) pour les listes de choix. */
async function partnersTx(client, tenantId) {
  const { rows } = await client.query(
    `SELECT p.id, p.name, p.short_name AS "shortName", t.code AS "typeCode", p.active
       FROM partners p JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 ORDER BY p.name`, [tenantId]);
  return rows;
}

/**
 * TPM de chaque contrat pour l'affichage (retour 113, règle pure tpm/contractTpm) : liens et
 * partenaires du compte lus une fois. @param {Array<{ id, partnerId }>} contracts
 */
async function contractTpmViewsTx(client, tenantId, contracts) {
  const links = await providerLinksTx(client, tenantId);
  const partners = await partnersTx(client, tenantId);
  return { views: contractTpmViews(contracts, links, partners), links, partners };
}

const NOT_TPM_MESSAGE = 'Ce partenaire n\'est pas un TPM actif : un plan de collecte ou une facture se rattache à une tierce partie de suivi (type « TPM », fiche active).';

/**
 * Un plan de collecte ou une facture ne se crée QUE pour un TPM actif (décision D1 du 20/10) :
 * sinon erreur `code: 'NOT_TPM'` (les routes répondent 400). La base le contrôle aussi (type
 * « tpm », migration 089). À appeler dans la transaction qui écrit le document.
 */
async function assertActiveTpmTx(client, tenantId, partnerId) {
  const { rows } = await client.query(
    `SELECT p.active, t.code FROM partners p JOIN partner_types t ON t.id = p.partner_type_id AND t.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.id = $2`, [tenantId, partnerId]);
  if (!rows.length || rows[0].code !== 'tpm' || rows[0].active === false) {
    const e = new Error(NOT_TPM_MESSAGE); e.code = 'NOT_TPM'; throw e;
  }
}

/** Listes de choix pour des mois : groupes « contrat » puis « tpm » (activeProvider.selectableProviders). */
async function selectable(tenantId, months) {
  return withTenantTransaction(tenantId, async (client) => {
    const links = await providerLinksTx(client, tenantId);
    const partners = await partnersTx(client, tenantId);
    return selectableProviders({ links, partners, months });
  });
}

/** Prestataires actifs au mois M (identifiants + contrats couvrants). */
async function activeAt(tenantId, month) {
  return withTenantTransaction(tenantId, async (client) => {
    const links = await providerLinksTx(client, tenantId);
    const partners = await partnersTx(client, tenantId);
    return activeProviders({ links, partners, month });
  });
}

module.exports = { providerLinksTx, partnersTx, contractTpmViewsTx, assertActiveTpmTx, NOT_TPM_MESSAGE, selectable, activeAt };
