const { describeError } = require('../../middleware/errors');

/**
 * Tâches de fond — règles PURES (sans E/S), testées (test/jobMachine.test.js). La base
 * applique les mêmes règles (migration 081 : contraintes, index unique, déclencheur).
 *
 *   queued ──► running ──► done
 *     │           │
 *     └──► failed ◄┘
 *
 * Une tâche terminée (done, failed) ne change plus. Au plus une tâche en cours par compte
 * et MAX_CONCURRENT au total dans un processus.
 */
const STATUSES = ['queued', 'running', 'done', 'failed'];
const TRANSITIONS = { queued: ['running', 'failed'], running: ['done', 'failed'], done: [], failed: [] };
const MAX_CONCURRENT = 2;
const PER_TENANT = 1;

const isTerminal = (status) => status === 'done' || status === 'failed';
const isActive = (status) => status === 'queued' || status === 'running';
const canTransition = (from, to) => Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));

/** Concurrence de l'exécuteur : `maxConcurrent` (JOBS_CONCURRENCY), 1 à 4, 2 par défaut. */
function maxConcurrent(env = process.env) {
  const n = Number(env.JOBS_CONCURRENCY);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : MAX_CONCURRENT;
}

/**
 * Peut-on démarrer une tâche de ce compte ? (garde de l'exécuteur, en plus de l'index unique)
 * @param {Map<string, {tenantId:string}>|Array<{tenantId:string}>} running tâches en cours
 */
function canStart(running, tenantId, limit = MAX_CONCURRENT) {
  const list = Array.isArray(running) ? running : [...running.values()];
  if (list.length >= limit) return false;
  return list.filter((j) => j.tenantId === tenantId).length < PER_TENANT;
}

/**
 * Erreur d'une tâche, sous la forme de la réponse HTTP qu'aurait donnée la requête
 * (middleware/errors.describeError) : jamais un message interne ni une trace.
 * @returns {{ statusCode: number, message: string, details?: any }}
 */
function errorRecord(err) {
  const d = describeError(err || new Error('Erreur inconnue'));
  const out = { statusCode: d.status, message: d.error };
  if (d.details !== undefined) out.details = d.details;
  return out;
}

/** Avancement borné (taille et types) : { step, done, total, label }. */
function progressRecord(p = {}) {
  const out = {};
  if (p.step != null) out.step = String(p.step).slice(0, 40);
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : undefined);
  if (n(p.done) !== undefined) out.done = n(p.done);
  if (n(p.total) !== undefined) out.total = n(p.total);
  if (p.label != null) out.label = String(p.label).slice(0, 200);
  return out;
}

/**
 * Écrire l'avancement en base maintenant ? Au plus une écriture par `minIntervalMs`, sauf
 * changement d'étape (toujours écrit).
 */
function shouldPersistProgress(last, next, now, minIntervalMs = 1000) {
  if (!last) return true;
  if ((last.progress && last.progress.step) !== next.step) return true;
  return now - last.at >= minIntervalMs;
}

/** Part faite (0 à 1) d'un avancement, ou null s'il n'y a pas de total. */
function fractionOf(progress) {
  if (!progress || !Number.isFinite(progress.total) || progress.total <= 0 || !Number.isFinite(progress.done)) return null;
  return Math.max(0, Math.min(1, progress.done / progress.total));
}

/**
 * Tâche telle que l'API la montre : ni le fichier, ni l'exécuteur, ni le nombre d'essais ;
 * le résultat seulement si elle est terminée avec succès, l'erreur seulement en échec.
 * @param {object} row ligne de app_jobs (colonnes en camelCase), `createdByName` facultatif
 * @param {object} [live] avancement en mémoire de l'exécuteur (plus récent que la base)
 */
function publicJob(row, live = null) {
  if (!row) return null;
  const progress = (live && row.status === 'running') ? live : (row.progress || {});
  return {
    id: row.id, kind: row.kind, status: row.status,
    progress, fraction: fractionOf(progress),
    payload: pickPayload(row.payload),
    result: row.status === 'done' ? row.result : null,
    error: row.status === 'failed' ? row.error : null,
    createdBy: row.createdBy || null, createdByName: row.createdByName || null,
    createdAt: row.createdAt, startedAt: row.startedAt || null, finishedAt: row.finishedAt || null,
  };
}

// Paramètres d'une tâche montrés à l'écran (libellés, fiche concernée) — jamais le reste.
const PUBLIC_PAYLOAD = ['formId', 'formLabel', 'fileName'];
function pickPayload(payload) {
  const out = {};
  for (const k of PUBLIC_PAYLOAD) if (payload && payload[k] != null) out[k] = payload[k];
  return out;
}

/** Identité stable d'un exécuteur (même machine, même port = même exécuteur après redémarrage). */
function runnerIdentity(hostname, port) {
  return `${String(hostname || 'local').slice(0, 120)}:${String(port || '').slice(0, 10)}`;
}

module.exports = {
  STATUSES, TRANSITIONS, MAX_CONCURRENT, PER_TENANT,
  isTerminal, isActive, canTransition, canStart, maxConcurrent, errorRecord, progressRecord, shouldPersistProgress,
  fractionOf, publicJob, runnerIdentity,
};
