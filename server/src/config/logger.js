const pino = require('pino');

// Secrets jamais écrits dans les journaux : en-têtes d'authentification et
// cookies des requêtes journalisées par pino-http, et tout champ mot de passe /
// jeton jusqu'à trois niveaux de profondeur (corps, erreurs, contexte métier).
const SECRET_KEYS = [
  'password', 'newPassword', 'currentPassword', 'oldPassword', 'passwordHash', 'password_hash',
  'token', 'accessToken', 'refreshToken', 'apiToken', 'authorization', 'Authorization', 'cookie', 'secret',
];
const REDACT_PATHS = [
  'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
];
const REDACT = { paths: REDACT_PATHS, censor: '[masqué]' };

/**
 * Fabrique du journal. `destination` (flux) sert aux tests ; sinon JSON
 * structuré en production (lisible par l'agrégateur de journaux) et affichage
 * lisible en développement.
 */
function createLogger({ destination, level = process.env.LOG_LEVEL || 'info' } = {}) {
  if (destination) return pino({ level, redact: REDACT }, destination);
  return pino({
    level,
    redact: REDACT,
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  });
}

const logger = createLogger();

module.exports = logger;
module.exports.createLogger = createLogger;
module.exports.REDACT = REDACT;
