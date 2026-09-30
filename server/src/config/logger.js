const pino = require('pino');

// Structured (JSON) logging in production so logs are machine-parseable by
// whatever log aggregator the deployment uses; pretty-printed in dev only.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

module.exports = logger;
