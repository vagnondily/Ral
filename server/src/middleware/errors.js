const { knownPending } = require('../db/schemaStatus');

/** Typed application error — controllers throw this for expected failure
 * cases (not found, validation, forbidden) so the central handler below can
 * pick the right HTTP status without string-matching messages. */
class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const notFound = (message = 'Ressource introuvable') => new AppError(404, message);
const badRequest = (message = 'Requête invalide', details) => new AppError(400, message, details);
const forbidden = (message = 'Accès refusé') => new AppError(403, message);
const unauthorized = (message = 'Authentification requise') => new AppError(401, message);
const conflict = (message = 'Conflit de modification', details) => new AppError(409, message, details);
const payloadTooLarge = (message = 'Fichier trop volumineux.', details) => new AppError(413, message, details);

/** « 80 Mo » à partir de la limite que body-parser rapporte (« 80mb » = 80 × 1024², module `bytes`). */
function limitText(bytes) {
  const mo = Number(bytes) / (1024 * 1024);
  if (!Number.isFinite(mo) || mo <= 0) return null;
  return `${mo >= 10 ? Math.round(mo) : String(Math.round(mo * 10) / 10).replace('.', ',')} Mo`;
}

// Erreurs PostgreSQL de données saisies (classe 22 / 23) qui ont échappé à la
// validation : ce sont des erreurs du client (400), jamais des 500.
const PG_CLIENT_ERRORS = {
  '23514': 'Données invalides.',          // check_violation
  '23503': 'Données invalides.',          // foreign_key_violation
  '22P02': 'Données invalides.',          // invalid_text_representation (uuid, nombre…)
  '22007': 'Date invalide : utilisez le format AAAA-MM-JJ (ex. 2026-01-30).', // invalid_datetime_format
  '22008': 'Date invalide : utilisez le format AAAA-MM-JJ (ex. 2026-01-30).', // datetime_field_overflow
};

// Base injoignable (PostgreSQL arrêté, réseau, trop de connexions) : 503, pas
// une « erreur interne » — l'utilisateur sait que ce n'est pas sa saisie.
const DB_UNAVAILABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT', '57P01', '57P03', '53300']);
// Colonne / table / fonction / type inconnus : symptôme d'une migration oubliée
// quand schemaStatus en signale en attente (sinon c'est un bug : 500).
const PG_SCHEMA_ERRORS = new Set(['42703', '42P01', '42883', '42704']);
const SCHEMA_OUTDATED = 'La base de données n\'est pas à jour pour cette version de l\'application. '
  + 'Un administrateur doit lancer « npm run migrate » dans le dossier server, puis redémarrer l\'API.';

// Centralized error handler — must be registered last, after all routes.
// Anything not thrown as an AppError is treated as a bug: logged with full
// detail, but the client only ever sees a generic message, never a stack
// trace or a raw database error (which can leak schema/tenant details).
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  // Corps de requête refusé par body-parser (express.json / express.raw) :
  // trop gros → 413 avec la limite ; JSON mal formé → 400. Ces erreurs portent
  // `type` et `status` (http-errors) ; ce ne sont pas des bugs du serveur.
  if (err.type === 'entity.too.large') {
    const limit = limitText(err.limit);
    return res.status(413).json({
      error: `Envoi trop volumineux${limit ? ` : la taille maximale acceptée est de ${limit}` : ''}. `
        + 'Exportez une période plus courte ou découpez le fichier, puis réessayez.',
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Requête mal formée : le contenu envoyé n\'est pas un JSON valide.' });
  }

  // Postgres unique_violation -> surfaced as a 409, since it is almost
  // always a legitimate "this already exists" client-facing condition
  // (e.g. two requests racing to create the same month's plan).
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Cette ressource existe déjà.' });
  }
  // CHECK / foreign-key / invalid-uuid / invalid-date violations are client
  // input errors that slipped past validation: 400, never a 500.
  if (Object.prototype.hasOwnProperty.call(PG_CLIENT_ERRORS, err.code)) {
    return res.status(400).json({ error: PG_CLIENT_ERRORS[err.code] });
  }

  if (DB_UNAVAILABLE.has(err.code) || /Connection terminated|timeout exceeded when trying to connect/i.test(err.message || '')) {
    req.log?.error({ err }, 'base de données injoignable');
    return res.status(503).json({ error: 'Base de données injoignable : vérifiez que PostgreSQL est démarré, puis réessayez.' });
  }
  if (PG_SCHEMA_ERRORS.has(err.code) && (knownPending() || []).length > 0) {
    req.log?.error({ err, pending: knownPending() }, 'schéma en retard : migrations en attente');
    return res.status(503).json({ error: SCHEMA_OUTDATED }); // noms des fichiers : /api/system/status (admin)
  }

  req.log?.error({ err }, 'unhandled error');
  return res.status(500).json({ error: 'Erreur interne du serveur.' });
}

module.exports = { AppError, notFound, badRequest, forbidden, unauthorized, conflict, payloadTooLarge, errorHandler };
