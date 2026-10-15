const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { AppError } = require('../../middleware/errors');
const { TASKS } = require('./cpuTasks');

/**
 * Pool de fils de calcul (worker_threads), sans dépendance — performance, retours 61, 84, 95.
 *
 * Node exécute le JavaScript d'une requête sur UN fil : lire un classeur Excel de 5 000
 * lignes (12 s de calcul) faisait attendre toutes les autres requêtes, même les plus
 * légères. Les calculs PURS (common/cpuTasks : lecture de fichiers) passent ici, sur un
 * fil à part ; le fil principal reste libre pour répondre.
 *
 *  - taille : CPU_POOL_SIZE, sinon min(2, cœurs − 1) (au moins 1) ; 0 = calcul sur le fil
 *    principal (tests, dépannage) ;
 *  - file d'attente FIFO bornée (`maxQueue`) : au-delà, 503 « réessayez » plutôt qu'une
 *    accumulation de fichiers en mémoire ;
 *  - délai maximal par tâche (`timeoutMs`, CPU_TASK_TIMEOUT_MS) : le fil est arrêté et
 *    remplacé, la requête reçoit un 503 ;
 *  - un fichier part SANS copie (ArrayBuffer transféré, option `transfer`) ;
 *  - une erreur métier garde son statut (400, 413…) ; un fil qui tombe (mémoire dépassée)
 *    est remplacé et la requête reçoit un 413 explicite — jamais l'API entière à terre.
 */
function defaultSize(env = process.env, cpus = os.cpus().length) {
  if (env.CPU_POOL_SIZE !== undefined && String(env.CPU_POOL_SIZE).trim() !== '') {
    const n = Number(env.CPU_POOL_SIZE);
    if (Number.isInteger(n) && n >= 0 && n <= 16) return n;
  }
  return Math.min(2, Math.max(1, cpus - 1));
}

function defaultTimeoutMs(env = process.env) {
  const n = Number(env.CPU_TASK_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 ? n : 5 * 60_000;
}

const OOM = 'Fichier trop volumineux pour être lu : la mémoire réservée à la lecture est dépassée. '
  + 'Découpez le fichier (moins de lignes ou de colonnes), puis réessayez.';
const BUSY = 'Le serveur lit déjà beaucoup de fichiers : réessayez dans un instant.';

/**
 * Erreur du POOL lui-même (occupé, délai dépassé, fil arrêté, mémoire dépassée) — et non de la
 * tâche : marquée `pool = true`, pour qu'un appelant qui transforme les erreurs de lecture en
 * « fichier illisible » (400) la laisse passer telle quelle.
 */
function poolError(statusCode, message) {
  const e = statusCode ? new AppError(statusCode, message) : new Error(message);
  e.pool = true;
  return e;
}

/** Erreur reçue d'un fil → AppError (statut 4xx / 5xx gardé) ou erreur interne (500). */
function errorFrom(e) {
  if (e && Number.isInteger(e.statusCode) && e.statusCode >= 400 && e.statusCode < 600) return new AppError(e.statusCode, e.message, e.details);
  return new Error((e && e.message) || 'Erreur de calcul');
}

/**
 * ArrayBuffer à transférer contenant EXACTEMENT les octets de `buf` : le sien s'il lui est
 * propre (transféré sans copie : `buf` devient vide), sinon une copie (Buffer pris dans
 * une plage partagée — le transférer viderait d'autres Buffer).
 */
function transferable(buf) {
  if (buf instanceof ArrayBuffer) return buf;
  if (ArrayBuffer.isView(buf)) {
    if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength && !(buf.buffer instanceof SharedArrayBuffer)) return buf.buffer;
    const copy = new ArrayBuffer(buf.byteLength);
    new Uint8Array(copy).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    return copy;
  }
  return null;
}

function createCpuPool({
  size = defaultSize(), maxQueue = 32, timeoutMs = defaultTimeoutMs(),
  workerFile = path.join(__dirname, 'cpuWorker.js'), resourceLimits, tasks = TASKS,
} = {}) {
  const slots = [];
  const queue = [];
  let seq = 0;
  let closed = false;
  const counters = { done: 0, failed: 0, timeouts: 0, crashes: 0, rejectedBusy: 0, maxQueued: 0 };

  function spawn() {
    const slot = { worker: new Worker(workerFile, resourceLimits ? { resourceLimits } : undefined), job: null };
    slot.worker.on('message', (m) => { if (slot.job && m && m.id === slot.job.id) settle(slot, m.ok ? null : errorFrom(m.error), m.result); });
    slot.worker.on('error', (err) => {
      counters.crashes += 1;
      if (slot.job) settle(slot, err && err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? poolError(413, OOM) : poolError(null, `Le calcul s'est arrêté : ${err && err.message}`));
    });
    slot.worker.on('exit', () => {
      if (slot.job) settle(slot, poolError(null, 'Le fil de calcul s\'est arrêté.'));
      retire(slot); // déjà retiré (délai dépassé) : rien de plus
    });
    // Un fil au repos ne garde pas le processus en vie (après les écouteurs, qui le référencent).
    slot.worker.unref();
    slots.push(slot);
    return slot;
  }

  /** Fil retiré du pool (arrêté ou à arrêter) et remplacé ; plus aucune tâche ne lui est confiée. */
  function retire(slot) {
    const i = slots.indexOf(slot);
    if (i < 0) return;
    slots.splice(i, 1);
    if (!closed) { spawn(); pump(); }
  }

  function settle(slot, err, result) {
    const job = slot.job;
    if (!job) return;
    slot.job = null;
    clearTimeout(job.timer);
    slot.worker.unref();
    if (err) { counters.failed += 1; job.reject(err); } else { counters.done += 1; job.resolve(result); }
    pump();
  }

  function dispatch(slot, job) {
    slot.job = job;
    slot.worker.ref(); // une tâche en cours garde le processus en vie (scripts, tests)
    job.timer = setTimeout(() => {
      counters.timeouts += 1;
      const s = Math.round(job.timeoutMs / 1000);
      const i = slots.indexOf(slot);
      if (i >= 0) slots.splice(i, 1); // plus aucune tâche pour ce fil, qui va être arrêté
      settle(slot, poolError(503, `Calcul trop long (plus de ${s} s) : réessayez, ou découpez le fichier.`));
      slot.worker.terminate().catch(() => {});
      if (!closed) { spawn(); pump(); } // remplaçant tout de suite
    }, job.timeoutMs);
    const list = [];
    const args = job.args.map((a) => {
      if (!job.transfer || !(a instanceof ArrayBuffer || ArrayBuffer.isView(a))) return a;
      const ab = transferable(a);
      list.push(ab);
      return ab;
    });
    try {
      slot.worker.postMessage({ id: job.id, task: job.task, args }, list);
    } catch (err) {
      settle(slot, err);
    }
  }

  function pump() {
    while (queue.length) {
      const free = slots.find((s) => !s.job);
      if (!free) return;
      dispatch(free, queue.shift());
    }
  }

  /**
   * Exécute la tâche `task` (common/cpuTasks) avec `args` sur un fil libre.
   * @param {string} task
   * @param {any[]} [args]
   * @param {{ transfer?: boolean, timeoutMs?: number }} [opts] transfer : les Buffer / ArrayBuffer
   *   des arguments sont TRANSFÉRÉS (sans copie quand c'est sûr ; l'appelant ne les relit plus).
   * @returns {Promise<any>}
   */
  function run(task, args = [], { transfer = false, timeoutMs: t = timeoutMs } = {}) {
    if (closed) return Promise.reject(new Error('Pool de calcul fermé.'));
    if (!tasks[task]) return Promise.reject(new Error(`Tâche de calcul inconnue : ${task}`));
    if (size === 0) return Promise.resolve().then(() => tasks[task](...args)); // sans fil (tests, dépannage)
    if (!slots.length) for (let i = 0; i < size; i += 1) spawn();
    return new Promise((resolve, reject) => {
      const job = { id: (seq += 1), task, args, transfer, timeoutMs: t, resolve, reject, timer: null };
      const free = slots.find((s) => !s.job);
      if (free) { dispatch(free, job); return; }
      if (queue.length >= maxQueue) { counters.rejectedBusy += 1; reject(poolError(503, BUSY)); return; }
      queue.push(job);
      counters.maxQueued = Math.max(counters.maxQueued, queue.length);
    });
  }

  function stats() {
    return { size, busy: slots.filter((s) => s.job).length, queued: queue.length, ...counters };
  }

  async function close() {
    closed = true;
    for (const job of queue.splice(0)) job.reject(new Error('Pool de calcul fermé.'));
    await Promise.all(slots.map((s) => s.worker.terminate().catch(() => {})));
  }

  return { run, stats, close, size };
}

// Pool partagé du processus (créé au premier besoin).
let shared = null;
function cpuPool() {
  if (!shared) shared = createCpuPool();
  return shared;
}
/** Tâche sur le pool partagé. */
const runCpu = (task, args, opts) => cpuPool().run(task, args, opts);

module.exports = { createCpuPool, cpuPool, runCpu, defaultSize, defaultTimeoutMs, transferable, errorFrom, poolError };
