/**
 * Fil de calcul (worker_threads) du pool common/cpuPool : exécute une tâche PURE de
 * common/cpuTasks et rend son résultat (ou l'erreur, avec son statut HTTP s'il y en a un) —
 * en un message, ou par paquets pour un grand tableau (option `chunk` de la tâche).
 * Aucun accès à la base ; une tâche à la fois par fil.
 */
const { parentPort } = require('node:worker_threads');
const { TASKS } = require('./cpuTasks');

// Accusé de réception attendu du fil principal (résultat envoyé par paquets).
let pendingAck = null;

parentPort.on('message', async (msg) => {
  if (msg && msg.ack !== undefined) {
    if (pendingAck && pendingAck.id === msg.ack) { const { resolve } = pendingAck; pendingAck = null; resolve(); }
    return;
  }
  const { id, task, args, chunk } = msg || {};
  try {
    const fn = TASKS[task];
    if (!fn) throw new Error(`Tâche de calcul inconnue : ${task}`);
    const result = await fn(...(args || []));
    const items = chunk && result ? result[chunk.field] : null;
    if (Array.isArray(items) && items.length > chunk.size) {
      // Résultat volumineux (5 000 soumissions × 480 réponses) : envoyé PAR PAQUETS, chacun après
      // l'accusé de réception du précédent. Le fil principal décode un paquet à la fois et sert les
      // autres requêtes entre deux — jamais 0,3 à 0,5 s d'un bloc pour tout recevoir.
      const head = { ...result };
      delete head[chunk.field];
      for (let i = 0; i < items.length; i += chunk.size) {
        const acked = new Promise((resolve) => { pendingAck = { id, resolve }; });
        parentPort.postMessage({ id, part: items.slice(i, i + chunk.size) });
        await acked;
      }
      parentPort.postMessage({ id, ok: true, result: head, chunked: chunk.field });
      return;
    }
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
