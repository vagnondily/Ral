/**
 * Fil de calcul (worker_threads) du pool common/cpuPool : exécute une tâche PURE de
 * common/cpuTasks et rend son résultat (ou l'erreur, avec son statut HTTP s'il y en a un).
 * Aucun accès à la base ; une tâche à la fois par fil.
 */
const { parentPort } = require('node:worker_threads');
const { TASKS } = require('./cpuTasks');

parentPort.on('message', async ({ id, task, args }) => {
  try {
    const fn = TASKS[task];
    if (!fn) throw new Error(`Tâche de calcul inconnue : ${task}`);
    const result = await fn(...(args || []));
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: {
        message: String((err && err.message) || err),
        statusCode: err && Number.isInteger(err.statusCode) ? err.statusCode : null,
        details: err && err.details !== undefined ? safeClone(err.details) : undefined,
        name: err && err.name,
      },
    });
  }
});

/** Détails d'une erreur rendus clonables (une fonction ou un objet exotique ne passe pas). */
function safeClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return undefined; }
}
