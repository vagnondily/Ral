require('dotenv').config();
const { Worker } = require('bullmq');
const { createRedisConnection } = require('../config/redis');
const { QUEUE_NAME } = require('./queue');
const recalcExpensesProcessor = require('./processors/recalcExpenses');
const { OUTBOX_QUEUE, publishOutbox, scheduleOutboxSweep } = require('./outbox');
const logger = require('../config/logger');

// Process-level parallelism: this file is the entry point for the `worker`
// service in docker-compose.yml, which runs with `replicas: 2`. Each
// replica also runs `concurrency` jobs at once inside itself (bounded by
// WORKER_CONCURRENCY, default 4) since the work is I/O-bound (waiting on
// Postgres), not CPU-bound — so concurrent jobs on one process are safe and
// cheap. Together, replicas x concurrency is the "multithreading" strategy:
// real OS-level parallelism via multiple processes, not fighting Node's
// single-threaded event loop.
const concurrency = Number(process.env.WORKER_CONCURRENCY || 4);

const worker = new Worker(QUEUE_NAME, recalcExpensesProcessor, {
  connection: createRedisConnection(),
  concurrency,
});

worker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err?.message }, 'job failed');
});

// Connection-level errors (e.g. Redis briefly unreachable) are transient and
// self-heal on reconnect — log them as warnings with the full reason so they
// are diagnosable, without treating them as fatal.
const errText = (err) => err?.stack || err?.message || (err ? String(err) : 'unknown');
worker.on('error', (err) => {
  logger.warn({ err: errText(err) }, 'worker connection error (transient)');
});

// Contracts module: domain-event publisher (transactional outbox). A single
// concurrent flush per replica is enough — batches are claimed with
// SKIP LOCKED, so replicas never publish the same event twice at once.
const outboxWorker = new Worker(OUTBOX_QUEUE, publishOutbox, {
  connection: createRedisConnection(),
  concurrency: 1,
});
outboxWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: errText(err) }, 'outbox job failed'));
outboxWorker.on('error', (err) => logger.warn({ err: errText(err) }, 'outbox connection error (transient)'));
scheduleOutboxSweep().catch((err) => logger.error({ err: err.message }, 'could not schedule outbox sweep'));

async function shutdown(signal) {
  logger.info({ signal }, 'worker shutting down');
  await Promise.all([worker.close(), outboxWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

logger.info({ concurrency, queue: QUEUE_NAME }, 'tpm worker started');
