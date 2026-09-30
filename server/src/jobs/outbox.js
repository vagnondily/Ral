const { Queue } = require('bullmq');
const { createRedisConnection } = require('../config/redis');
const { pool } = require('../config/db');
const logger = require('../config/logger');

/**
 * Domain-event publisher (transactional outbox).
 *
 * Services write events into `domain_events` inside the same transaction as
 * the business change. This job then delivers them. Two triggers:
 *  - a nudge right after a commit (low latency), and
 *  - a repeatable sweep every 30 s (safety net if the nudge was lost,
 *    Redis was briefly down, or a publisher crashed mid-batch).
 * Delivery is at-least-once: consumers must de-duplicate on event id.
 */
const OUTBOX_QUEUE = 'domain-events';
const BATCH = 100;

// Subscribers per event type. Planning, Reporting and Alertes will register
// here as their modules are built; until then events are only logged, and
// stay in the table as an auditable record of everything that happened.
const subscribers = {
  ContratActive: [],
  ContratModifie: [],
  ContratResilie: [],
};

let queue;
function getOutboxQueue() {
  if (!queue) {
    queue = new Queue(OUTBOX_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 200, removeOnFail: 500 },
    });
  }
  return queue;
}

/** Called after a commit. Never throws: the event is already safely stored,
 * and the periodic sweep will publish it if this nudge fails. */
async function nudgeOutbox() {
  try {
    await getOutboxQueue().add('flush', {});
  } catch (err) {
    logger.warn({ err: err.message }, 'outbox nudge failed — sweep will catch up');
  }
}

async function scheduleOutboxSweep() {
  await getOutboxQueue().add('sweep', {}, { repeat: { every: 30_000 }, jobId: 'outbox-sweep' });
}

async function publishOutbox() {
  let published = 0;
  // Drain in batches until nothing is left to claim.
  for (;;) {
    const { rows } = await pool.query('SELECT * FROM outbox_claim($1)', [BATCH]);
    if (rows.length === 0) break;
    const delivered = [];
    for (const ev of rows) {
      try {
        for (const handler of subscribers[ev.event_type] || []) {
          await handler(ev);
        }
        logger.info({ eventId: ev.id, type: ev.event_type, tenantId: ev.tenant_id, aggregateId: ev.aggregate_id }, 'domain event published');
        delivered.push(ev.id);
      } catch (err) {
        // Left claimed: retried after the 5-minute lease expires.
        logger.error({ eventId: ev.id, err: err.message }, 'domain event delivery failed');
      }
    }
    if (delivered.length) {
      await pool.query('SELECT outbox_mark_published($1::uuid[])', [delivered]);
      published += delivered.length;
    }
    if (rows.length < BATCH) break;
  }
  return { published };
}

module.exports = { OUTBOX_QUEUE, getOutboxQueue, nudgeOutbox, scheduleOutboxSweep, publishOutbox };
