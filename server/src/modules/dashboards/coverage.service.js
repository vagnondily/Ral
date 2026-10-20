const repo = require('./coverage.repository');
const { shapeCoverage } = require('./coverageDefinitions');
const { periodInfo } = require('../common/period');

/**
 * Mesures de couverture d'une période (retour 110) — UNE réponse pour la Synthèse du suivi de
 * processus et pour « Couverture & performance du suivi » : mêmes définitions, même univers,
 * mêmes chiffres (coverageDefinitions). Le compte vient TOUJOURS de req.auth (passé par le
 * contrôleur), jamais de la requête ; le dépôt ne fait que lire.
 */
/**
 * @param {{ period, officeId?: string|null, rbm?: boolean }} opts rbm : false = sans l'état RBM
 *   (`rbm: null` dans chaque groupe) — pour un appelant qui ne le lit pas (alertes).
 */
async function coverage(auth, { period, officeId = null, rbm = true }) {
  const { rows, refMonth } = await repo.coverageFacts(auth.tenantId, { period, officeId, ...(rbm ? {} : { rbm: false }) });
  return {
    period: periodInfo(period),
    officeId: officeId || null,
    ...shapeCoverage(rows, { refMonth, rbm }),
    computedAt: new Date().toISOString(),
  };
}

module.exports = { coverage };
