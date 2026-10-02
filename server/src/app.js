const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errors');
const { rateLimit } = require('./middleware/rateLimit');
const { createRedisConnection } = require('./config/redis');
const authRoutes = require('./modules/auth/auth.routes');
const tpmRoutes = require('./modules/tpm/tpm.routes');
const tpmReportsRoutes = require('./modules/tpm/reports.routes');
const tpmConsolidationRoutes = require('./modules/tpm/consolidation.routes');
const tpmPlanningRoutes = require('./modules/tpm/planning.routes');
const tpmPostesRoutes = require('./modules/tpm/postes.routes');
const tpmFieldRoutes = require('./modules/tpm/field.routes');
const contractsRoutes = require('./modules/contracts/contracts.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const usersRoutes = require('./modules/users/users.routes');
const monitoringRoutes = require('./modules/monitoring/monitoring.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Derrière un proxy (load-balancer, ingress) : req.ip = vrai client (pour le
  // rate-limit et les logs). Nombre de sauts de confiance configurable.
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
  app.use(helmet());
  // CORS : origine(s) explicite(s) via CORS_ORIGIN (séparées par des virgules) ;
  // « * » par défaut en dev uniquement. En prod, validateEnv avertit si non fixé.
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : '*';
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  // Liveness/readiness probe for docker-compose healthchecks and any future
  // orchestrator (Kubernetes, etc.) — deliberately has no auth requirement.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Anti-bourrinage du login : par IP + email, fenêtre 15 min. Compteur partagé
  // via Redis si REDIS_URL est défini (API répliquée), sinon en mémoire.
  let rlRedis = null;
  if (process.env.REDIS_URL) {
    try { rlRedis = createRedisConnection(); rlRedis.on('error', (err) => logger.warn({ err }, 'rate-limit Redis error')); }
    catch (err) { logger.warn({ err }, 'rate-limit: connexion Redis impossible, repli mémoire'); }
  }
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.LOGIN_RATE_MAX || 10),
    keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
    redis: rlRedis,
    prefix: 'rl:login',
  });
  app.use('/api/auth/login', loginLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/tpm/reports', tpmReportsRoutes);
  app.use('/api/tpm/consolidation', tpmConsolidationRoutes);
  app.use('/api/tpm/planning', tpmPlanningRoutes);
  app.use('/api/tpm/postes', tpmPostesRoutes);
  app.use('/api/tpm/field', tpmFieldRoutes);
  app.use('/api/tpm', tpmRoutes);
  app.use('/api/contracts', contractsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/monitoring', monitoringRoutes);

  // Anything else is a routing mistake, not a server error.
  app.use((req, res, next) => next(notFound('Route introuvable')));

  // Must be registered last: Express recognizes error middleware by its
  // 4-argument signature.
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
