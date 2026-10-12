/**
 * Règles PURES de décision sur un rapport TPM (facture ou rapport technique).
 * Seul un rapport « soumis » se valide ou se rejette, et jamais par la personne
 * qui l'a soumis (séparation des tâches, comme pour les contrats).
 */
const DECIDABLE = 'soumis';

/**
 * @param {{ status: string, createdBy: string }} report
 * @param {string} actorId  utilisateur qui décide
 * @returns {null | { code: 'status' | 'self', message: string }}
 */
function decisionError(report, actorId) {
  if (report.status !== DECIDABLE) {
    return { code: 'status', message: `Seul un rapport soumis peut être validé ou rejeté (statut actuel : ${report.status}).` };
  }
  if (report.createdBy && report.createdBy === actorId) {
    return { code: 'self', message: 'Séparation des tâches : un rapport ne peut pas être validé ou rejeté par la personne qui l\'a soumis.' };
  }
  return null;
}

module.exports = { decisionError, DECIDABLE };
