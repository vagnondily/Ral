const IORedis = require('ioredis');

// BullMQ requires maxRetriesPerRequest: null on the connection it manages.
// One shared connection factory so the API process and the worker process
// configure Redis identically.
function createRedisConnection() {
  return new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

module.exports = { createRedisConnection };
