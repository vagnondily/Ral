const os = require('node:os');
const logger = require('../../config/logger');
const { runInBackground } = require('../../config/db');
const machine = require('./jobMachine');
const { AppError } = require('../../middleware/errors');

/**
 * Exécuteur de tâches de fond INTÉGRÉ à l'API (sans Redis) — performance, retours 61, 84, 95.
 *
 *  - prend les tâches en file (store.claim : FOR UPDATE SKIP LOCKED, une seule en cours par
 *    compte grâce à l'index unique) ; au plus `maxConcurrent` (2) à la fois ;
 *  - chaque tâche tourne dans runInBackground : ses transactions passent par le sémaphore
 *    des connexions de fond (le tiers du pool) ;
 *  - avancement en mémoire (lu par l'API) et en base au plus une fois par seconde ;
 *  - battement de cœur toutes les 15 s ; au démarrage, une tâche restée « en cours » par ce
 *    même exécuteur (arrêt pendant son exécution) est marquée en échec avec un message
 *    clair, comme toute tâche dont le battement s'est tu depuis `staleSeconds` ;
 *  - une erreur garde la forme de la réponse HTTP (jobMachine.errorRecord) ;
 *  - tout ou rien : une tâche réussie est marquée « terminée » dans la transaction de son
 *    écriture quand le gestionnaire le demande (ctx.completeTx), sinon juste après ; si elle
 *    n'est plus « en cours » à ce moment (déclarée interrompue entre-temps), ctx.completeTx
 *    lève une erreur et l'écriture est annulée : une tâche en échec n'a jamais rien écrit.
 *
 * `store` : jobs.repository (ou un double en mémoire dans les tests).
 * `handlers` : { [kind]: { run(job, ctx) } }.
 */
function createRunner({
  store, handlers,
  runner = machine.runnerIdentity(os.hostname(), process.env.PORT),
  maxConcurrent = machine.maxConcurrent(),
  pollMs = 2000, heartbeatMs = 15000, staleSeconds = 90, sweepMs = 60000, purgeDays = 7, purgeMs = 3600000,
  progressEveryMs = 1000, log = logger, inBackground = runInBackground, now = Date.now,
} = {}) {
  const running = new Map(); // id → { job, progress, last, promise }
  const timers = [];
  let stopped = true;
  let busy = false;
  let again = false;

  async function tick() {
    if (stopped) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      while (!stopped && running.size < maxConcurrent) {
        const job = await store.claim(runner);
        if (!job) break;
        start(job);
      }
    } catch (err) {
      log.warn({ err }, 'tâches de fond : prise impossible');
    } finally {
      busy = false;
      if (again) { again = false; setImmediate(tick); }
    }
  }

  function start(job) {
    const entry = { job, progress: job.progress || {}, last: null, promise: null };
    running.set(job.id, entry);
    entry.promise = inBackground(() => execute(entry))
      .catch((err) => log.error({ err, jobId: job.id }, 'tâche de fond : erreur non traitée'))
      .finally(() => { running.delete(job.id); tick(); });
  }

  function reportProgress(entry, p) {
    const rec = machine.progressRecord(p);
    entry.progress = rec;
    const t = now();
    if (!machine.shouldPersistProgress(entry.last, rec, t, progressEveryMs)) return;
    entry.last = { progress: rec, at: t };
    Promise.resolve(store.setProgress(entry.job.tenantId, entry.job.id, rec)).catch(() => {});
  }

  async function execute(entry) {
    const { job } = entry;
    const handler = handlers[job.kind];
    const t0 = now();
    if (!handler) {
      await store.fail(job.tenantId, job.id, { statusCode: 500, message: 'Type de tâche inconnu.' });
      return;
    }
    const ctx = {
      progress: (p) => reportProgress(entry, p),
      completeTx: async (client, result) => {
        const n = await store.completeTx(client, job.tenantId, job.id, result === undefined ? null : result);
        if (!n) throw new AppError(409, 'Tâche déjà close (interrompue) : rien n\'a été écrit. Relancez-la.');
        return n;
      },
    };
    try {
      const result = await handler.run(job, ctx);
      await store.complete(job.tenantId, job.id, result === undefined ? null : result); // sans effet si déjà terminée
      log.info({ jobId: job.id, kind: job.kind, ms: now() - t0 }, 'tâche de fond terminée');
    } catch (err) {
      const rec = machine.errorRecord(err);
      if (rec.statusCode >= 500) log.error({ err, jobId: job.id, kind: job.kind }, 'tâche de fond en échec');
      else log.info({ jobId: job.id, kind: job.kind, statusCode: rec.statusCode }, 'tâche de fond refusée');
      await store.fail(job.tenantId, job.id, rec).catch((e) => log.error({ err: e, jobId: job.id }, 'échec de tâche non enregistré'));
    }
  }

  const every = (ms, fn) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); timers.push(t); };

  return {
    runner,
    /** Démarre : tâches interrompues → échec, puis prise des tâches en file. */
    async start() {
      if (!stopped) return;
      stopped = false;
      try {
        const n = await store.failStale(runner, staleSeconds);
        if (n) log.warn({ n }, 'tâches interrompues par l\'arrêt du serveur : marquées en échec');
      } catch (err) { log.warn({ err }, 'tâches de fond : contrôle de démarrage impossible'); }
      every(pollMs, tick);
      every(heartbeatMs, () => { Promise.resolve(store.heartbeat(runner, [...running.keys()])).catch(() => {}); });
      every(sweepMs, () => { Promise.resolve(store.failStale(null, staleSeconds)).catch(() => {}); });
      every(purgeMs, () => { Promise.resolve(store.purge(purgeDays)).catch(() => {}); });
      await tick();
    },
    /** Arrête de prendre des tâches (celles en cours se terminent). */
    stop() { stopped = true; for (const t of timers.splice(0)) clearInterval(t); },
    /** Une tâche vient d'être mise en file : la prendre sans attendre le prochain tour. */
    nudge() { if (!stopped) setImmediate(tick); },
    /** Avancement en mémoire d'une tâche en cours dans ce processus (plus récent que la base). */
    progressOf(id) { const e = running.get(id); return e ? e.progress : null; },
    /** Attend que la file soit vide et que plus rien ne tourne (tests). */
    async drain() {
      for (let i = 0; i < 10000; i += 1) {
        await tick();
        const list = [...running.values()].map((e) => e.promise);
        if (!list.length && !busy) return;
        await Promise.all(list);
        await new Promise((r) => { setImmediate(r); });
      }
    },
    stats() { return { runner, running: running.size, maxConcurrent, stopped }; },
  };
}

module.exports = { createRunner };
