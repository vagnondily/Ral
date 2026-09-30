const { Queue, QueueEvents } = require('bullmq');
const { createRedisConnection } = require('../config/redis');

// One queue for the module's only CPU/IO-bound background task: recomputing
// TPM expenses for a plan from its mission-day calendar. Kept out of the
// request/response cycle so a large plan (thousands of mission days across
// a whole tenant) never makes an API request hang, and so the work can be
// retried automatically and run in parallel across several worker
// processes (see jobs/worker-entry.js) — the "multithreading" requirement
// is met at the process level, which is the reliable way to get real
// parallelism out of Node.js, rather than fighting the single-threaded
// event loop with worker_threads for what is fundamentally a database-bound
// job.
const QUEUE_NAME = 'tpm-expense-recalc';

let queue;
let queueEvents;

function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }
  return queue;
}

function getQueueEvents() {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, { connection: createRedisConnection() });
  }
  return queueEvents;
}

async function enqueueRecalculation(tenantId, planId) {
  // No fixed jobId on purpose: BullMQ ignores add() while a job with the
  // same id still exists (including completed jobs kept for history), which
  // silently dropped every recalculation after the first one. Each change
  // enqueues its own job; recomputeExpenses is idempotent and serialized
  // per plan with an advisory lock (see tpm.repository), so extra jobs are
  // cheap and the last one always writes the up-to-date totals.
  const job = await getQueue().add('recalculate-expenses', { tenantId, planId });
  return job.id;
}

module.exports = { QUEUE_NAME, getQueue, getQueueEvents, enqueueRecalculation };
