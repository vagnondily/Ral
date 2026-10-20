const repo = require('./jobs.repository');
const machine = require('./jobMachine');
const { createRunner } = require('./jobs.runner');

/**
 * Tâches de fond — règles de l'API. Le compte vient TOUJOURS de req.auth (passé par
 * la route), jamais de la requête. L'exécuteur est démarré par server.js (pas dans les
 * tests ni dans le worker BullMQ) ; sans lui, une tâche reste en file jusqu'au prochain
 * démarrage de l'API.
 */

// Gestionnaires par type (chargés à la demande : pas de dépendance circulaire).
const HANDLERS = {
  get 'monitoring.import'() { return require('../monitoring/importJob'); },
  get 'monitoring.reapply'() { return require('../monitoring/reapplyJob'); },
};

let runner = null;

/** Démarre l'exécuteur intégré (une fois par processus). */
async function startRunner(opts = {}) {
  if (runner) return runner;
  runner = createRunner({ store: repo, handlers: HANDLERS, ...opts });
  await runner.start();
  return runner;
}

function stopRunner() { if (runner) runner.stop(); }

/** Met une tâche en file et réveille l'exécuteur. */
async function enqueue(tenantId, spec) {
  const job = await repo.enqueue(tenantId, spec);
  if (runner) runner.nudge();
  return job;
}

/** Une tâche du compte (avancement en mémoire si elle tourne ici), ou null. */
async function getJob(auth, id) {
  const row = await repo.get(auth.tenantId, id);
  return row ? machine.publicJob(row, runner ? runner.progressOf(id) : null) : null;
}

/** Tâches du compte en file, en cours, ou terminées depuis peu. */
async function listJobs(auth, opts) {
  const rows = await repo.list(auth.tenantId, opts);
  return rows.map((r) => machine.publicJob(r, runner ? runner.progressOf(r.id) : null));
}

module.exports = { startRunner, stopRunner, enqueue, getJob, listJobs, HANDLERS, runnerStats: () => (runner ? runner.stats() : null) };
