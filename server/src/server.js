require('dotenv').config();
const createApp = require('./app');
const logger = require('./config/logger');
const { pool } = require('./config/db');
const { validateEnv } = require('./config/validateEnv');

// Échoue vite si la config est dangereuse (secret manquant, RLS contournée…).
validateEnv();

const port = Number(process.env.PORT || 9000);
const app = createApp();

const server = app.listen(port, () => {
  logger.info({ port }, 'MEMS 2.0 – Partenaires & TPM API listening');
});

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then close the DB pool — important under an orchestrator that
// sends SIGTERM before killing the process (docker-compose down, a rolling
// deploy, autoscaling scale-in).
async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
  // Safety net: force-exit if connections never drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'unhandled rejection');
});
