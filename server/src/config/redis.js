const IORedis = require('ioredis');

// BullMQ requires maxRetriesPerRequest: null on the connection it manages.
// One shared connection factory so the API process and the worker process
// configure Redis identically. `overrides` lets a non-BullMQ consumer (e.g.
// the rate limiter) opt into fail-fast behaviour so a missing Redis degrades
// instead of hanging — see app.js.
function createRedisConnection(overrides = {}) {
  return new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...overrides,
  });
}

module.exports = { createRedisConnection };
