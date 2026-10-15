/**
 * « Prestataire actif » (retour 30) — fragments SQL, jumeaux de activeProvider.js (mêmes
 * règles ; parité vérifiée par test/activeProvider.test.js sur le texte des prédicats).
 * À utiliser par tout écran qui filtre ou trie des prestataires selon leurs contrats (plan de
 * suivi, affectation, planification, rapports attendus, évaluations…) : ne pas réécrire la règle.
 *
 * Paramètres : le tenant est TOUJOURS `$1` (chaque sous-requête filtre tenant_id = $1, RLS en
 * plus) ; la ligne de suivi (MONITORING_LINE) est passée par l'appelant (`lineParam`).
 */

/**
 * CTE `provider_contracts(partner_id, contract_id, via)` : un prestataire est rattaché à un
 * contrat comme titulaire, ou par un plan de collecte, un rapport / une facture ou une visite
 * qui porte ce contrat. À placer dans un WITH. Une ligne par (prestataire, contrat, origine).
 */
function providerContractsCte() {
  return `provider_contracts AS (
       SELECT c.partner_id AS partner_id, c.id AS contract_id, 'titulaire'::text AS via
         FROM contracts c WHERE c.tenant_id = $1 AND c.partner_id IS NOT NULL
       UNION
       SELECT pl.partner_id, pl.contract_id, 'plan' FROM tpm_collection_plans pl WHERE pl.tenant_id = $1
       UNION
       SELECT r.partner_id, r.contract_id, 'rapport' FROM tpm_reports r WHERE r.tenant_id = $1
       UNION
       SELECT DISTINCT v.provider_id, v.contract_id, 'visite' FROM site_visits v
        WHERE v.tenant_id = $1 AND v.provider_id IS NOT NULL AND v.contract_id IS NOT NULL)`;
}

/**
 * Le contrat `alias` couvre-t-il le mois `monthExpr` (une date au 1er du mois) ?
 * « actif » : mois(début) ≤ M ≤ mois(fin) ; « résilié » : mois(début) ≤ M ≤ mois(résiliation).
 */
function contractCoversMonthSql(alias, monthExpr) {
  const a = `${alias}.`;
  return `((${a}status = 'actif' AND date_trunc('month', ${a}date_debut) <= ${monthExpr} AND ${monthExpr} <= date_trunc('month', ${a}date_fin))
        OR (${a}status = 'resilie' AND ${a}termination_date IS NOT NULL
            AND date_trunc('month', ${a}date_debut) <= ${monthExpr} AND ${monthExpr} <= date_trunc('month', ${a}termination_date)))`;
}

/** Le contrat `alias` est-il un contrat de suivi (ligne IV.suivi > 0) ? */
function monitoringContractSql(alias, lineParam) {
  return `(COALESCE((SELECT sum(b.unit_count * b.unit_cost) FROM contract_budget_items b
                     WHERE b.tenant_id = ${alias}.tenant_id AND b.contract_id = ${alias}.id AND b.line_code = ${lineParam}), 0) > 0)`;
}

/**
 * Prédicat « le prestataire `partnerExpr` est actif au mois `monthExpr` » (EXISTS), avec la CTE
 * provider_contracts dans le WITH de la requête.
 */
function providerActiveSql(partnerExpr, monthExpr, lineParam) {
  return `EXISTS (SELECT 1 FROM provider_contracts pc JOIN contracts c ON c.id = pc.contract_id AND c.tenant_id = $1
                  WHERE pc.partner_id = ${partnerExpr} AND ${contractCoversMonthSql('c', monthExpr)}
                    AND ${monitoringContractSql('c', lineParam)})`;
}

module.exports = { providerContractsCte, contractCoversMonthSql, monitoringContractSql, providerActiveSql };
