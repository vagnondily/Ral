const { DUE_MONTHS_AFTER } = require('./reportExpectation');

/**
 * Jumeau SQL de la branche D-b de reportExpectation.tpmStatus (relecture des corrections croisées,
 * point 2) : le partenaire d'un gabarit « attendu » n'est plus de type TPM (fiche retypée en partenaire
 * de mise en œuvre) — on n'attend plus de facture de lui. La fiche INACTIVE d'un TPM n'y entre pas :
 * il reste attendu pour les mois qu'il a servis (décision D-b).
 * @param {string} r  alias de tpm_reports
 */
const stubNotTpmSql = (r = 'r') => `(${r}.status = 'attendu' AND NOT EXISTS (
    SELECT 1 FROM partners sp JOIN partner_types st ON st.tenant_id = sp.tenant_id AND st.id = sp.partner_type_id
     WHERE sp.tenant_id = ${r}.tenant_id AND sp.id = ${r}.partner_id AND st.code = 'tpm'))`;

/**
 * Rapports attendus (retour 114) — fragment SQL, jumeau de reportExpectation.tpmStatus pour un document
 * stocké : un gabarit « attendu » (POST /reports/generate-monthly, ou rapport jamais rempli) dont le TPM ne
 * porte AUCUNE visite non annulée sur son contrat pendant ses mois ([period_month, period_end]), ou dont le
 * partenaire n'est plus de type TPM (D-b, stubNotTpmSql), est « non applicable » d'office — la même règle
 * pour la carte « Rapports attendus », la liste des rapports et les compteurs de la fiche 360°. Rien n'est
 * écrit : dès qu'une visite est prévue (ou le partenaire redevenu TPM), il redevient attendu.
 * @param {string} r  alias de tpm_reports
 */
const stubNotApplicableSql = (r = 'r') => `(${stubNotTpmSql(r)} OR (${r}.status = 'attendu' AND NOT EXISTS (
    SELECT 1 FROM site_visits sv
     WHERE sv.tenant_id = ${r}.tenant_id AND sv.provider_id = ${r}.partner_id AND sv.contract_id = ${r}.contract_id
       AND sv.status <> 'annule' AND sv.period_month BETWEEN ${r}.period_month AND COALESCE(${r}.period_end, ${r}.period_month))))`;

/**
 * Jumeau SQL de l'ÉCHÉANCE de reportExpectation.tpmStatus (relecture croisée, point 15) : un gabarit
 * « attendu » qui n'est pas « non applicable » d'office et dont la date limite est dépassée — le rapport du
 * mois M se remet au plus tard au cours de M + DUE_MONTHS_AFTER ; au-delà, « en retard » — comme la carte
 * « Rapports attendus » et la cloche, dans la liste des rapports et sur la fiche 360°. Le dernier mois du
 * gabarit ([period_month, period_end]) fixe l'échéance.
 * @param {string} r      alias de tpm_reports
 * @param {string} today  mois courant LOCAL de l'application, « AAAA-MM » (rbmMath.currentMonth) — écrit
 *                        en littéral (contrôlé ici), jamais la date de la session (UTC)
 */
function stubLateSql(r = 'r', today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(today))) throw new Error('stubLateSql : mois courant attendu (AAAA-MM)');
  return `(${r}.status = 'attendu' AND NOT ${stubNotApplicableSql(r)}
    AND COALESCE(${r}.period_end, ${r}.period_month) + interval '${DUE_MONTHS_AFTER} month' < '${today}-01'::date)`;
}

module.exports = { stubNotApplicableSql, stubNotTpmSql, stubLateSql };
