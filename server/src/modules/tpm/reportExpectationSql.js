/**
 * Rapports attendus (retour 114) — fragment SQL, jumeau de reportExpectation.tpmStatus pour un document
 * stocké : un gabarit « attendu » (POST /reports/generate-monthly, ou rapport jamais rempli) dont le TPM ne
 * porte AUCUNE visite non annulée sur son contrat pendant ses mois ([period_month, period_end]) est
 * « non applicable » d'office — la même règle pour la carte « Rapports attendus », la liste des rapports
 * et les compteurs de la fiche 360°. Rien n'est écrit : dès qu'une visite est prévue, il redevient attendu.
 * @param {string} r  alias de tpm_reports
 */
const stubNotApplicableSql = (r = 'r') => `(${r}.status = 'attendu' AND NOT EXISTS (
    SELECT 1 FROM site_visits sv
     WHERE sv.tenant_id = ${r}.tenant_id AND sv.provider_id = ${r}.partner_id AND sv.contract_id = ${r}.contract_id
       AND sv.status <> 'annule' AND sv.period_month BETWEEN ${r}.period_month AND COALESCE(${r}.period_end, ${r}.period_month)))`;

module.exports = { stubNotApplicableSql };
