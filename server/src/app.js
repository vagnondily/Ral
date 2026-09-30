const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const logger = require('./config/logger');
const { errorHandler, notFound } = require('./middleware/errors');
const authRoutes = require('./modules/auth/auth.routes');
const tpmRoutes = require('./modules/tpm/tpm.routes');
const tpmReportsRoutes = require('./modules/tpm/reports.routes');
const tpmConsolidationRoutes = require('./modules/tpm/consolidation.routes');
const tpmPlanningRoutes = require('./modules/tpm/planning.routes');
const tpmPostesRoutes = require('./modules/tpm/postes.routes');
const contractsRoutes = require('./modules/contracts/contracts.routes');
const settingsRoutes = require('./modules/settings/settings.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  // Liveness/readiness probe for docker-compose healthchecks and any future
  // orchestrator (Kubernetes, etc.) — deliberately has no auth requirement.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/tpm/reports', tpmReportsRoutes);
  app.use('/api/tpm/consolidation', tpmConsolidationRoutes);
  app.use('/api/tpm/planning', tpmPlanningRoutes);
  app.use('/api/tpm/postes', tpmPostesRoutes);
  app.use('/api/tpm', tpmRoutes);
  app.use('/api/contracts', contractsRoutes);
  app.use('/api/settings', settingsRoutes);

  // Anything else is a routing mistake, not a server error.
  app.use((req, res, next) => next(notFound('Route introuvable')));

  // Must be registered last: Express recognizes error middleware by its
  // 4-argument signature.
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
