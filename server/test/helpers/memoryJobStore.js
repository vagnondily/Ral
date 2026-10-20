/**
 * Double EN MÉMOIRE de modules/jobs/jobs.repository, fidèle aux règles de la migration 081 :
 * une seule tâche en cours par compte (prise : la plus ancienne en file d'un compte sans tâche
 * en cours), coalescence des tâches en file (dedupe_key), passages queued → running → done |
 * failed seulement (une tâche terminée ne change plus), fichier supprimé à la fin, tâches
 * « en cours » de l'exécuteur ou au battement de cœur tu → échec « interrompue ».
 */
const { randomUUID } = require('node:crypto');
const { canTransition } = require('../../src/modules/jobs/jobMachine');

const INTERRUPTED = {
  statusCode: 503, code: 'interrupted',
  message: 'Tâche interrompue : le serveur s\'est arrêté pendant son exécution. Relancez-la.',
};

function createMemoryJobStore({ now = Date.now } = {}) {
  const jobs = new Map(); // id → ligne (camelCase, comme le dépôt)
  const inputs = new Map(); // id → Buffer
  let seq = 0;
  const calls = { setProgress: [], claim: 0 };

  function transition(job, to, patch = {}) {
    if (!canTransition(job.status, to)) {
      const e = new Error(`Tâche : passage ${job.status} → ${to} refusé.`);
      e.code = '23514';
      throw e;
    }
    Object.assign(job, patch, { status: to });
    if (to === 'done' || to === 'failed') { job.finishedAt = new Date(now()); inputs.delete(job.id); }
  }
  const copy = (j) => (j ? JSON.parse(JSON.stringify({ ...j, createdByName: j.createdBy ? `Utilisateur ${j.createdBy}` : null })) : null);

  const store = {
    jobs, inputs, calls,
    async enqueueTx(client, tenantId, { kind, payload = {}, dedupeKey = null, createdBy = null, input = null }) {
      if (dedupeKey != null) {
        const same = [...jobs.values()].find((j) => j.tenantId === tenantId && j.kind === kind && j.dedupeKey === dedupeKey && j.status === 'queued');
        if (same) return { id: same.id, status: same.status, deduped: true };
      }
      seq += 1;
      const job = {
        id: randomUUID(), tenantId, kind, status: 'queued', payload: JSON.parse(JSON.stringify(payload)), progress: {},
        result: null, error: null, dedupeKey, attempts: 0, runner: null, createdBy,
        createdAt: new Date(now() + seq), startedAt: null, heartbeatAt: null, finishedAt: null, seq,
      };
      jobs.set(job.id, job);
      if (input) inputs.set(job.id, Buffer.from(input));
      return { id: job.id, status: job.status, deduped: false };
    },
    async enqueue(tenantId, spec) { return store.enqueueTx(null, tenantId, spec); },
    async claim(runner) {
      calls.claim += 1;
      const busy = new Set([...jobs.values()].filter((j) => j.status === 'running').map((j) => j.tenantId));
      const next = [...jobs.values()].filter((j) => j.status === 'queued' && !busy.has(j.tenantId)).sort((a, b) => a.seq - b.seq)[0];
      if (!next) return null;
      transition(next, 'running', { startedAt: new Date(now()), heartbeatAt: new Date(now()), runner, attempts: next.attempts + 1 });
      return copy(next);
    },
    async heartbeat(runner, ids) {
      let n = 0;
      for (const id of ids) {
        const j = jobs.get(id);
        if (j && j.runner === runner && j.status === 'running') { j.heartbeatAt = new Date(now()); n += 1; }
      }
      return n;
    },
    async failStale(runner, staleSeconds) {
      let n = 0;
      const limit = now() - Math.max(staleSeconds, 30) * 1000;
      for (const j of jobs.values()) {
        if (j.status !== 'running') continue;
        if ((runner != null && j.runner === runner) || (j.heartbeatAt && j.heartbeatAt.getTime() < limit)) {
          transition(j, 'failed', { error: { ...INTERRUPTED } });
          n += 1;
        }
      }
      return n;
    },
    async purge() { return 0; },
    async setProgress(tenantId, id, progress) {
      calls.setProgress.push({ id, progress });
      const j = jobs.get(id);
      if (!j || j.tenantId !== tenantId || j.status !== 'running') return 0;
      j.progress = progress; j.heartbeatAt = new Date(now());
      return 1;
    },
    async completeTx(client, tenantId, id, result) {
      const j = jobs.get(id);
      if (!j || j.tenantId !== tenantId || j.status !== 'running') return 0;
      transition(j, 'done', { result: result === undefined ? null : JSON.parse(JSON.stringify(result)), progress: { ...j.progress, step: 'done' } });
      return 1;
    },
    async complete(tenantId, id, result) { return store.completeTx(null, tenantId, id, result); },
    async fail(tenantId, id, error) {
      const j = jobs.get(id);
      if (!j || j.tenantId !== tenantId || !['queued', 'running'].includes(j.status)) return 0;
      transition(j, 'failed', { error });
      return 1;
    },
    async get(tenantId, id) { const j = jobs.get(id); return j && j.tenantId === tenantId ? copy(j) : null; },
    async list(tenantId) {
      return [...jobs.values()].filter((j) => j.tenantId === tenantId).sort((a, b) => b.seq - a.seq).map(copy);
    },
    async loadInput(tenantId, id) { const j = jobs.get(id); return j && j.tenantId === tenantId ? (inputs.get(id) || null) : null; },
  };
  return store;
}

/** Remplace les fonctions du module jobs.repository par celles du double (rend la remise en état). */
function installMemoryJobStore(repoModule, store) {
  const saved = {};
  for (const k of Object.keys(repoModule)) {
    if (typeof store[k] === 'function') { saved[k] = repoModule[k]; repoModule[k] = store[k]; }
  }
  return () => { Object.assign(repoModule, saved); };
}

module.exports = { createMemoryJobStore, installMemoryJobStore, INTERRUPTED };
