const { notFound } = require('../../middleware/errors');
const repo = require('./monitoring.repository');
const { LOCK_WAIT_MS } = require('./importJob');

/**
 * Tâche de fond « réappliquer le mapping » (POST /api/monitoring/forms/:id/mems-mapping/apply
 * → 202) : la MÊME réapplication qu'avant (colonnes relues, mois de collecte recalculés,
 * rattachements rejoués), en UNE transaction withSubmissionLinks où la tâche est aussi marquée
 * terminée (tout ou rien). Le résultat est celui que rendait la requête.
 */
async function run(job, ctx) {
  const { formId } = job.payload || {};
  if (!(await repo.formLabel(job.tenantId, formId))) throw notFound('Fiche introuvable');
  return repo.applyMappingToSubmissions(job.tenantId, formId, {
    waitMs: LOCK_WAIT_MS,
    onProgress: (p) => ctx.progress(p),
    beforeCommit: (client, result) => ctx.completeTx(client, result),
  });
}

module.exports = { run };
