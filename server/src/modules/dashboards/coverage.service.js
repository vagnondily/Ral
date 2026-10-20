const repo = require('./coverage.repository');
const { shapeCoverage } = require('./coverageDefinitions');
const { periodInfo } = require('../common/period');

/**
 * Mesures de couverture d'une période (retour 110) — UNE réponse pour la Synthèse du suivi de
 * processus et pour « Couverture & performance du suivi » : mêmes définitions, même univers,
 * mêmes chiffres (coverageDefinitions). Le compte vient TOUJOURS de req.auth (passé par le
 * contrôleur), jamais de la requête ; le dépôt ne fait que lire.
 */
async function coverage(auth, { period, officeId = null, activity = null }) {
  const { rows, refMonth } = await repo.coverageFacts(auth.tenantId, { period, officeId, activity });
  return {
    period: periodInfo(period),
    officeId: officeId || null,
    activity: activity || null,
    ...shapeCoverage(rows, { refMonth }),
    computedAt: new Date().toISOString(),
  };
}

module.exports = { coverage };
