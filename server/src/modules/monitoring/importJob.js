const { AppError, notFound } = require('../../middleware/errors');
const repo = require('./monitoring.repository');
const jobsRepo = require('../jobs/jobs.repository');
const { readSubmissionsBuffer, fileColumns } = require('./submissionsFile');

/**
 * Tâche de fond « import de soumissions » (POST /api/monitoring/forms/:id/import → 202).
 * Les mêmes étapes et le MÊME résultat qu'avant, hors de la requête HTTP :
 *   1. lecture du fichier gardé avec la tâche, sur un fil de calcul ;
 *   2. écriture en UNE transaction withSubmissionLinks (verrou des rattachements du
 *      compte) : soumissions par lots, rattachements des lieux, sites, partenaires — et la
 *      tâche marquée « terminée » dans cette même transaction (tout ou rien) ;
 *   3. le résultat (reçues, ajoutées, mises à jour, mois, dates, état de la fiche) est
 *      celui que la requête rendait.
 * Le verrou des rattachements peut être attendu plus longtemps qu'une requête (10 min) :
 * la tâche ne bloque personne en attendant (connexion rendue entre deux essais).
 */
const LOCK_WAIT_MS = 10 * 60 * 1000;

async function run(job, ctx) {
  const { formId } = job.payload || {};
  ctx.progress({ step: 'read' });
  const input = await jobsRepo.loadInput(job.tenantId, job.id);
  if (!input) throw new AppError(410, 'Le fichier de cette tâche n\'est plus disponible : relancez l\'import.');
  const parsed = await readSubmissionsBuffer(input);
  const columns = fileColumns(parsed);
  const fields = columns.length;
  const result = await repo.importSubmissions(job.tenantId, formId, parsed.submissions, {
    variables: parsed.variables, headers: columns, waitMs: LOCK_WAIT_MS,
    onProgress: (p) => ctx.progress(p),
    beforeCommit: (client, r) => ctx.completeTx(client, { ...r, fields }),
  });
  if (!result) throw notFound('Formulaire introuvable');
  return { ...result, fields };
}

module.exports = { run, LOCK_WAIT_MS };
